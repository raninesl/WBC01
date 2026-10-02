"""
╔══════════════════════════════════════════════════════════════════╗
║   SMARTCLASS — MODÈLE IA D'ENGAGEMENT ÉTUDIANT                  ║
║   Projet de Fin d'Études (PFE) — Wes'sup Business City          ║
║   Technologie : Python + MediaPipe + OpenCV                      ║
║   Fonctionne 100% localement (hors-ligne)                       ║
╚══════════════════════════════════════════════════════════════════╝

Fonctionnement :
  - Capture vidéo via webcam ou caméra IP
  - Détecte les visages avec MediaPipe FaceMesh (468 landmarks)
  - Calcule pour chaque visage :
      • EAR  (Eye Aspect Ratio)    → fatigue / endormissement
      • MAR  (Mouth Aspect Ratio)  → bâillement
      • Head Yaw / Pitch           → orientation de la tête
      • Score d'engagement individuel
  - Agrège les métriques (classe entière)
  - Envoie les données au backend Wessup toutes les 30s
  - Sauvegarde les données dans un CSV local

Usage :
  python detect_engagement.py
  python detect_engagement.py --source 0          (webcam 0)
  python detect_engagement.py --source rtsp://...  (caméra IP)
  python detect_engagement.py --room classA --session <id>
  python detect_engagement.py --no-api            (hors-ligne uniquement)
"""

import cv2
import mediapipe as mp
import numpy as np
import time
import csv
import os
import json
import argparse
import requests
from datetime import datetime
from collections import deque

# ─────────────────────────────────────────────────
# CONFIGURATION
# ─────────────────────────────────────────────────
API_URL    = "http://localhost:4000"
API_KEY    = os.getenv("SMARTCLASS_API_KEY", "sc_key_change_me_before_deploy")
SEND_EVERY = 30          # secondes entre chaque envoi au backend
SMOOTH_WIN = 8           # fenêtre de lissage (frames)
CSV_FILE   = "dataset/engagement_log.csv"

# Seuils de détection
EAR_FATIGUE_THRESH   = 0.22   # En dessous → yeux fermés
MAR_YAWN_THRESH      = 0.65   # Au-dessus  → bâillement
YAW_DISTRACT_THRESH  = 0.28   # Décalage nez/centre yeux normalisé
PITCH_DOWN_THRESH    = 0.20   # Tête penchée vers le bas

# ─────────────────────────────────────────────────
# INDICES MEDIAPIPE FACE MESH (sur 468 landmarks)
# ─────────────────────────────────────────────────
# Yeux (6 points chacun)
LEFT_EYE  = [33,  160, 158, 133, 153, 144]
RIGHT_EYE = [362, 385, 387, 263, 373, 380]

# Bouche (pour bâillement)
MOUTH_TOP    = 13
MOUTH_BOTTOM = 14
MOUTH_LEFT   = 61
MOUTH_RIGHT  = 291

# Points de référence pour la pose de tête
NOSE_TIP     = 1
CHIN         = 152
LEFT_EYE_L   = 33
RIGHT_EYE_R  = 263
LEFT_MOUTH   = 61
RIGHT_MOUTH  = 291

# ─────────────────────────────────────────────────
# UTILITAIRES GÉOMÉTRIQUES
# ─────────────────────────────────────────────────
def euclidean(p1, p2):
    return np.linalg.norm(np.array(p1) - np.array(p2))

def landmark_to_xy(lm, idx, w, h):
    p = lm[idx]
    return (int(p.x * w), int(p.y * h))

def calc_ear(landmarks, eye_indices, w, h):
    """Eye Aspect Ratio — mesure l'ouverture des yeux."""
    pts = [landmark_to_xy(landmarks, i, w, h) for i in eye_indices]
    A = euclidean(pts[1], pts[5])
    B = euclidean(pts[2], pts[4])
    C = euclidean(pts[0], pts[3])
    return (A + B) / (2.0 * C) if C > 0 else 0

def calc_mar(landmarks, w, h):
    """Mouth Aspect Ratio — détecte les bâillements."""
    top    = landmark_to_xy(landmarks, MOUTH_TOP, w, h)
    bottom = landmark_to_xy(landmarks, MOUTH_BOTTOM, w, h)
    left   = landmark_to_xy(landmarks, MOUTH_LEFT, w, h)
    right  = landmark_to_xy(landmarks, MOUTH_RIGHT, w, h)
    vertical   = euclidean(top, bottom)
    horizontal = euclidean(left, right)
    return vertical / horizontal if horizontal > 0 else 0

def calc_head_pose(landmarks, w, h):
    """
    Estime l'orientation de la tête en 2D depuis les landmarks.
    Retourne (yaw, pitch) normalisés par la largeur du visage.
      yaw   > seuil → tourne à droite/gauche (distraction)
      pitch > seuil → tête baissée (téléphone, somnolence)
    """
    nose  = landmark_to_xy(landmarks, NOSE_TIP, w, h)
    le    = landmark_to_xy(landmarks, LEFT_EYE_L, w, h)
    re    = landmark_to_xy(landmarks, RIGHT_EYE_R, w, h)
    chin  = landmark_to_xy(landmarks, CHIN, w, h)

    eye_center = ((le[0] + re[0]) // 2, (le[1] + re[1]) // 2)
    face_width = euclidean(le, re)
    if face_width < 1:
        return 0.0, 0.0

    yaw   = (nose[0] - eye_center[0]) / face_width
    pitch = (chin[1] - eye_center[1]) / face_width - 1.0  # baseline ~1.0
    return round(yaw, 3), round(pitch, 3)

# ─────────────────────────────────────────────────
# CLASSIFICATION PAR RÈGLES (Rule-Based Model)
# ─────────────────────────────────────────────────
def classify_student(ear, mar, yaw, pitch):
    """
    Classifie l'état d'un étudiant à partir des métriques biométriques.
    Retourne : (état, score_engagement, raisons)

    États possibles :
      - 'attentif'    : Score 70-100
      - 'distrait'    : Score 20-60
      - 'fatigue'     : Score 0-40
      - 'baillement'  : Score 30-50
    """
    reasons = []
    score   = 100

    # ── Fatigue (yeux fermés) ──
    is_fatigued = ear < EAR_FATIGUE_THRESH
    if is_fatigued:
        score -= 60
        reasons.append(f"yeux fermés (EAR={ear:.3f})")

    # ── Bâillement ──
    is_yawning = mar > MAR_YAWN_THRESH
    if is_yawning:
        score -= 30
        reasons.append(f"bâillement (MAR={mar:.3f})")

    # ── Distraction (tête tournée) ──
    is_distracted = abs(yaw) > YAW_DISTRACT_THRESH
    if is_distracted:
        score -= 40
        reasons.append(f"tête tournée (yaw={yaw:.3f})")

    # ── Tête baissée ──
    is_head_down = pitch > PITCH_DOWN_THRESH
    if is_head_down and not is_fatigued:
        score -= 25
        reasons.append(f"tête baissée (pitch={pitch:.3f})")

    score = max(0, min(100, score))

    # État final
    if is_fatigued:
        state = "fatigue"
    elif is_yawning:
        state = "baillement"
    elif is_distracted or is_head_down:
        state = "distrait"
    else:
        state = "attentif"

    return state, score, reasons

# ─────────────────────────────────────────────────
# LISSAGE TEMPOREL
# ─────────────────────────────────────────────────
class SmoothMetrics:
    """Lisse les métriques sur une fenêtre glissante pour éviter les fluctuations."""
    def __init__(self, window=SMOOTH_WIN):
        self.win = window
        self.buffers = {}

    def update(self, key, value):
        if key not in self.buffers:
            self.buffers[key] = deque(maxlen=self.win)
        self.buffers[key].append(value)
        return round(np.mean(self.buffers[key]))

    def get(self, key, default=0):
        if key not in self.buffers or len(self.buffers[key]) == 0:
            return default
        return round(np.mean(self.buffers[key]))

# ─────────────────────────────────────────────────
# ENVOI DONNÉES AU BACKEND
# ─────────────────────────────────────────────────
def send_to_backend(payload, session_id=None, room_id="classA"):
    """Envoie les métriques au serveur Wessup via l'API."""
    data = {
        "roomId":          room_id,
        "sessionId":       session_id,
        "attentionPct":    int(payload["attention_pct"]),
        "distractionPct":  int(payload["distraction_pct"]),
        "fatiguePct":      int(payload["fatigue_pct"]),
        "handsRaisedCount":int(payload["hands_raised"]),
        "detectedCount":   int(payload["detected_count"]),
    }
    try:
        r = requests.post(
            f"{API_URL}/api/smartclass/camera",
            json=data,
            headers={"X-API-Key": API_KEY},
            timeout=5
        )
        if r.status_code == 201:
            print(f"[OK] Données envoyées → {data['detectedCount']} visages, engagement ~{payload['engagement_score']}%")
        else:
            print(f"[WARN] Réponse serveur {r.status_code}: {r.text[:80]}")
    except requests.exceptions.ConnectionError:
        print("[WARN] Serveur non joignable — données sauvegardées localement")
    except Exception as e:
        print(f"[ERR] Envoi échoué: {e}")

# ─────────────────────────────────────────────────
# SAUVEGARDE CSV (Dataset)
# ─────────────────────────────────────────────────
def init_csv():
    os.makedirs("dataset", exist_ok=True)
    if not os.path.exists(CSV_FILE):
        with open(CSV_FILE, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow([
                "timestamp", "face_id", "ear_left", "ear_right", "ear_avg",
                "mar", "yaw", "pitch", "state", "engagement_score",
                "class_attention_pct", "class_distraction_pct", "class_fatigue_pct",
                "detected_count", "session_id", "room_id"
            ])
    print(f"[INFO] Dataset CSV initialisé : {CSV_FILE}")

def save_to_csv(rows):
    with open(CSV_FILE, "a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerows(rows)

# ─────────────────────────────────────────────────
# AFFICHAGE OVERLAY
# ─────────────────────────────────────────────────
COLORS = {
    "attentif":   (0, 255, 136),   # vert
    "distrait":   (0, 170, 255),   # orange
    "fatigue":    (68, 68, 255),   # rouge
    "baillement": (255, 200, 0),   # jaune
}

def draw_face_overlay(frame, face_rect, state, score, face_id, reasons, landmarks_px):
    """Dessine le rectangle, le label et les landmarks sur la frame."""
    x, y, w, h = face_rect
    color = COLORS.get(state, (200, 200, 200))

    # Rectangle du visage
    cv2.rectangle(frame, (x, y), (x+w, y+h), color, 2)

    # Label principal
    label = f"#{face_id} {state.upper()}  {score}%"
    (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
    cv2.rectangle(frame, (x, y - th - 8), (x + tw + 8, y), color, -1)
    cv2.putText(frame, label, (x + 4, y - 4),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 1, cv2.LINE_AA)

    # Barre d'engagement
    bar_w = int(w * score / 100)
    cv2.rectangle(frame, (x, y + h + 2), (x + w, y + h + 7), (50, 50, 50), -1)
    cv2.rectangle(frame, (x, y + h + 2), (x + bar_w, y + h + 7), color, -1)

    # Points landmarks clés (nez, yeux, bouche)
    for lx, ly in landmarks_px:
        cv2.circle(frame, (lx, ly), 1, (0, 242, 255), -1)

def draw_dashboard(frame, metrics, fps, send_countdown):
    """Panneau de métriques globales en haut à droite."""
    h, w = frame.shape[:2]
    panel_x = w - 260
    panel_y = 10
    panel_w = 250
    panel_h = 200

    # Fond semi-transparent
    overlay = frame.copy()
    cv2.rectangle(overlay, (panel_x, panel_y), (panel_x + panel_w, panel_y + panel_h),
                  (5, 5, 20), -1)
    cv2.addWeighted(overlay, 0.75, frame, 0.25, 0, frame)
    cv2.rectangle(frame, (panel_x, panel_y), (panel_x + panel_w, panel_y + panel_h),
                  (0, 242, 255), 1)

    lines = [
        ("SMARTCLASS IA", (0, 242, 255), 0.5),
        (f"FPS: {fps:.0f}", (150, 150, 150), 0.42),
        (f"Detectes:   {metrics['detected_count']}", (200, 200, 200), 0.44),
        (f"Attention:  {metrics['attention_pct']}%", (0, 255, 136), 0.44),
        (f"Distraction:{metrics['distraction_pct']}%", (0, 170, 255), 0.44),
        (f"Fatigue:    {metrics['fatigue_pct']}%", (68, 68, 255), 0.44),
        (f"Engagement: {metrics['engagement_score']}%", (0, 242, 255), 0.5),
        (f"Envoi dans: {send_countdown}s", (100, 100, 100), 0.38),
    ]
    for i, (text, color, scale) in enumerate(lines):
        cv2.putText(frame, text, (panel_x + 8, panel_y + 22 + i * 22),
                    cv2.FONT_HERSHEY_SIMPLEX, scale, color, 1, cv2.LINE_AA)

    # Barre d'engagement globale
    eng = metrics["engagement_score"]
    bar_color = (0, 255, 136) if eng >= 70 else (0, 170, 255) if eng >= 40 else (68, 68, 255)
    bx, by = panel_x + 8, panel_y + panel_h - 16
    cv2.rectangle(frame, (bx, by), (bx + panel_w - 16, by + 8), (40, 40, 40), -1)
    cv2.rectangle(frame, (bx, by), (bx + int((panel_w - 16) * eng / 100), by + 8), bar_color, -1)

# ─────────────────────────────────────────────────
# BOUCLE PRINCIPALE
# ─────────────────────────────────────────────────
def run(source=0, room_id="classA", session_id=None, send_api=True):
    """Lance la détection en temps réel."""

    print("=" * 60)
    print("  SMARTCLASS IA — Détection d'engagement étudiant")
    print(f"  Source    : {source}")
    print(f"  Salle     : {room_id}")
    print(f"  Session   : {session_id or 'auto-détection'}")
    print(f"  Envoi API : {'activé' if send_api else 'désactivé'}")
    print("=" * 60)
    print("  Appuyez sur [Q] pour quitter, [S] pour envoyer maintenant")
    print()

    # Initialisation MediaPipe
    mp_face_mesh = mp.solutions.face_mesh
    face_mesh = mp_face_mesh.FaceMesh(
        static_image_mode=False,
        max_num_faces=30,          # jusqu'à 30 étudiants
        refine_landmarks=True,     # landmarks plus précis (iris inclus)
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    )

    # Initialisation caméra
    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        print(f"[ERREUR] Impossible d'ouvrir la source: {source}")
        return

    cap.set(cv2.CAP_PROP_FRAME_WIDTH,  1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)

    smoother    = SmoothMetrics()
    init_csv()

    last_send  = time.time()
    fps_time   = time.time()
    fps_count  = 0
    fps        = 0.0
    csv_buffer = []

    print("[INFO] Démarrage de la détection...")

    while True:
        ret, frame = cap.read()
        if not ret:
            print("[WARN] Frame perdue, tentative de reconnexion...")
            time.sleep(0.1)
            continue

        frame = cv2.flip(frame, 1)   # miroir horizontal
        h, w  = frame.shape[:2]
        rgb   = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        rgb.flags.writeable = False

        results = face_mesh.process(rgb)
        rgb.flags.writeable = True

        # ── Analyse des visages ──
        face_stats = []
        if results.multi_face_landmarks:
            for face_id, face_lm in enumerate(results.multi_face_landmarks):
                lm = face_lm.landmark

                ear_l = calc_ear(lm, LEFT_EYE,  w, h)
                ear_r = calc_ear(lm, RIGHT_EYE, w, h)
                ear   = (ear_l + ear_r) / 2
                mar   = calc_mar(lm, w, h)
                yaw, pitch = calc_head_pose(lm, w, h)

                state, score, reasons = classify_student(ear, mar, yaw, pitch)
                face_stats.append({
                    "face_id": face_id + 1,
                    "ear_l": round(ear_l, 3), "ear_r": round(ear_r, 3),
                    "ear": round(ear, 3), "mar": round(mar, 3),
                    "yaw": yaw, "pitch": pitch,
                    "state": state, "score": score,
                })

                # Landmarks à afficher (sous-ensemble)
                key_pts = [NOSE_TIP, LEFT_EYE_L, RIGHT_EYE_R, MOUTH_LEFT, MOUTH_RIGHT, CHIN]
                lm_px = [landmark_to_xy(lm, i, w, h) for i in key_pts]

                # Bounding box approchée depuis landmarks
                xs = [int(l.x * w) for l in lm]
                ys = [int(l.y * h) for l in lm]
                bx, by = max(0, min(xs) - 10), max(0, min(ys) - 10)
                bw = min(w - bx, max(xs) - min(xs) + 20)
                bh = min(h - by, max(ys) - min(ys) + 20)

                draw_face_overlay(frame, (bx, by, bw, bh), state, score, face_id + 1, reasons, lm_px)

        # ── Métriques agrégées (classe entière) ──
        n = len(face_stats)
        if n > 0:
            n_att  = sum(1 for f in face_stats if f["state"] == "attentif")
            n_dist = sum(1 for f in face_stats if f["state"] in ("distrait", "baillement"))
            n_fat  = sum(1 for f in face_stats if f["state"] == "fatigue")

            raw_att  = round(n_att  / n * 100)
            raw_dist = round(n_dist / n * 100)
            raw_fat  = round(n_fat  / n * 100)
        else:
            raw_att = raw_dist = raw_fat = 0

        att_s  = smoother.update("attention",   raw_att)
        dist_s = smoother.update("distraction", raw_dist)
        fat_s  = smoother.update("fatigue",     raw_fat)
        cnt_s  = smoother.update("count",       n)

        eng = round(att_s * 0.50 + (100 - dist_s) * 0.35 + (100 - fat_s) * 0.15)

        metrics = {
            "attention_pct":   att_s,
            "distraction_pct": dist_s,
            "fatigue_pct":     fat_s,
            "engagement_score":eng,
            "detected_count":  cnt_s,
            "hands_raised":    0,
        }

        # ── FPS ──
        fps_count += 1
        if time.time() - fps_time >= 1.0:
            fps      = fps_count / (time.time() - fps_time)
            fps_count = 0
            fps_time  = time.time()

        # ── Envoi périodique ──
        elapsed      = time.time() - last_send
        send_countdown = max(0, int(SEND_EVERY - elapsed))

        if elapsed >= SEND_EVERY and send_api:
            send_to_backend(metrics, session_id, room_id)
            last_send = time.time()

        # ── Sauvegarde CSV ──
        ts = datetime.now().isoformat()
        for f in face_stats:
            csv_buffer.append([
                ts, f["face_id"], f["ear_l"], f["ear_r"], f["ear"],
                f["mar"], f["yaw"], f["pitch"], f["state"], f["score"],
                att_s, dist_s, fat_s, n, session_id or "", room_id
            ])
        if len(csv_buffer) >= 50:
            save_to_csv(csv_buffer)
            csv_buffer.clear()

        # ── Overlay UI ──
        draw_dashboard(frame, metrics, fps, send_countdown)

        # Titre de la fenêtre
        cv2.imshow(f"SmartClass IA — {room_id} — Appuyez sur Q pour quitter", frame)

        # ── Touches ──
        key = cv2.waitKey(1) & 0xFF
        if key == ord('q') or key == 27:
            break
        elif key == ord('s') and send_api:
            print("[INFO] Envoi manuel...")
            send_to_backend(metrics, session_id, room_id)
            last_send = time.time()

    # Nettoyage
    if csv_buffer:
        save_to_csv(csv_buffer)
    cap.release()
    face_mesh.close()
    cv2.destroyAllWindows()
    print(f"\n[INFO] Session terminée. Données sauvegardées dans '{CSV_FILE}'")

# ─────────────────────────────────────────────────
# POINT D'ENTRÉE
# ─────────────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="SmartClass IA — Détection d'engagement")
    parser.add_argument("--source",   default=0,        help="Source vidéo (0=webcam, ou URL RTSP)")
    parser.add_argument("--room",     default="classA", help="Identifiant de la salle (classA/classB)")
    parser.add_argument("--session",  default=None,     help="ID de la session SmartClass (optionnel)")
    parser.add_argument("--no-api",   action="store_true", help="Désactiver l'envoi au backend")
    args = parser.parse_args()

    # Convertit la source en int si c'est un chiffre (webcam)
    source = int(args.source) if str(args.source).isdigit() else args.source

    run(
        source=source,
        room_id=args.room,
        session_id=args.session,
        send_api=not args.no_api,
    )
