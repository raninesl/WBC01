# Installation — SmartClass AI v4

## Architecture du module IA

Le module IA repose sur **deux couches complementaires** :

| Couche | Fichier | Technologie | Role |
|--------|---------|-------------|------|
| Couche 1 | `smartclass_ai.py` | MediaPipe FaceMesh + formule mathematique | EAR, MAR, Head Pose, Gaze, Blink — 877 lignes |
| Couche 2 | `../smartclass_ai/smartclass_camera.py` | YOLOv8n fine-tune | Comportement global (bow/down/lookup/sit) |

**Pour la demo PFE : lancer `smartclass_ai.py` (Couche 1 — formule biometrique).**

---

## Prerequis systeme

- **Python 3.10** (recommande — mediapipe 0.10.x incompatible avec Python 3.12+)
- **Conda** (recommande pour isoler l'environnement)
- **Webcam USB** branchee
- **Backend Node.js** en cours d'execution sur `http://localhost:4000`

---

## Installation pas a pas

### Etape 1 — Creer l'environnement conda

```bash
conda create -n smartclass python=3.10 -y
conda activate smartclass
```

### Etape 2 — Installer les dependances

```bash
pip install -r requirements.txt
```

> **Note protobuf :** mediapipe 0.10.x requiert `protobuf<5`.
> Ne pas installer `tensorflow` ou `fer` (conflit de version protobuf).

### Etape 3 — Verifier l'installation

```bash
python -c "import mediapipe; import cv2; import ultralytics; print('OK')"
```

### Etape 4 — Lancer les tests unitaires (optionnel)

```bash
python test_smartclass_ai.py
# Attendu : 14/14 tests passes
```

---

## Lancer le modele

```bash
conda activate smartclass
cd "wessup auth\ai_model"
python smartclass_ai.py
```

La fenetre OpenCV s'ouvre avec :
- Score d'engagement en temps reel (0-100%)
- Jauge demi-cercle + sparkline temporel
- Detection YOLOv8 des comportements (telephone, main levee)
- Envoi automatique au backend toutes les 5 secondes

---

## Configuration

Modifier le bloc `CFG` en haut de `smartclass_ai.py` :

```python
CFG = {
    "camera":          0,             # 0 = webcam USB, 1 = camera externe
    "fps":             15,            # FPS cible (15 recommande)
    "backend_url":     "http://localhost:4000",
    "room_id":         "salle-101",
    "send_interval":   5,             # Secondes entre deux envois backend
    "use_yolo":        True,          # False si pas de webcam performante
    "yolo_model":      "yolov8n.pt",  # Modele YOLO (nano = leger)
    "yolo_conf":       0.45,          # Seuil de confiance YOLO
    "calibration_sec": 10,            # Duree calibration baseline (secondes)
    "ema_fast":        0.20,          # Alpha EMA rapide (reactif)
    "ema_slow":        0.05,          # Alpha EMA lent (stable)
    "alert_threshold": 35.0,          # Score bas declenchant une alerte
    "alert_duration":  10,            # Secondes avant alerte
}
```

---

## Controles clavier (pendant l'execution)

| Touche | Action |
|--------|--------|
| `Q` | Quitter et sauvegarder le rapport de session |
| `R` | Reinitialiser la calibration baseline |
| `S` | Forcer l'envoi immediat au backend |

---

## Resolution des problemes courants

### protobuf conflict
```
ERROR: mediapipe requires protobuf<5, found 6.x
```
**Solution :**
```bash
pip uninstall tensorflow keras fer -y
pip install "protobuf>=4.25.3,<5"
```

### Camera introuvable
```
[ERREUR] Camera introuvable. Verifiez camera_index dans CFG.
```
**Solution :** Changer `"camera": 0` par `"camera": 1` dans CFG.

### YOLOv8 non disponible
Le modele fonctionne sans YOLO (detection MediaPipe seule).
Mettre `"use_yolo": False` dans CFG pour desactiver.

---

## Structure des fichiers

```
ai_model/
├── smartclass_ai.py        # Module principal (Couche 2 biometrique)
├── session_tracker.py      # Suivi multi-etudiant + export CSV/JSON
├── session_report.py       # Generateur de rapport post-session
├── test_smartclass_ai.py   # Tests unitaires (14 tests)
├── requirements.txt        # Dependances Python
├── yolov8n.pt              # Poids YOLO nano (pre-entraine COCO)
├── sessions/               # Rapports de session sauvegardes
└── _legacy/                # Ancien pipeline sklearn (abandonne)
    ├── README.md           # Explication de l'abandon
    ├── collect_dataset.py
    ├── evaluate_model.py
    └── ml_model/           # Modeles pkl obsoletes
```

---

## Sur Raspberry Pi 5

```bash
conda create -n smartclass python=3.10 -y
conda activate smartclass
pip install mediapipe>=0.10.0 opencv-python numpy requests ultralytics python-dotenv
python smartclass_ai.py
```

> Sur Raspberry Pi, mettre `"use_yolo": False` pour economiser les ressources.
> MediaPipe seul suffit pour la detection d'engagement.

---

*Wessup / Wess Business City — SmartClass AI v4 — PFE 2026*
