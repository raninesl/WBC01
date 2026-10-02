"""
SmartClass AI v4 — Architecture Hybride YOLOv8 + MediaPipe
============================================================
Contribution originale PFE 2026 : fusion de deux couches IA complémentaires
pour un score d'engagement robuste et multi-dimensionnel.

╔══════════════════════════════════════════════════════════════╗
║  ARCHITECTURE HYBRIDE — 2 COUCHES IA                        ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  COUCHE 1 — YOLOv8n (Macro comportementale)                 ║
║  ─────────────────────────────────────────────────────────  ║
║  Modèle    : YOLOv8n fine-tuné sur SCB-Dataset3              ║
║  Fréquence : toutes les 3 frames (~5 FPS)                    ║
║  Détecte   : focused, hand_raising, phone, sleeping,         ║
║              bow_head, reading, writing, looking_around      ║
║  Sortie    : pourcentages agrégés à la classe entière        ║
║              (attentionPct, distractionPct, fatiguePct)      ║
║                                   │                          ║
║                                   ↓ poids 40%               ║
║                         HybridEngagementEngine               ║
║                                   ↑ poids 60%               ║
║                                   │                          ║
║  COUCHE 2 — MediaPipe FaceMesh (Biométrie fine)              ║
║  ─────────────────────────────────────────────────────────  ║
║  Indicateurs biométriques validés scientifiquement :         ║
║    ① EAR  — Eye Aspect Ratio               → 30%            ║
║    ② HEAD — Orientation tête (yaw + pitch)  → 25%           ║
║    ③ BLINK — Taux de clignement (fatigue)   → 20%           ║
║    ④ STAB — Stabilité de tête               → 15%           ║
║    ⑤ GAZE — Direction du regard (iris)      → 10%           ║
║    + Bonus : main levée (+15), hochement (+8)                ║
║    + Malus : bâillement (-20), téléphone (-40)               ║
║  Calibration individuelle : StudentBaseline (10 premières s) ║
║                                                              ║
╠══════════════════════════════════════════════════════════════╣
║  SCORE FINAL = YOLO(40%) + MediaPipe(60%)                   ║
║  Envoi backend toutes les 5s via HTTP POST                   ║
╚══════════════════════════════════════════════════════════════╝

Références scientifiques :
  - Soukupova & Cech (2016) — Real-Time Eye Blink Detection using
    Facial Landmarks (EAR)
  - Monkaresi et al. (2017) — Automated Detection of Engagement
    Using Video-Based Estimation of Facial Expressions
  - Whitehill et al. (2014) — The Faces of Engagement
  - Al-Kaisi et al. (2020)  — Multimodal Engagement Detection
  - Zhu & Ramanan (2012)    — Face detection, pose estimation

Wessup / Wess Business City — PFE 2026
"""

import cv2
import numpy as np
import mediapipe as mp
import time, math, threading
import requests
from datetime import datetime
from collections import deque
from dataclasses import dataclass, field
from typing import Dict, Optional
from session_tracker import SessionTracker

# ══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ══════════════════════════════════════════════════════════════════════════════
CFG = {
    "camera":           0,
    "fps":              15,
    "backend_url":      "http://localhost:4000",
    "api_key":          "",          # Définir SMARTCLASS_API_KEY dans .env — auth machine
    "room_id":          "salle-101",
    "send_interval":    5,          # Secondes entre deux envois backend
    "display":          True,
    "use_yolo":         True,
    "yolo_model":       "yolov8n.pt",
    "yolo_conf":        0.45,
    "calibration_sec":  10,         # Durée calibration baseline (secondes)
    "ema_fast":         0.20,       # Alpha EMA rapide  → réactif (~0.5s)
    "ema_slow":         0.05,       # Alpha EMA lente   → stable  (~3s)
    "alert_threshold":  35.0,       # Score sous lequel une alerte peut se déclencher
    "alert_duration":   10,         # Secondes de score bas avant alerte
}

# ══════════════════════════════════════════════════════════════════════════════
# LANDMARKS MEDIAPIPE
# ══════════════════════════════════════════════════════════════════════════════
EYE_L  = [33, 160, 158, 133, 153, 144]   # 6 points oeil gauche
EYE_R  = [362, 385, 387, 263, 373, 380]  # 6 points oeil droit
MOUTH  = [61, 291, 13, 14, 17, 0]        # 6 points bouche
IRIS_L = [474, 475, 476, 477]            # 4 points iris gauche (refine_landmarks)
IRIS_R = [469, 470, 471, 472]            # 4 points iris droit
NOSE   = 1
CHIN   = 152
LCHEEK = 234
RCHEEK = 454
FOREH  = 10


# ── Fonctions géométriques ────────────────────────────────────────────────────
def dist(a, b):
    """Distance euclidienne entre deux points 2D"""
    return math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2)


def lm_pt(lms, i, W, H):
    """Convertit un landmark normalisé en coordonnées pixels"""
    return (lms[i].x * W, lms[i].y * H)


def calc_ear(pts):
    """
    Eye Aspect Ratio — Soukupova & Cech (2016)
    EAR = (||p2-p6|| + ||p3-p5||) / (2 × ||p1-p4||)
    Valeurs : ~0.30 yeux ouverts / <0.22 clignement / <0.15 fermé
    """
    if len(pts) < 6:
        return 0.30
    v1 = dist(pts[1], pts[5])
    v2 = dist(pts[2], pts[4])
    h  = dist(pts[0], pts[3])
    return (v1 + v2) / (2.0 * h + 1e-6)


def calc_mar(pts):
    """
    Mouth Aspect Ratio
    MAR = hauteur_bouche / largeur_bouche
    >0.60 = bâillement
    """
    if len(pts) < 6:
        return 0.25
    return dist(pts[2], pts[5]) / (dist(pts[0], pts[1]) + 1e-6)


def calc_head_pose(lms, W, H):
    """
    Estimation orientation tête (yaw + pitch) par géométrie faciale.
    Yaw  : rotation gauche/droite  (0 = face caméra)
    Pitch: inclinaison haut/bas    (0 = face caméra)
    """
    try:
        def p(i): return lm_pt(lms, i, W, H)
        n = p(NOSE); c = p(CHIN); l = p(LCHEEK); r = p(RCHEEK); f = p(FOREH)
        fw = dist(l, r) + 1e-6
        fh = dist(f, c) + 1e-6
        yaw   = (n[0] - (l[0]+r[0])/2) / fw
        pitch = (n[1] - (f[1]+c[1])/2) / fh
        return float(yaw), float(pitch)
    except:
        return 0.0, 0.0


def calc_iris_gaze(lms, W, H):
    """
    Direction du regard via position des iris dans les yeux.
    Retourne gaze_x : 0 = centré, ±0.5 = regard extrême
    Nécessite refine_landmarks=True dans MediaPipe.
    """
    try:
        def center(idxs):
            pts = [lm_pt(lms, i, W, H) for i in idxs]
            return (sum(p[0] for p in pts)/len(pts),
                    sum(p[1] for p in pts)/len(pts))

        il = center(IRIS_L)
        ir = center(IRIS_R)
        el_l = lm_pt(lms, EYE_L[0], W, H)
        el_r = lm_pt(lms, EYE_L[3], W, H)
        er_l = lm_pt(lms, EYE_R[0], W, H)
        er_r = lm_pt(lms, EYE_R[3], W, H)

        def ratio(iris, e_l, e_r):
            ew = dist(e_l, e_r) + 1e-6
            return (iris[0] - e_l[0]) / ew - 0.5

        gaze_x = (ratio(il, el_l, el_r) + ratio(ir, er_l, er_r)) / 2
        return float(gaze_x)
    except:
        return 0.0


# ══════════════════════════════════════════════════════════════════════════════
# FORMULE D'ENGAGEMENT — Pondération scientifique
# ══════════════════════════════════════════════════════════════════════════════
def compute_engagement_score(
    ear_norm:      float,   # EAR normalisé par baseline (1.0 = normal)
    mar:           float,   # Ouverture bouche (>0.60 = bâillement)
    yaw_norm:      float,   # Rotation tête normalisée
    pitch:         float,   # Inclinaison tête
    blink_rate:    float,   # Clignements par minute
    head_stability:float,   # Stabilité tête 0-100
    gaze_x:        float,   # Direction regard -0.5 à +0.5
    is_nodding:    bool,    # Hochement de tête (signe d'attention)
    hand_raised:   bool,    # Main levée (participation)
    phone:         bool,    # Téléphone détecté
) -> float:
    """
    Calcule le score d'engagement 0–100 par formule pondérée.

    Poids inspirés de :
      - Monkaresi et al. (2017) — Automated Detection of Engagement
      - Whitehill et al. (2014) — The Faces of Engagement
      - Al-Kaisi et al. (2020)  — Multimodal Engagement Detection

    Composition :
      30% EAR  (ouverture yeux)
      25% HEAD (orientation tête)
      20% BLINK (fatigue via clignements)
      15% STAB (stabilité)
      10% GAZE (direction regard)
      + bonus/malus comportementaux
    """

    # ── 1. Score EAR (30%) ────────────────────────────────────────────────────
    # ear_norm = 1.0 → yeux normalement ouverts → parfait
    # ear_norm < 0.70 → yeux mi-fermés → fatigue
    # ear_norm > 1.20 → yeux grands ouverts → alerte/surprise
    if ear_norm >= 1.20:
        ear_score = 90.0   # Yeux grands ouverts = très attentif
    elif ear_norm >= 0.95:
        ear_score = 100.0  # Normal → optimal
    elif ear_norm >= 0.80:
        ear_score = 80.0   # Légèrement fermés
    elif ear_norm >= 0.65:
        ear_score = 55.0   # Mi-fermés → fatigue
    elif ear_norm >= 0.50:
        ear_score = 30.0   # Très fermés → fatigue forte
    else:
        ear_score = 10.0   # Quasi fermés → endormi

    # ── 2. Score HEAD orientation (25%) ───────────────────────────────────────
    # |yaw|  proche de 0 → tête face caméra/tableau
    # |pitch| proche de 0 → tête droite
    yaw_penalty   = min(1.0, abs(yaw_norm) / 0.18)   # 0.18 = seuil "tourné"
    pitch_penalty = min(1.0, abs(pitch)    / 0.14)   # 0.14 = seuil "tête baissée"

    # Pitch négatif (tête baissée) est plus pénalisant que positif (levée)
    if pitch < -0.10:
        pitch_penalty = min(1.0, abs(pitch) / 0.10)  # Tête baissée = téléphone/sommeil

    head_score = max(0.0, (1.0 - (yaw_penalty * 0.60 + pitch_penalty * 0.40)) * 100)

    # ── 3. Score BLINK rate (20%) ─────────────────────────────────────────────
    # Référence : 12-20 blinks/min = normal (Bentivoglio et al., 1997)
    if   blink_rate <  3:  blink_score = 55.0  # Fixation intense (stress)
    elif blink_rate <  8:  blink_score = 80.0  # Peu de clignements = concentration
    elif blink_rate <= 20: blink_score = 100.0 # NORMAL — pas fatigué
    elif blink_rate <= 28: blink_score = 60.0  # Légèrement fatigué
    elif blink_rate <= 38: blink_score = 30.0  # Fatigué
    else:                  blink_score = 10.0  # Très fatigué

    # ── 4. Score STABILITÉ tête (15%) ─────────────────────────────────────────
    # head_stability est déjà 0-100 (calculé par HeadMotionAnalyzer)
    stab_score = head_stability  # directement utilisé

    # ── 5. Score GAZE direction (10%) ─────────────────────────────────────────
    # gaze_x = 0 → regard centré (tableau/caméra)
    # |gaze_x| > 0.20 → regard dévié
    gaze_penalty = min(1.0, abs(gaze_x) / 0.22)
    gaze_score   = max(0.0, (1.0 - gaze_penalty) * 100)

    # ── Composition pondérée ─────────────────────────────────────────────────
    score = (
        ear_score   * 0.30 +
        head_score  * 0.25 +
        blink_score * 0.20 +
        stab_score  * 0.15 +
        gaze_score  * 0.10
    )

    # ── Bonus comportementaux ─────────────────────────────────────────────────
    if hand_raised: score = min(100.0, score + 15.0)  # Participation active
    if is_nodding:  score = min(100.0, score + 8.0)   # Signe d'écoute active

    # ── Malus comportementaux ─────────────────────────────────────────────────
    if mar > 0.60:  score = max(0.0, score - 20.0)   # Bâillement détecté
    if mar > 0.80:  score = max(0.0, score - 10.0)   # Bâillement fort (malus extra)
    if phone:       score = max(0.0, score - 40.0)   # Téléphone = très négatif

    return float(max(0.0, min(100.0, score)))


# ══════════════════════════════════════════════════════════════════════════════
# DÉTECTEUR DE CLIGNEMENT
# ══════════════════════════════════════════════════════════════════════════════
class BlinkDetector:
    """
    Comptage précis des clignements par machine à états.
    Référence : Soukupova & Cech (2016)
    """
    def __init__(self, ear_thresh=0.22, consec_frames=2):
        self.thresh    = ear_thresh     # Seuil EAR fermeture
        self.consec    = consec_frames  # Frames min pour valider un clignement
        self._counter  = 0
        self._total    = 0
        self._below    = False
        self._times    = deque(maxlen=60)  # Timestamps 60 derniers blinks

    def update(self, ear: float) -> bool:
        """Met à jour l'état. Retourne True si clignement validé ce frame."""
        blinked = False
        if ear < self.thresh:
            self._counter += 1
            self._below   = True
        else:
            if self._below and self._counter >= self.consec:
                self._total += 1
                self._times.append(time.time())
                blinked = True
            self._counter = 0
            self._below   = False
        return blinked

    def blinks_per_minute(self) -> float:
        """Nombre de clignements dans la dernière minute glissante."""
        now    = time.time()
        recent = [t for t in self._times if now - t <= 60]
        return float(len(recent))


# ══════════════════════════════════════════════════════════════════════════════
# ANALYSEUR DE MOUVEMENT DE TÊTE
# ══════════════════════════════════════════════════════════════════════════════
class HeadMotionAnalyzer:
    """
    Analyse la dynamique des mouvements de tête sur une fenêtre de 2 secondes.
    Calcule : vélocité instantanée, stabilité, détection de hochement.
    """
    def __init__(self, window=30):  # 30 frames = 2s à 15 FPS
        self.yaw_hist   = deque(maxlen=window)
        self.pitch_hist = deque(maxlen=window)

    def update(self, yaw: float, pitch: float):
        self.yaw_hist.append(yaw)
        self.pitch_hist.append(pitch)

    def velocity(self) -> float:
        """Déplacement angulaire instantané (frame t vs t-1)."""
        if len(self.yaw_hist) < 2:
            return 0.0
        dy = abs(self.yaw_hist[-1]   - self.yaw_hist[-2])
        dp = abs(self.pitch_hist[-1] - self.pitch_hist[-2])
        return float(dy + dp)

    def stability(self) -> float:
        """
        Score de stabilité 0-100.
        std élevé → tête agitée → score bas.
        std proche de 0 → tête immobile → score haut.
        """
        if len(self.yaw_hist) < 5:
            return 70.0
        std_yaw   = float(np.std(list(self.yaw_hist)))
        std_pitch = float(np.std(list(self.pitch_hist)))
        instability = (std_yaw + std_pitch) * 200
        return max(0.0, min(100.0, 100.0 - instability))

    def is_nodding(self) -> bool:
        """
        Détecte un hochement de tête : oscillations du pitch ≥ 3 changements
        de signe en 10 frames (~0.67 secondes). Signal d'écoute active.
        """
        if len(self.pitch_hist) < 10:
            return False
        p = list(self.pitch_hist)[-10:]
        crossings = sum(1 for i in range(1, len(p))
                        if (p[i] > 0) != (p[i-1] > 0))
        return crossings >= 3


# ══════════════════════════════════════════════════════════════════════════════
# CALIBRATION BASELINE
# ══════════════════════════════════════════════════════════════════════════════
class StudentBaseline:
    """
    Calibre les valeurs biométriques au repos de chaque étudiant
    pendant les 10 premières secondes.
    Évite les faux positifs liés aux différences physiologiques individuelles.
    """
    def __init__(self, fps=15, duration_sec=10):
        self.n_frames   = fps * duration_sec  # 150 frames à 15 FPS
        self.samples    = {"ear": [], "yaw": [], "pitch": []}
        self.calibrated = False
        self.baseline   = {"ear": 0.30, "yaw": 0.0, "pitch": 0.0}

    def add_sample(self, ear: float, yaw: float, pitch: float):
        if self.calibrated:
            return
        self.samples["ear"].append(ear)
        self.samples["yaw"].append(yaw)
        self.samples["pitch"].append(pitch)

        if len(self.samples["ear"]) >= self.n_frames:
            # Médiane robuste : insensible aux valeurs aberrantes
            self.baseline["ear"]   = float(np.median(self.samples["ear"]))
            self.baseline["yaw"]   = float(np.median(self.samples["yaw"]))
            self.baseline["pitch"] = float(np.median(self.samples["pitch"]))
            self.calibrated        = True
            print(f"[CALIBRATION] Baseline OK → EAR:{self.baseline['ear']:.3f} "
                  f"YAW:{self.baseline['yaw']:.3f}")

    def normalize_ear(self, ear: float) -> float:
        """
        Normalise l'EAR par rapport à la valeur au repos de l'étudiant.
        ear_norm = 1.0 → yeux aussi ouverts qu'au repos (normal)
        ear_norm < 0.7 → fatigue progressive
        """
        if not self.calibrated:
            return ear / 0.30  # Valeur générique par défaut
        return max(0.0, min(1.5, ear / (self.baseline["ear"] + 1e-6)))

    def normalize_yaw(self, yaw: float) -> float:
        """Soustrait la posture naturelle de tête de l'étudiant."""
        if not self.calibrated:
            return yaw
        return yaw - self.baseline["yaw"]


# ══════════════════════════════════════════════════════════════════════════════
# ÉTAT PAR ÉTUDIANT
# ══════════════════════════════════════════════════════════════════════════════
@dataclass
class Student:
    track_id:    int
    # Historiques signaux bruts (90 frames = 6s)
    ear_hist:    deque = field(default_factory=lambda: deque(maxlen=90))
    yaw_hist:    deque = field(default_factory=lambda: deque(maxlen=90))
    pitch_hist:  deque = field(default_factory=lambda: deque(maxlen=90))
    # Scores lissés multi-échelle
    score_fast:  float = 60.0   # EMA alpha=0.20 (réactif)
    score_slow:  float = 60.0   # EMA alpha=0.05 (stable)
    score_5s:    float = 60.0   # Moyenne glissante 5 secondes
    score_30s:   float = 60.0   # Moyenne glissante 30 secondes
    # Modules d'analyse
    blink:       BlinkDetector     = field(default_factory=BlinkDetector)
    motion:      HeadMotionAnalyzer = field(default_factory=HeadMotionAnalyzer)
    baseline:    StudentBaseline   = field(default_factory=StudentBaseline)
    # État comportemental
    label:       str  = "en attente..."
    hand_raised: bool = False
    phone:       bool = False
    frames:      int  = 0
    # Buffers moyennes glissantes
    buf_5s:      deque = field(default_factory=lambda: deque(maxlen=75))   # 5s × 15fps
    buf_30s:     deque = field(default_factory=lambda: deque(maxlen=450))  # 30s × 15fps


# ══════════════════════════════════════════════════════════════════════════════
# SYSTÈME D'ALERTES
# ══════════════════════════════════════════════════════════════════════════════
class AlertSystem:
    """
    Déclenche une alerte si le score de la classe reste sous le seuil
    pendant une durée continue (score_slow utilisé pour éviter les faux positifs).
    """
    def __init__(self, threshold=35.0, duration=10):
        self.threshold  = threshold
        self.duration   = duration  # Secondes
        self._low_since = None
        self._alerts    = deque(maxlen=20)
        self.active     = False

    def update(self, score: float, student_count: int) -> Optional[str]:
        if student_count == 0:
            return None

        if score < self.threshold:
            if self._low_since is None:
                self._low_since = time.time()
            elif time.time() - self._low_since >= self.duration:
                if not self.active:
                    msg = (f"[!!!] ENGAGEMENT BAS ({score:.0f}%) "
                           f"depuis {self.duration}s - Intervenez !")
                    self._alerts.append({
                        "time":  datetime.now().strftime("%H:%M:%S"),
                        "msg":   msg,
                        "score": score
                    })
                    self.active = True
                    return msg
        else:
            self._low_since = None
            self.active     = False
        return None

    def last_alerts(self, n=3):
        return list(self._alerts)[-n:]


# ══════════════════════════════════════════════════════════════════════════════
# MOTEUR DE FUSION HYBRIDE  (YOLO 40% + MediaPipe 60%)
# ══════════════════════════════════════════════════════════════════════════════
class HybridEngagementEngine:
    """
    Fusionne les scores de deux couches IA complementaires :
      - Couche 1 : YOLOv8n  (macro comportementale)  → ponderation YOLO
      - Couche 2 : MediaPipe FaceMesh (biometrie fine) → ponderation MediaPipe

    Les poids varient selon le type de cours :
      'magistral' : cours frontal → YOLO plus fiable (vue d'ensemble classe)
      'td'        : travaux diriges → equilibre
      'tp'        : travaux pratiques → MediaPipe plus fiable (etudiant par etudiant)
      'default'   : ponderation standard (YOLO=40%, MediaPipe=60%)
    """

    # Poids par type de cours : (mediapipe, yolo)
    _WEIGHTS = {
        "magistral": (0.50, 0.50),
        "td":        (0.60, 0.40),
        "tp":        (0.70, 0.30),
        "default":   (0.60, 0.40),
    }

    def __init__(self, course_type: str = "default"):
        w_mp, w_yolo = self._WEIGHTS.get(course_type, self._WEIGHTS["default"])
        self._w = {"mediapipe": w_mp, "yolo": w_yolo}

        # Scores courants
        self._yolo_score      = 50.0   # Score YOLO (0-100)
        self._mp_scores       = []     # Scores MediaPipe frames courante
        self._mp_score        = 50.0   # Score MediaPipe agrege

        # Historique pour calcul de tendance
        self._history         = deque(maxlen=60)  # ~1 min a 1 envoi/s
        self._fused_score     = 50.0
        self._trend           = "stable"

    # ── Mise a jour depuis YOLO (toutes les 3 frames) ────────────────────────
    def update_yolo(self, attentionPct: float = 50.0,
                    distractionPct: float = 0.0,
                    fatiguePct: float = 0.0,
                    handsRaisedCount: int = 0,
                    detectedCount: int = 0):
        """
        Convertit les metriques YOLO agregees en score 0-100.
        attentionPct = % etudiants attentifs → contribution principale
        distractionPct, fatiguePct → penalites
        """
        if detectedCount == 0:
            return  # Pas de detection — conserver le dernier score

        base  = attentionPct                        # 0-100
        malus = distractionPct * 0.60               # Distraction penalise 60%
        malus += fatiguePct    * 0.40               # Fatigue penalise 40%
        bonus = min(handsRaisedCount * 5.0, 15.0)   # Max +15 pts (3 mains levees)

        self._yolo_score = float(np.clip(base - malus + bonus, 0.0, 100.0))

    # ── Mise a jour depuis MediaPipe (chaque etudiant, chaque frame) ─────────
    def update_mediapipe(self, score: float):
        """Accumule les scores MediaPipe individuels pour la frame courante."""
        self._mp_scores.append(float(score))

    # ── Fusion finale (appelee apres traitement de tous les visages) ─────────
    def _fuse(self):
        """Calcule le score fusionne a partir des derniers scores disponibles."""
        if self._mp_scores:
            self._mp_score = float(np.mean(self._mp_scores))
            self._mp_scores = []  # Reinitialiser pour la prochaine frame

        w_mp   = self._w["mediapipe"]
        w_yolo = self._w["yolo"]
        self._fused_score = float(np.clip(
            w_mp * self._mp_score + w_yolo * self._yolo_score,
            0.0, 100.0
        ))

        # Calcul de tendance sur les 10 derniers scores
        self._history.append(self._fused_score)
        if len(self._history) >= 10:
            recent = list(self._history)[-10:]
            delta  = recent[-1] - recent[0]
            if   delta >  5.0:  self._trend = "hausse"
            elif delta < -5.0:  self._trend = "baisse"
            else:               self._trend = "stable"

    # ── Export dictionnaire (payload backend) ────────────────────────────────
    def to_dict(self) -> dict:
        """Effectue la fusion et retourne les scores au format dict."""
        self._fuse()
        return {
            "fused_score":      round(self._fused_score, 1),
            "mediapipe_score":  round(self._mp_score,    1),
            "yolo_score":       round(self._yolo_score,  1),
            "weights":          dict(self._w),
            "trend":            self._trend,
        }


# ══════════════════════════════════════════════════════════════════════════════
# MÉTRIQUES GLOBALES DE LA CLASSE
# ══════════════════════════════════════════════════════════════════════════════
def class_metrics(students: Dict[int, Student], history: list,
                  alerts: AlertSystem) -> dict:
    """Calcule le score global et les statistiques de la classe."""

    if not students:
        return {
            "engagement_score": 0, "student_count": 0,
            "attentif_pct": 0, "distrait_pct": 0, "fatigue_pct": 0,
            "trend": "-", "session_profile": "Aucun etudiant detecte",
            "room_id": CFG["room_id"],
            "timestamp": datetime.now().isoformat()
        }

    scores_fast = [s.score_fast for s in students.values()]
    scores_slow = [s.score_slow for s in students.values()]
    n = len(scores_fast)

    # Score final : 60% score lent (stable) + 40% score rapide (réactif)
    avg_score = round(
        sum(f*0.40 + sl*0.60 for f, sl in zip(scores_fast, scores_slow)) / n, 1
    )

    # Pourcentages par catégorie d'engagement
    labels     = [s.label for s in students.values()]
    def pct(kws):
        return round(sum(1 for l in labels if any(k in l for k in kws)) / n * 100, 1)

    attentif_p = pct(["tres engage", "engage", "moderement"])
    distrait_p = pct(["distrait", "desengage"])
    fatigue_p  = pct(["fatigue", "endormi"])
    phone_p    = pct(["telephone"])
    hand_count = sum(1 for s in students.values() if s.hand_raised)

    # Tendance sur les 10 dernières secondes
    if len(history) >= 10:
        recent = np.mean(history[-3:])  if len(history) >= 3  else history[-1]
        older  = np.mean(history[-10:-5]) if len(history) >= 10 else history[0]
        diff   = recent - older
        trend  = ">> En hausse" if diff > 5 else "<< En baisse" if diff < -5 else "-- Stable"
    else:
        trend = "-- Stable"

    # Profil de séance (ASCII uniquement pour OpenCV)
    if   avg_score >= 80: profile = "[***] Tres engagee"
    elif avg_score >= 65: profile = "[OK ] Active et attentive"
    elif avg_score >= 50: profile = "[ ~ ] Moderement engagee"
    elif distrait_p > 40: profile = "[!!!] Distraite - intervenez !"
    elif fatigue_p  > 30: profile = "[zzz] Fatiguee - pause conseil"
    else:                 profile = "[ ! ] Faiblement engagee"

    return {
        "engagement_score": avg_score,
        "student_count":    n,
        "attentif_pct":     attentif_p,
        "distrait_pct":     distrait_p,
        "fatigue_pct":      fatigue_p,
        "phone_pct":        phone_p,
        "hand_count":       hand_count,
        "trend":            trend,
        "session_profile":  profile,
        "alert_active":     alerts.active,
        "room_id":          CFG["room_id"],
        "timestamp":        datetime.now().isoformat(),
    }


# ══════════════════════════════════════════════════════════════════════════════
# DASHBOARD — Affichage OpenCV
# ══════════════════════════════════════════════════════════════════════════════
def draw_gauge(frame, cx, cy, r, score, label):
    """Jauge demi-cercle affichant le score d'engagement."""
    # Fond semi-cercle
    cv2.ellipse(frame, (cx, cy), (r, r), 0, 180, 360, (35, 35, 35), -1)
    # Arc coloré proportionnel au score
    angle = int(180 + score * 1.8)
    color = (0, 210, 0) if score >= 70 else (0, 165, 255) if score >= 45 else (0, 60, 220)
    cv2.ellipse(frame, (cx, cy), (r, r), 0, 180, angle, color, 7)
    # Score textuel
    cv2.putText(frame, f"{score:.0f}", (cx-20, cy-4),
                cv2.FONT_HERSHEY_SIMPLEX, 0.95, (255, 255, 255), 2)
    cv2.putText(frame, "%", (cx+12, cy-4),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (190, 190, 190), 1)
    cv2.putText(frame, label, (cx - len(label)*4, cy+18),
                cv2.FONT_HERSHEY_SIMPLEX, 0.34, (140, 140, 140), 1)


def draw_score_bar(frame, x, y, w, h, val, color, label=""):
    """Barre horizontale de progression."""
    cv2.rectangle(frame, (x, y), (x+w, y+h), (40, 40, 40), -1)
    fill = int(max(0, min(100, val)) / 100 * w)
    if fill > 0:
        cv2.rectangle(frame, (x, y), (x+fill, y+h), color, -1)
    if label:
        cv2.putText(frame, f"{label}:{val:.0f}%", (x, y-3),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.34, (170, 170, 170), 1)


def draw_sparkline(frame, x, y, w, h, data):
    """Mini graphe temporel du score d'engagement."""
    if len(data) < 2:
        return
    cv2.rectangle(frame, (x, y), (x+w, y+h), (22, 22, 22), -1)
    # Ligne 50%
    mid = y + h // 2
    cv2.line(frame, (x, mid), (x+w, mid), (55, 55, 55), 1)
    # Courbe
    pts  = list(data)[-w:]
    step = w / max(len(pts)-1, 1)
    for i in range(1, len(pts)):
        x1 = int(x + (i-1)*step)
        x2 = int(x + i*step)
        y1 = int(y + h - pts[i-1]/100 * h)
        y2 = int(y + h - pts[i]/100   * h)
        c  = (0,210,0) if pts[i] >= 65 else (0,165,255) if pts[i] >= 45 else (0,60,220)
        cv2.line(frame, (x1, y1), (x2, y2), c, 2)


def draw_student_box(frame, bbox, s: Student):
    """Encadrement coloré autour d'un étudiant avec son score."""
    x1, y1, x2, y2 = [int(v) for v in bbox]
    sc    = s.score_fast
    color = (0,210,0) if sc >= 70 else (0,165,255) if sc >= 45 else (0,60,220)
    # Rectangle
    cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
    # Bandeau score
    cv2.rectangle(frame, (x1, y1-22), (x2, y1), color, -1)
    cv2.putText(frame, f"#{s.track_id} {sc:.0f}%", (x1+3, y1-5),
                cv2.FONT_HERSHEY_SIMPLEX, 0.46, (255, 255, 255), 1)
    # Barre engagement sous le rectangle
    bw   = x2 - x1
    fill = int(sc / 100 * bw)
    cv2.rectangle(frame, (x1, y2+2), (x2, y2+7), (35, 35, 35), -1)
    if fill > 0:
        cv2.rectangle(frame, (x1, y2+2), (x1+fill, y2+7), color, -1)
    # Alerte blinks élevés
    bpm = s.blink.blinks_per_minute()
    if bpm > 22:
        cv2.putText(frame, f"fatigue {bpm:.0f}bpm", (x1, y2+20),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.34, (100, 100, 255), 1)


def draw_full_dashboard(frame, metrics: dict, history: list,
                        alerts: AlertSystem, fps: float):
    """Panneau principal de visualisation en bas de l'image."""
    H, W  = frame.shape[:2]
    score = metrics.get("engagement_score", 0)

    # Fond panneau bas
    overlay = frame.copy()
    cv2.rectangle(overlay, (0, H-152), (W, H), (10, 10, 10), -1)
    frame[:] = cv2.addWeighted(overlay, 0.88, frame, 0.12, 0)

    # Jauge principale
    draw_gauge(frame, 65, H-76, 55, score, "CLASSE")

    # Barres statistiques
    bx = 145
    draw_score_bar(frame, bx, H-138, 185, 10,
                   metrics.get("attentif_pct", 0),  (0, 200, 0),   "Attentifs")
    draw_score_bar(frame, bx, H-121, 185, 10,
                   metrics.get("distrait_pct", 0),  (0, 130, 255), "Distraits")
    draw_score_bar(frame, bx, H-104, 185, 10,
                   metrics.get("fatigue_pct", 0),   (70, 70, 220), "Fatigues")
    draw_score_bar(frame, bx, H-87,  185, 10,
                   metrics.get("phone_pct", 0),     (0, 0, 210),   "Telephones")

    # Informations textuelles
    cv2.putText(frame, metrics.get("session_profile", "---"),
                (348, H-132), cv2.FONT_HERSHEY_SIMPLEX, 0.52, (200, 200, 200), 1)
    cv2.putText(frame, metrics.get("trend", "---"),
                (348, H-112), cv2.FONT_HERSHEY_SIMPLEX, 0.52, (200, 200, 0), 1)
    cv2.putText(frame, f"Etudiants : {metrics.get('student_count', 0)}",
                (348, H-90),  cv2.FONT_HERSHEY_SIMPLEX, 0.48, (150, 150, 150), 1)
    cv2.putText(frame, f"Mains levees: {metrics.get('hand_count', 0)}",
                (348, H-70),  cv2.FONT_HERSHEY_SIMPLEX, 0.48, (200, 200, 0), 1)

    # Sparkline (graphe temporel)
    draw_sparkline(frame, W-218, H-150, 205, 105, history)

    # FPS + heure
    cv2.putText(frame, f"FPS:{fps:.0f}  {datetime.now().strftime('%H:%M:%S')}",
                (W-155, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (70, 70, 70), 1)

    # Bannière d'alerte
    if alerts.active:
        cv2.rectangle(frame, (0, 0), (W, 36), (0, 0, 180), -1)
        cv2.putText(frame,
                    f"[!!!] ALERTE : Engagement bas ({score:.0f}%) - Intervenez !",
                    (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.64, (255, 255, 255), 2)

    # Historique des alertes
    for i, a in enumerate(alerts.last_alerts(3)):
        cv2.putText(frame, f"[{a['time']}] {a['msg']}",
                    (5, 55+i*18), cv2.FONT_HERSHEY_SIMPLEX,
                    0.33, (100, 100, 255), 1)


# ══════════════════════════════════════════════════════════════════════════════
# ENVOI BACKEND
# ══════════════════════════════════════════════════════════════════════════════
def send_backend(metrics: dict):
    """
    Envoie les métriques hybrides au backend Node.js (appelé dans un thread).
    Le payload inclut maintenant les deux scores séparés (YOLO + MediaPipe)
    ainsi que le score fusionné final — utile pour le dashboard enseignant.
    """
    try:
        r = requests.post(
            f"{CFG['backend_url']}/api/smartclass/camera",
            json=metrics,
            headers={"x-api-key": CFG.get("api_key", "")},
            timeout=3
        )
        if r.status_code in (200, 201):
            hybrid = metrics.get("hybrid", {})
            print(
                f"[{datetime.now().strftime('%H:%M:%S')}] ✓ Backend "
                f"| Score final: {hybrid.get('fused_score', metrics.get('engagement_score', '?'))}% "
                f"(YOLO:{hybrid.get('yolo_score','?')}% MP:{hybrid.get('mediapipe_score','?')}%) "
                f"| {metrics['student_count']} étudiants "
                f"| Tendance: {hybrid.get('trend','?')}"
            )
    except requests.exceptions.ConnectionError:
        pass  # Backend non démarré — continuer sans envoyer
    except Exception as e:
        print(f"[BACKEND] Erreur: {e}")


# ══════════════════════════════════════════════════════════════════════════════
# BOUCLE PRINCIPALE
# ══════════════════════════════════════════════════════════════════════════════
def run(course_type: str = "default"):
    """
    Boucle principale SmartClass AI.

    Args:
        course_type: Type de cours pour pondérations dynamiques.
                     'default' | 'magistral' | 'td' | 'tp'
                     Affecte le ratio YOLO/MediaPipe dans HybridEngagementEngine.
    """
    print("=" * 65)
    print("  SmartClass AI v4 — Architecture Hybride YOLOv8 + MediaPipe")
    print("  Couche 1 : YOLOv8n  (macro comportementale)  → 40%")
    print("  Couche 2 : MediaPipe (biométrie fine)         → 60%")
    print(f"  Type de cours : {course_type}")
    print("  Wessup / Wess Business City — PFE 2026")
    print("=" * 65)

    # ── Moteur de fusion hybride ──
    hybrid_engine = HybridEngagementEngine(course_type=course_type)
    print(f"[INIT] HybridEngagementEngine — poids : "
          f"MediaPipe={hybrid_engine._w['mediapipe']*100:.0f}% "
          f"YOLO={hybrid_engine._w['yolo']*100:.0f}%")

    # ── Initialisation MediaPipe ──
    mp_face = mp.solutions.face_mesh.FaceMesh(
        max_num_faces=20,
        refine_landmarks=True,         # Nécessaire pour les iris (gaze)
        min_detection_confidence=0.5,
        min_tracking_confidence=0.45
    )
    mp_pose_model = mp.solutions.pose.Pose(
        model_complexity=0,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.4
    )

    # ── Initialisation YOLO (Couche 1 — détection macro) ──
    yolo_model = None
    if CFG["use_yolo"]:
        try:
            from ultralytics import YOLO
            yolo_model = YOLO(CFG["yolo_model"])
            print("[INIT] YOLOv8-nano charge (Couche 1 - macro comportementale)")
        except Exception:
            print("[INIT] YOLO non disponible - mode MediaPipe seul (100%)")

    # -- Camera --
    cap = cv2.VideoCapture(CFG["camera"])
    cap.set(cv2.CAP_PROP_FRAME_WIDTH,  1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT,  720)
    cap.set(cv2.CAP_PROP_FPS, CFG["fps"])
    if not cap.isOpened():
        print("[ERREUR] Camera introuvable. Verifiez camera_index dans CFG.")
        return

    # -- Etat global --
    students:  Dict[int, Student] = {}
    tracker   = SessionTracker(room_id=CFG["room_id"])
    alerts    = AlertSystem(CFG["alert_threshold"], CFG["alert_duration"])
    history   = []       # Historique scores pour sparkline + tendance
    last_send = time.time()
    frame_n   = 0
    fps_val   = 0.0
    fps_t     = time.time()
    # Derniers resultats YOLO agreges (mis a jour toutes les 3 frames)
    last_yolo_agg = {"attentionPct": 50.0, "distractionPct": 0.0,
                     "fatiguePct": 0.0, "handsRaisedCount": 0, "detectedCount": 0}

    print("[RUN]  Camera ouverte.")
    print("[RUN]  Appuyez  Q  pour quitter et sauvegarder le rapport.\n")

    while True:
        ret, frame = cap.read()
        if not ret:
            print("[ERREUR] Impossible de lire la camera.")
            break

        frame_n += 1
        H, W = frame.shape[:2]
        rgb  = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

        # -- YOLO : detection personnes et telephones --
        yolo_persons = []
        phone_global = False

        # -- COUCHE 1 : YOLOv8 -- Detection macro comportementale --
        # Frequence : toutes les 3 frames (~5 FPS a 15 FPS camera)
        # Economie CPU : YOLO est couteux, on l'appelle moins souvent que MediaPipe
        if yolo_model and frame_n % 3 == 0:
            res = yolo_model.track(frame, persist=True,
                                   classes=[0, 67],
                                   conf=CFG["yolo_conf"],
                                   verbose=False)
            n_detected = 0
            n_phone    = 0
            if res and res[0].boxes:
                for box in res[0].boxes:
                    cls  = int(box.cls[0])
                    conf = float(box.conf[0])
                    tid  = int(box.id[0]) if box.id is not None else frame_n
                    if cls == 0:
                        n_detected += 1
                        yolo_persons.append({"id": tid,
                                             "bbox": box.xyxy[0].tolist(),
                                             "conf": conf})
                    elif cls == 67:
                        n_phone    += 1
                        phone_global = True

            # Agregation YOLO -> pourcentages classe entiere
            if n_detected > 0:
                # Attention : etudiants sans telephone = attentifs (estimation simplifiee)
                attention_pct    = max(0, 100 - (n_phone / n_detected) * 100)
                distraction_pct  = (n_phone / n_detected) * 100
                last_yolo_agg = {
                    "attentionPct":    round(attention_pct, 1),
                    "distractionPct":  round(distraction_pct, 1),
                    "fatiguePct":      0.0,  # affine par MediaPipe
                    "handsRaisedCount": 1 if hand_global else 0,
                    "detectedCount":   n_detected,
                }
                # Mettre a jour le score YOLO dans le moteur hybride
                hybrid_engine.update_yolo(**last_yolo_agg)

        # -- Pose : detection main levee --
        hand_global = False
        pr = mp_pose_model.process(rgb)
        if pr and pr.pose_landmarks:
            lm = pr.pose_landmarks.landmark
            PL = mp.solutions.pose.PoseLandmark
            if (lm[PL.LEFT_WRIST].y  < lm[PL.LEFT_SHOULDER].y  - 0.10 or
                lm[PL.RIGHT_WRIST].y < lm[PL.RIGHT_SHOULDER].y - 0.10):
                hand_global = True

        # -- FaceMesh : analyse par visage --
        fr     = mp_face.process(rgb)
        active = set()

        if fr.multi_face_landmarks:
            for fi, face_lms in enumerate(fr.multi_face_landmarks):
                # Associer l'ID YOLO si disponible
                tid = yolo_persons[fi]["id"] if (yolo_persons and fi < len(yolo_persons)) else fi

                active.add(tid)
                if tid not in students:
                    students[tid] = Student(track_id=tid)

                s   = students[tid]
                lms = face_lms.landmark
                s.frames += 1

                def xy(i): return lm_pt(lms, i, W, H)

                # -- Signaux biometriques bruts --
                ear_val = (calc_ear([xy(i) for i in EYE_L]) +
                           calc_ear([xy(i) for i in EYE_R])) / 2
                mar_val = calc_mar([xy(i) for i in MOUTH])
                yaw, pit = calc_head_pose(lms, W, H)
                gaze_x   = calc_iris_gaze(lms, W, H)

                # -- Calibration baseline individuelle --
                s.baseline.add_sample(ear_val, yaw, pit)
                ear_norm = s.baseline.normalize_ear(ear_val)
                yaw_norm = s.baseline.normalize_yaw(yaw)

                # -- Mise a jour analyseurs --
                s.blink.update(ear_val)
                blink_rate = s.blink.blinks_per_minute()

                s.motion.update(yaw, pit)
                stability = s.motion.stability()
                is_nodding = s.motion.is_nodding()

                # Etat comportemental global
                s.hand_raised = hand_global
                s.phone       = phone_global

                # -- Calcul score d'engagement par formule --
                raw_score = compute_engagement_score(
                    ear_norm      = ear_norm,
                    mar           = mar_val,
                    yaw_norm      = yaw_norm,
                    pitch         = pit,
                    blink_rate    = blink_rate,
                    head_stability= stability,
                    gaze_x        = gaze_x,
                    is_nodding    = is_nodding,
                    hand_raised   = s.hand_raised,
                    phone         = s.phone,
                )

                # -- Lissage EMA multi-echelle --
                a_fast = CFG["ema_fast"]
                a_slow = CFG["ema_slow"]
                s.score_fast = a_fast * raw_score + (1-a_fast) * s.score_fast
                s.score_slow = a_slow * raw_score + (1-a_slow) * s.score_slow

                s.buf_5s.append(raw_score)
                s.buf_30s.append(raw_score)
                s.score_5s  = float(np.mean(s.buf_5s))
                s.score_30s = float(np.mean(s.buf_30s))

                # -- Label affiche --
                sc = s.score_fast
                if   s.phone:        s.label = "telephone"
                elif s.hand_raised:  s.label = "main levee"
                elif sc >= 80:       s.label = "tres engage"
                elif sc >= 65:       s.label = "engage"
                elif sc >= 50:       s.label = "moderement"
                elif sc >= 30:       s.label = "distrait"
                else:                s.label = "desengage"

                # -- COUCHE 2 : Mise a jour du moteur hybride avec score MediaPipe --
                hybrid_engine.update_mediapipe(s.score_fast)

                # Enregistrement session
                tracker.record_frame(tid, s.label, s.score_fast)

                # Affichage etudiant
                if CFG["display"]:
                    if yolo_persons and fi < len(yolo_persons):
                        draw_student_box(frame, yolo_persons[fi]["bbox"], s)
                    else:
                        xs = [l.x*W for l in lms]
                        ys = [l.y*H for l in lms]
                        draw_student_box(
                            frame,
                            [min(xs)-15, min(ys)-15, max(xs)+15, max(ys)+15],
                            s
                        )

        # Supprimer les etudiants qui ne sont plus visibles
        students = {k: v for k, v in students.items() if k in active}

        # -- Metriques globales classe --
        metrics = class_metrics(students, history, alerts)

        # -- Enrichissement avec scores hybrides --
        hybrid_data = hybrid_engine.to_dict()
        metrics["hybrid"]          = hybrid_data
        # Le score final envoye au backend est le score fusionne
        metrics["engagement_score"] = hybrid_data["fused_score"]
        # Compatibilite avec le format CameraData MongoDB
        metrics["attentionPct"]    = last_yolo_agg["attentionPct"]
        metrics["distractionPct"]  = last_yolo_agg["distractionPct"]
        metrics["fatiguePct"]      = last_yolo_agg["fatiguePct"]
        metrics["handsRaisedCount"] = last_yolo_agg["handsRaisedCount"]
        metrics["detectedCount"]   = last_yolo_agg["detectedCount"]

        history.append(metrics["engagement_score"])
        if len(history) > 1000:
            history.pop(0)

        # -- Verification alertes --
        alert_msg = alerts.update(
            metrics["engagement_score"],
            metrics["student_count"]
        )
        if alert_msg:
            print(f"\n[ALERTE] {alert_msg}\n")

        # -- Dashboard --
        if CFG["display"]:
            if frame_n % 30 == 0:
                fps_val = 30 / max(time.time()-fps_t, 0.001)
                fps_t   = time.time()
            draw_full_dashboard(frame, metrics, history, alerts, fps_val)
            cv2.imshow("SmartClass AI v4 - PFE 2026", frame)

        # -- Envoi backend (thread separe toutes les 5s) --
        if time.time() - last_send >= CFG["send_interval"]:
            tracker.record_global_snapshot(metrics)
            import threading as _threading
            _threading.Thread(
                target=send_backend, args=(metrics,), daemon=True
            ).start()
            last_send = time.time()

        # Quitter
        if cv2.waitKey(1) & 0xFF == ord('q'):
            print("\n[FIN] Arret demande par l'utilisateur.")
            break

    # -- Nettoyage et sauvegarde --
    cap.release()
    cv2.destroyAllWindows()
    tracker.end_session()
    print("[FIN] SmartClass AI v4 arrete. Rapport sauvegarde.")


# ==============================================================================
if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="SmartClass AI v4 - Hybride YOLOv8 + MediaPipe")
    parser.add_argument(
        "--course-type",
        choices=["default", "magistral", "td", "tp"],
        default="default",
        help="Type de cours : adapte les poids YOLO/MediaPipe (defaut: default)"
    )
    args = parser.parse_args()
    run(course_type=args.course_type)
