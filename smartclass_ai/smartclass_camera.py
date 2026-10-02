# ⚠️ LEGACY — STANDALONE OBSOLÈTE (WBC 2026). PRÉFÉREZ camera_real.py + detector-service.
# =================================================================================
# Remplacé par le flux recommandé :
#   Dashboard Professeur (teacher-dashboard.js)
#     → POST /api/smartclass/sessions/start
#     → POST http://localhost:5001/start (X-SmartClass-API-Key)
#        ↳ smartclass-detector-service.py (Flask)
#            ↳ subprocess.Popen([python, camera_real.py])
#
# Ce fichier smartclass_camera.py est gardé uniquement pour :
#   - Historique
#   - Tests ponctuels standalone hors dashboard
#   - Débogage YOLO direct sans le service Flask
#
# Usage (historique, voir flux recommandé ci-dessus) :
# -----------------------------------------------------
# smartclass_ai/smartclass_camera.py
# Détection temps réel des comportements étudiants — SmartClass
#
# Prérequis :
#   1. conda activate smartclass
#   2. python train.py  (modèle entraîné disponible)
#
# Usage :
#   python smartclass_camera.py
#   python smartclass_camera.py --session <SESSION_ID>   (reprendre une séance)
#   python smartclass_camera.py --show                   (afficher la fenêtre vidéo)
#
# =================================================================================
# Ce script :
#   - Capture la webcam en continu
#   - Détecte bow / down / lookup / sit avec YOLOv8
#   - Agrège les détections sur SNAPSHOT_INTERVAL secondes
#   - Calcule attentionPct, distractionPct, fatiguePct, handsRaisedCount
#   - Envoie un snapshot JSON à POST /api/smartclass/camera
#   - Affiche les stats en temps réel dans le terminal

import argparse
import sys
import time
import json
import threading
from pathlib import Path
from collections import deque
from datetime import datetime

import cv2
import requests
from dotenv import load_dotenv
import os

# ─── Configuration ────────────────────────────────────────────────────────────

load_dotenv()

API_URL           = os.getenv("WBC_API_URL",        "http://localhost:4000")
API_KEY           = os.getenv("SMARTCLASS_API_KEY",  "sc_key_change_me_before_deploy")
ROOM_ID           = os.getenv("ROOM_ID",             "classA")
SNAPSHOT_INTERVAL = int(os.getenv("SNAPSHOT_INTERVAL", "30"))
CAMERA_SOURCE_ENV = os.getenv("CAMERA_SOURCE",      "0")
MODEL_PATH_ENV    = os.getenv("MODEL_PATH",          "runs/detect/smartclass/weights/best.pt")

# Mapping classes → champs SmartClass (adapté dataset Roboflow v15)
# bow=0  → fatiguePct
# down=1 → distractionPct
# lookup=2 → attentionPct
# sit=3  → attentionPct
CLASS_NAMES        = ["bow", "down", "lookup", "sit"]
ATTENTION_CLASSES  = {"lookup", "sit"}
DISTRACTION_CLASSES= {"down"}
FATIGUE_CLASSES    = {"bow"}
# handsRaisedCount non disponible dans ce dataset → toujours 0

CONF_THRESHOLD = 0.25   # Seuil de confiance minimum pour compter une détection
                        # 0.40 → trop de faux positifs (projecteur détecté comme personne)
                        # 0.62 → filtre les détections peu sûres
MIN_BOX_AREA_RATIO = 0.005  # Boîte doit couvrir au moins 0.2% de l'image (filtre objets trop petits ou trop grands)

# ─── Arguments CLI ────────────────────────────────────────────────────────────

parser = argparse.ArgumentParser(description="SmartClass — Détection caméra temps réel")
parser.add_argument("--session", type=str, default=None,
                    help="ID de la session SmartClass active")
parser.add_argument("--teacher", type=str, default=None,
                    help="ID de l'enseignant (obtenu depuis le dashboard)")
parser.add_argument("--course",  type=str, default=None,
                    help="ID du cours (obtenu depuis le dashboard)")
parser.add_argument("--room",    type=str, default=ROOM_ID,
                    help="ID de la salle (défaut: classA)")
parser.add_argument("--model",   type=str, default=MODEL_PATH_ENV,
                    help="Chemin vers best.pt")
parser.add_argument("--camera",  type=str, default=CAMERA_SOURCE_ENV,
                    help="Source vidéo (0=webcam, 1=externe, ou chemin fichier)")
parser.add_argument("--show",    action="store_true",
                    help="Afficher la fenêtre de détection en temps réel")
parser.add_argument("--interval",type=int, default=SNAPSHOT_INTERVAL,
                    help=f"Intervalle d'envoi en secondes (défaut: {SNAPSHOT_INTERVAL})")
args = parser.parse_args()

# Mettre à jour ROOM_ID si l'argument --room est fourni
if args.room:
    ROOM_ID = args.room

# ─── Utilitaires ──────────────────────────────────────────────────────────────

HEADERS = {
    "Content-Type": "application/json",
    "x-api-key":    API_KEY,
}

def send_snapshot(session_id: str, teacher_id: str, course_id: str, stats: dict) -> bool:
    """Envoie un snapshot agrégé à l'API WBC."""
    payload = {
        "roomId":          ROOM_ID,
        "attentionPct":    round(stats["attentionPct"],    1),
        "distractionPct":  round(stats["distractionPct"],  1),
        "fatiguePct":      round(stats["fatiguePct"],       1),
        "handsRaisedCount": 0,
        "detectedCount":   stats["detectedCount"],
    }
    # N'inclure sessionId que si c'est un vrai ObjectId MongoDB (pas "standalone")
    if session_id and session_id != "standalone":
        payload["sessionId"] = session_id
    if teacher_id:
        payload["teacherId"] = teacher_id
    if course_id:
        payload["courseId"] = course_id
    
    print(f"\n  🔍 Envoi à {API_URL}/api/smartclass/camera :")
    print(f"  Payload: {payload}")
    print(f"  Headers: {HEADERS}")
    
    try:
        resp = requests.post(
            f"{API_URL}/api/smartclass/camera",
            json=payload,
            headers=HEADERS,
            timeout=5,
        )
        print(f"  📥 Réponse statut: {resp.status_code}")
        print(f"  📥 Réponse contenu: {resp.text}")
        
        if resp.status_code in (200, 201):
            return True
        else:
            print(f"  ⚠️  API réponse {resp.status_code} : {resp.text[:200]}")
            return False
    except requests.exceptions.ConnectionError:
        print(f"  ❌ Impossible de joindre l'API ({API_URL})")
        print(f"     Vérifie que le backend WBC est démarré (node server.js)")
        return False
    except Exception as e:
        print(f"  ❌ Erreur envoi : {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        return False


def get_or_create_session() -> str | None:
    """Récupère la session active ou en crée une nouvelle."""
    if args.session:
        print(f"  ✅ Session fournie : {args.session}")
        return args.session

    # Chercher une session active sur le ROOM_ID
    try:
        resp = requests.get(
            f"{API_URL}/api/smartclass/sessions?roomId={ROOM_ID}&limit=1",
            headers=HEADERS,
            timeout=5,
        )
        if resp.status_code == 200:
            data = resp.json()
            sessions = data.get("sessions", [])
            active = [s for s in sessions if s.get("status") == "active"]
            if active:
                session_id = active[0]["_id"]
                print(f"  ✅ Session active trouvée : {session_id}")
                return session_id
        print(f"  ⚠️  Aucune session active pour {ROOM_ID}.")
        print(f"     Lance une séance depuis le dashboard enseignant WBC,")
        print(f"     ou fournis un ID avec --session <ID>")
        print(f"     Mode standalone : envoi sans session_id (données sans séance)")
        return "standalone"
    except Exception:
        print(f"  ⚠️  API non joignable — mode standalone activé")
        return "standalone"


def calc_stats(detections: list, frame_count: int) -> dict:
    """
    Calcule les métriques SmartClass depuis la liste des détections.
    detections   = [{"class": "lookup", "conf": 0.82, "x1": ..., "y1": ..., "x2": ..., "y2": ...}, ...]
    frame_count  = nombre de frames analysées sur l'intervalle
    """
    if not detections:
        return {
            "attentionPct":   0.0,
            "distractionPct": 0.0,
            "fatiguePct":     0.0,
            "detectedCount":  0,
        }

    total       = len(detections)
    attention   = sum(1 for d in detections if d["class"] in ATTENTION_CLASSES)
    distraction = sum(1 for d in detections if d["class"] in DISTRACTION_CLASSES)
    fatigue     = sum(1 for d in detections if d["class"] in FATIGUE_CLASSES)

    # Nombre moyen de personnes par frame (pas le total sur l'intervalle)
    avg_persons = max(1, round(total / max(frame_count, 1))) if total > 0 else 0

    return {
        "attentionPct":   attention   / total * 100,
        "distractionPct": distraction / total * 100,
        "fatiguePct":     fatigue     / total * 100,
        "detectedCount":  avg_persons,   # ← moyenne, pas somme
    }


def print_stats(stats: dict, interval_detections: int, sent_ok: bool):
    """Affiche un résumé dans le terminal."""
    now = datetime.now().strftime("%H:%M:%S")
    status = "✅ envoyé" if sent_ok else "❌ échec envoi"
    print(f"\n[{now}] Snapshot {status}")
    print(f"  Détections sur {args.interval}s : {interval_detections}")
    print(f"  Attention    : {stats['attentionPct']:5.1f}%  (lookup + sit)")
    print(f"  Distraction  : {stats['distractionPct']:5.1f}%  (down)")
    print(f"  Fatigue      : {stats['fatiguePct']:5.1f}%  (bow)")
    print(f"  Nb personnes : {stats['detectedCount']}")


# ─── Main ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":

    print("=" * 60)
    print("  SmartClass — Détection Caméra Temps Réel")
    print("=" * 60)
    print(f"\n  Salle    : {ROOM_ID}")
    print(f"  API      : {API_URL}")
    print(f"  Interval : {args.interval}s")
    print(f"  Modèle   : {args.model}")

    # ── Vérifier le modèle ────────────────────────────────────────────────────
    model_path = Path(args.model)
    if not model_path.exists():
        print(f"\n❌ Modèle introuvable : {model_path}")
        print(f"   Lance d'abord : python train.py")
        sys.exit(1)

    print(f"\n✅ Modèle trouvé : {model_path} ({model_path.stat().st_size/1e6:.1f} MB)")

    # ── Charger YOLOv8 ────────────────────────────────────────────────────────
    try:
        from ultralytics import YOLO
        model = YOLO(str(model_path))
        print(f"✅ YOLOv8 chargé")
    except Exception as e:
        print(f"❌ Erreur chargement modèle : {e}")
        sys.exit(1)

    # ── Ouvrir la caméra ──────────────────────────────────────────────────────
    cam_source = int(args.camera) if args.camera.isdigit() else args.camera
    cap = cv2.VideoCapture(cam_source)

    if not cap.isOpened():
        print(f"\n❌ Impossible d'ouvrir la caméra (source: {cam_source})")
        print(f"   Vérifie que ta webcam est branchée et non utilisée par une autre app.")
        print(f"   Pour tester sans webcam : python demo_mode.py")
        sys.exit(1)

    # Réglages webcam
    cap.set(cv2.CAP_PROP_FRAME_WIDTH,  640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
    cap.set(cv2.CAP_PROP_FPS, 15)

    w   = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h   = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 15
    print(f"✅ Caméra ouverte : {w}×{h} @ {fps:.0f} FPS")

    # ── Récupérer session ─────────────────────────────────────────────────────
    print(f"\n🔍 Recherche session active pour {ROOM_ID}...")
    session_id = get_or_create_session()

    print(f"\n{'─'*60}")
    print(f"  🎬 Démarrage de la détection...")
    print(f"  Ctrl+C pour arrêter")
    print(f"{'─'*60}\n")

    # ── Boucle principale ─────────────────────────────────────────────────────
    interval_detections = []   # Détections accumulées sur l'intervalle courant
    interval_frames     = 0    # Frames analysées sur l'intervalle courant
    last_send_time      = time.time()
    frame_count         = 0
    total_snapshots     = 0

    # Couleurs par classe pour l'affichage
    CLASS_COLORS = {
        "bow":    (0,   165, 255),   # orange
        "down":   (0,   0,   255),   # rouge
        "lookup": (0,   255, 0),     # vert
        "sit":    (255, 200, 0),     # jaune
    }

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                print("⚠️  Frame vide — reconnexion caméra...")
                time.sleep(0.5)
                continue

            frame_count    += 1
            interval_frames += 1

            # ── Inférence YOLOv8 (toutes les frames) ──────────────────────────
            # iou=0.45 → fusionne les boîtes qui se chevauchent (évite double détection)
            results = model(frame, conf=CONF_THRESHOLD, iou=0.45, verbose=False)[0]

            frame_detections = []
            filtered_boxes = []  # Pour conserver les boîtes filtrées (coordonnées, classe, confiance)
            img_area = w * h  # surface totale de l'image en pixels

            for box in results.boxes:
                cls_id   = int(box.cls[0])
                conf     = float(box.conf[0])
                cls_name = CLASS_NAMES[cls_id] if cls_id < len(CLASS_NAMES) else str(cls_id)

                # ── Filtres anti-faux-positifs ────────────────────────────────
                # 1. Surface de la boîte détectée
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                box_area = (x2 - x1) * (y2 - y1)
                area_ratio = box_area / img_area

                # Rejeter si boîte trop petite (<0.2%) ou trop grande (>60% = mur/projecteur)
                if area_ratio < MIN_BOX_AREA_RATIO or area_ratio > 0.90:
                    continue

                # Ajouter à nos listes
                detection_data = {"class": cls_name, "conf": conf, "x1": x1, "y1": y1, "x2": x2, "y2": y2}
                frame_detections.append(detection_data)
                interval_detections.append(detection_data)
                filtered_boxes.append(detection_data)
                        # ── Affichage fenêtre (si --show) ─────────────────────────────────
            if args.show:
                # Faire une copie de l'image pour l'annotation
                annotated = frame.copy()

                # Dessiner les boîtes filtrées avec nos couleurs personnalisées
                for det in filtered_boxes:
                    x1, y1, x2, y2 = int(det["x1"]), int(det["y1"]), int(det["x2"]), int(det["y2"])
                    color = CLASS_COLORS.get(det["class"], (255, 255, 255))  # Couleur par défaut: blanc
                    
                    # Dessiner la boîte
                    cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)
                    
                    # Préparer le label (classe + confiance)
                    label = f"{det['class']} ({det['conf']:.2f})"
                    
                    # Calculer la taille du texte pour le fond du label
                    (label_w, label_h), baseline = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 2)
                    
                    # Dessiner le fond du label
                    cv2.rectangle(annotated, (x1, y1 - label_h - 10), (x1 + label_w, y1), color, -1)
                    
                    # Dessiner le label en noir pour la lisibilité
                    cv2.putText(annotated, label, (x1, y1 - 5),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 2)

                # Overlay stats en temps réel
                if interval_detections:
                    live_stats = calc_stats(interval_detections, interval_frames)
                    overlay_lines = [
                        f"Attention   : {live_stats['attentionPct']:.0f}%",
                        f"Distraction : {live_stats['distractionPct']:.0f}%",
                        f"Fatigue     : {live_stats['fatiguePct']:.0f}%",
                        f"Detected    : {live_stats['detectedCount']}",
                    ]
                    for i, line in enumerate(overlay_lines):
                        cv2.putText(annotated, line, (10, 25 + i * 22),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)

                # Countdown avant prochain envoi
                elapsed = time.time() - last_send_time
                remaining = max(0, args.interval - elapsed)
                cv2.putText(annotated,
                            f"Envoi dans : {remaining:.0f}s",
                            (10, h - 15),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 255), 2)

                cv2.imshow("SmartClass — Detection", annotated)
                if cv2.waitKey(1) & 0xFF == ord('q'):
                    print("\n⏹️  Arrêt demandé (touche Q)")
                    break

            # ── Envoi snapshot toutes les SNAPSHOT_INTERVAL secondes ──────────
            now = time.time()
            if now - last_send_time >= args.interval:
                stats  = calc_stats(interval_detections, interval_frames)
                sent   = send_snapshot(session_id, args.teacher, args.course, stats)
                print_stats(stats, len(interval_detections), sent)

                if sent:
                    total_snapshots += 1

                # Réinitialiser pour le prochain intervalle
                interval_detections = []
                interval_frames     = 0
                last_send_time = now

    except KeyboardInterrupt:
        print(f"\n\n⏹️  Arrêt par Ctrl+C")

    finally:
        cap.release()
        if args.show:
            cv2.destroyAllWindows()

        print(f"\n{'=' * 60}")
        print(f"  Résumé de la session")
        print(f"{'=' * 60}")
        print(f"  Frames traitées  : {frame_count}")
        print(f"  Snapshots envoyés: {total_snapshots}")
        print(f"  Session          : {session_id}")
        print(f"{'=' * 60}")
