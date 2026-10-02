# SmartClass AI · Module YOLO WBC 2026

> Détection d'engagement étudiant en temps réel via **YOLOv8** (webcam professeur).  
> 4 classes comportementales → agrégation KPI backend → Socket.IO → Dashboard en direct.

---

## 🏛️ Architecture du module

```
frontend/teacher-dashboard.html ───────────────────────────────┐
  (1) Bouton ▶ Démarrer session                                │
  (2) POST /api/smartclass/sessions/start  → backend           │
                                                               │
backend/routes/smartclass.js ──────────────────────────────────┤
  (3) Retourne { sessionId, roomId } + API_KEY                │
                                                               │
teacher-dashboard.js                                           │
  (4) POST X-SmartClass-API-Key  http://localhost:5001/start ──┤
      { sessionId, roomId, teacherId, ... }                    │
                                                               │
smartclass-detector-service.py  (Flask :5001) ─────────────────┤
  (5) subprocess.Popen([python, camera_real.py,               │
                         sessionId, roomId, ...])              │
                                                               │
camera_real.py  ───────────────────────────────────────────────┤
  (6) cv2.VideoCapture(0)  →  YOLOv8  best.pt                 │
      → comptage bow/down/lookup/sit                           │
  (7) toutes les 30s : POST {X-API-KEY}                       │
      http://localhost:4000/api/smartclass/camera              │
                                                               │
backend/routes/smartclass.js  ─────────────────────────────────┤
  (8) { X-API-KEY } == SMARTCLASS_API_KEY ? OK : 401          │
  (9) new SmartClassData( kpis ) → save                       │
  (10) io.emit('smartclass:new_data', kpis) ───────────────────┘
       → teacher-dashboard L330 → refresh KPI live
```

---

## 🛠️ Fichiers du dossier

| Fichier | Statut | Usage |
|---|---|---|
| **smartclass-detector-service.py** | ✅ **ACTIF** | Flask :5001 · `/ping` `/start` `/stop` → lance `camera_real.py` en subprocess |
| **camera_real.py** | ✅ **ACTIF** | Capture webcam + YOLOv8 + POST /camera |
| **config.py** | ✅ **ACTIF** | Charge `.env` (WBC_API_BASE, SMARTCLASS_API_KEY, MODEL_PATH, SESSION_FILE) |
| **class_mapping.yaml** | ✅ **RÉFÉRENCE** | Mapping classes YOLO → engagement |
| **requirements.txt** | ✅ **ACTIF** | Dépendances Python |
| **.env.example** | ✅ **TEMPLATE** | Modèle `.env` à copier |
| runs/detect/smartclass/weights/**best.pt** | ✅ **MODÈLE 2026** | 4 classes : bow, down, lookup, sit (NE PAS MODIFIER) |
| ───────────────────────────────── | ──── | ────────────────────────────────── |
| smartclass_camera.py | ⚠️ **LEGACY STANDALONE** | Ancien flux. Utilisable pour DEBUG sans Dashboard. **NE PLUS UTILISER en prod** |
| start_session.py | ⚠️ **LEGACY CASSÉ** | CLI ancienne — manquait TEACHER creds → cassé PAR DESIGN (Q6 sécurité WBC) |
| train.py / retrain_balanced.py / prepare_dataset.py | 🔧 **ENTRAÎNEMENT FUTUR** | Pour réentraîner best.pt (quand TODO entraînement activé) |
| download_dataset.py | 🔧 | Téléchargement datasets Roboflow |
| test_model.py | 🔧 | Test rapide best.pt sur image |
| camera_sim.py / demo_mode.py | 🔧 | Mode démo sans webcam (test offline) |
| datasets/ + runs/ | 🔧 | Données entraînement + checkpoints YOLO |
| yolov8n.pt / yolov8s.pt | 🔧 | Backbones initiaux (ultralytics) |

---

## 🧠 Mapping classes ↔ engagement (IMMUTABLE)

Fichier : [`class_mapping.yaml`](file:///C:/Users/User/Documents/wessup%20auth%20-%20Copie/smartclass_ai/class_mapping.yaml)

```yaml
# ⚠️ NE PAS MODIFIER — utilisé backend + dashboard
classes:
  lookup: focused        # élève regarde le tableau / le prof → attentif
  sit:    focused        # élève assis tranquillement → attentif
  down:   other          # tête baissée → distraction (téléphone / cahier non-suivi)
  bow:    sleeping       # tête très basse → assoupi / absent
```

**Calcul backend (SmartClassSession/SmartClassData) :**

```
total = lookup + sit + down + bow
focusedPct  = (lookup + sit) / total * 100
otherPct    = (down)           / total * 100
sleepingPct = (bow)            / total * 100

// Broadcast teacher-dashboard (KPI):
attentionPct   = focusedPct
fatiguePct     = sleepingPct
distractionPct = otherPct
```

---

## 🚀 Installation

### 1. Prérequis
- **Python 3.11 ~ 3.12** (recommandé : 3.11.9)
- **Webcam** (OpenCV `cv2.VideoCapture(0)` doit marcher)
- GPU NVIDIA **optionnel** (CUDA 12.x pour Torch + YOLO plus rapide ; sinon CPU fonctionne)

### 2. Virtual env + install

```bash
# Aller dans le module
cd smartclass_ai

# (a) Créer venv s'il n'existe pas
python -m venv .venv

# (b) Activer :
#  Win PowerShell :  .\.venv\Scripts\Activate.ps1
#  Win CMD       :  .\.venv\Scripts\activate.bat
#  macOS / Linux :  source .venv/bin/activate

# (c) Installer TOUT (incluant Torch CPU par défaut)
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

**⚠️ Si vous voulez Torch GPU (NVIDIA)**, lancez plutôt avant `pip install -r` :
```bash
# CUDA 12.4 (recommandé — mars 2025)
pip install torch==2.4.0 torchvision==0.19.0 --index-url https://download.pytorch.org/whl/cu124
# Puis installer le reste normalement
pip install -r requirements.txt
```

### 3. `.env` smartclass_ai/

Copier `.env.example` → `.env` :
```bash
copy .env.example .env
```

Éditer `.env` — **LA CLÉ DOIT CORRESPONDRE EXACTEMENT à `backend/.env`** :
```env
# Base URL backend Node.js
WBC_API_BASE=http://localhost:4000

# Clé SmartClass (identique backend/.env SMARTCLASS_API_KEY)
SMARTCLASS_API_KEY=sc_key_change_me_before_deploy

# Chemin relatif OU absolu du modèle WBC YOLOv8 entrainé
# ⚠️ NE PAS CHANGER le modèle best.pt actuel avant TODO entrainement
MODEL_PATH=runs/detect/smartclass/weights/best.pt
```

---

## ▶️ Démarrage

**Étape 1 — Backend (4000) :**
```bash
cd ../backend
npm run dev
```

**Étape 2 — SmartClass Detector Service (5001) :**
```bash
cd smartclass_ai
python smartclass-detector-service.py
#  => Affiche "✅ Service SmartClass prêt : http://localhost:5001"
```

**Étape 3 — Navigateur :**
- Ouvrir `frontend/teacher-dashboard.html` (port 5500 Live Server)
- S'identifier en professeur
- **Nouvelle session SmartClass** : sélectionner un cours + une salle
- Cliquer **▶ Démarrer la détection** (bouton dashboard)
  → appel `POST localhost:5001/start` → subprocess camera_real.py
  → barre de progression, KPI en direct toutes les 30s
- **⏹ Arrêter** → `POST /stop` → kills subprocess + marque session `completed`

---

## 📡 Routes exposées

### Flask 5001 (Detector Service) — appelé par teacher-dashboard

| Méthode | Endpoint | Body JSON | Réponse |
|---|---|---|---|
| GET | `/ping` | — | `{"ok":true,"status":"idle or running"}` |
| POST | `/start` | `{sessionId, roomId?, teacherId?, className?, courseId?}` | `{"ok":true,"pid":...}` |
| POST | `/stop` | — | `{"ok":true,"stopped":true}` |

### Backend 4000 (/api/smartclass) — appelé par camera_real.py

| Méthode | Endpoint | En-tête obligatoire | Usage |
|---|---|---|---|
| POST | `/api/smartclass/camera` | `x-api-key: <SMARTCLASS_API_KEY>` | Enregistre KPI YOLO + emit `smartclass:new_data` |

Exemple body `/camera` :
```json
{
  "sessionId": "67...1234",
  "roomId": "classA",
  "lookup": 12, "sit": 18, "down": 4, "bow": 1,
  "focusedPct": 75.0,
  "otherPct": 10.0,
  "sleepingPct": 2.5,
  "attentionPct": 75.0,
  "confidence": 0.74,
  "snapshot": "data:image/jpeg;base64,/9j/4AAQ..."
}
```

---

## 🧪 Tests rapides (sans Dashboard)

### (A) Tester modèle best.pt sur une image
```bash
cd smartclass_ai
python test_model.py
```

### (B) Mode démo (pas besoin de webcam)
```bash
python demo_mode.py
# Simule comptages classes → POST /camera toutes les 10s
# (utile pour tester dashboard + socket sans webcam)
```

### (C) Debug camera_real.py en standalone (⚠️ LEGACY)
```bash
# Marche si la session existe DÉJÀ :
python camera_real.py <SESSION_ID> <ROOM_ID>
# Exemple :
python camera_real.py 67...abcd classA
```

---

## 🔐 Sécurité SmartClass

| Règle | Statut | Lieu |
|---|---|---|
| Clé API partout (X-SmartClass-API-Key / x-api-key) | ✅ En place | detector-service + routes/smartclass.js + camera_real.py |
| **Aucun identifiant professeur** dans Python (email/mdp) | ✅ Garanti Q6 WBC | config.py — 0 variable TEACHER_EMAIL / TEACHER_PASSWORD |
| start_session.py cassé par design (ImportError) → pas utilisable | ✅ | (contient juste `⚠️ LEGACY` header docstring) |
| `.env` Gitignoré | ✅ | `.gitignore` |
| ⚠️ SMARTCLASS_API_KEY hardcodée frontend teacher-dashboard.js | 🔴 TODO — déplacer vers endpoint backend | Voir README racine § Sécurité |

---

## 🗺️ Variables utilisées dans le code

| Nom | Fichier | Usage |
|---|---|---|
| `SMARTCLASS_API_KEY` | config.py / .env / .env.example | Auth Flask service ↔ backend ↔ dashboard |
| `WBC_API_BASE` | config.py / .env | Base URL backend (http://localhost:4000) |
| `MODEL_PATH` | config.py / .env | Chemin vers best.pt YOLOv8 |
| `SESSION_FILE` | config.py | `.session_id` (session en cours — persistée côté service) |
| `localhost:5001` | teacher-dashboard.js | Detector service Flask |
| `smartclass:new_data` | backend/routes/smartclass.js + teacher-dashboard.js L330 | Socket.IO broadcast KPI |

---

## 🛣️ Prochaines étapes (TODO entraînement YOLO — quand activé)

1. **Dataset diversifié** : plus d'images (habillages, luminosités, angles, visages multiples)
   → utiliser `prepare_dataset.py` + `download_dataset.py`
2. **Nouvelles classes** : `phone` (téléphone), `writing` (écriture)
3. **Entraînement équilibré** : `retrain_balanced.py` pondérations classes sous-représentées
4. **Fusion biométrique** : YOLO (couche 1) + MediaPipe EAR/GAZE (ai_model/ couche 2)
5. **Déploiement GPU** : Torch CUDA + camera haute résolution
6. **Validation multi-salles** : test vidéo backend (caméra de la salle entière)

→ Quand tout sera prêt : modifier `MODEL_PATH` dans `.env` vers le nouveau `runs/detect/.../best.pt`.

---

## ❓ Dépannage

### ❌ `ModuleNotFoundError: No module named 'ultralytics'`
→ `pip install -r requirements.txt`

### ❌ `ModuleNotFoundError: No module named 'torch'`
→ Torch est trop gros pour PyPI simple. Réinstaller explicitement :
```
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
```

### ❌ `401 Unauthorized` sur POST `/camera` ou `/start`
→ SMARTCLASS_API_KEY n'est **pas identique** entre `smartclass_ai/.env`, `backend/.env`, et `frontend/teacher-dashboard.js`.

### ❌ OpenCV erreur : `(-215:Assertion failed) !_src.empty() in function 'cv::cvtColor'`
→ Webcam inaccessible : caméra occupée / driver Windows / privacy. Essayer `camera_sim.py` ou `demo_mode.py` sans webcam.

### ❌ Flask 5001 démarre pas
→ Port occupé : `netstat -ano | findstr :5001` → tuer le PID.

---

## 📚 Références
- [Ultralytics YOLOv8 Docs](https://docs.ultralytics.com/)
- [Flask (detector service)](https://flask.palletsprojects.com/)
- [OpenCV VideoCapture](https://docs.opencv.org/4.x/d8/dfe/classcv_1_1VideoCapture.html)
- [Pytorch Install](https://pytorch.org/get-started/locally/)
