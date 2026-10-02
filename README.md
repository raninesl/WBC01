# Wessup — Wess Business City (WBC) SmartClass

> Système intelligent de supervision pédagogique en temps réel.
> Projet de Fin d'Études — **2026**

---

## Présentation

**WBC SmartClass** est une plateforme éducative augmentée 100% Web :
- **Hall virtuel 3D** (Three.js) avec avatars animés interactifs (clic → chat privé, présence en temps réel)
- **Classes A/B immersives** (avalanche 3D s'assoient sur des sièges, se lèvent, nom au-dessus de la tête)
- **Détection d'engagement étudiant en direct** via **YOLOv8** (webcam professeur) → 4 classes : `bow / down / lookup / sit`
- **Dashboard professeur** — KPI en direct (focused / other / sleeping), graphiques historiques, alertes
- **Chat global Hall + chat de classe + chat privé (Clic avatar)** + badges unread + notifications push/natives OS
- **Chatbot IA** (Groq `openai/gpt-oss-120b`)
- **Feed posts + Devoirs + Notes (correction IA)**

---

## Architecture 2026

```
┌────────────────────────────────────────────────────────────────┐
│  COUCHE 1 — FRONTEND  (HTML / CSS / Vanilla JS / Three.js)     │
│                                                                  │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────────────┐    │
│  │ Hall 3D    │  │ Classes A/B  │  │ Teacher Dashboard    │    │
│  │ (hud chat, │  │ (assise,     │  │ (KPIs YOLO, sessions,│    │
│  │  avatars,  │  │  lever, nom, │  │  graphiques, stop/   │    │
│  │  portails) │  │  participants│  │  start détection)    │    │
│  └─────┬──────┘  └──────┬───────┘  └──────────┬───────────┘    │
│        │ Chat Widget     │                    │                │
└────────┴─────────────────┴────────────────────┴────────────────┘
                           │ ⚡ REST + Socket.IO (presence/unread)
                           ▼
┌────────────────────────────────────────────────────────────────┐
│  COUCHE 2 — BACKEND  Node.js 22 · Express 5 · MongoDB          │
│                                                                  │
│  JWT (3 rôles : ADMIN / TEACHER / STUDENT)                       │
│  13 routes API · 13 modèles Mongoose · Socket.IO rooms           │
│  Groq (openai/gpt-oss-120b) chatbot + correction devoirs        │
└──┬──────────────────────────────────────────────┬───────────────┘
   │ X-SmartClass-API-Key (POST /api/smartclass/  │ MQTT IoT
   │ camera)                                       │ (futur)
   ▼                                               ▼
┌─────────────────────────────────┐  ┌─────────────────────────────┐
│  COUCHE 3 — IA YOLOv8 (Python) │  │  COUCHE 4 — IoT (futur)     │
│  smartclass-detector-service.py │  │  ESP32 · DHT22 · MAX4466    │
│  Flask 5001 : ping / start /   │  │  Mosquitto MQTT (QoS 1)     │
│  stop → lance camera_real.py   │  │  smartclassRoutes.js racine │
│         └─► YOLOv8 best.pt     │  └─────────────────────────────┘
│             → POST /camera → Mongo / Socket.IO                 │
└────────────────────────────────────────────────────────────────┘
```

** ReadyPlayerMe — SUPPRIMÉ DÉFINITIVEMENT (2026-09)**  
Plus aucun appel réseau `models.readyplayer.me`. Les avatars 2D utilisent :
1. Vignette locale 3D (128×128 snapshot tête de l'avatar GLB Three.js)
2. Image 2D explicite (AvatarUrl non-RPM)
3. **DiceBear 7 Avataaars** déterministe
4. Initiale + gradient `linear-gradient(135deg,#6366f1,#ec4899)`

---

## Démarrage rapide

### Prérequis
- **Node.js ≥ 22** + npm
- **Python ≥ 3.11** (venv `.venv/` déjà présent racine si vous voulez le réutiliser)
- **MongoDB** (local ou Atlas) — URI dans `backend/.env`
- **Webcam** (pour la détection SmartClass côté professeur)
- Compte **Groq** pour l'IA chatbot (clé API dans `backend/.env`)

---

### 1. Backend Node.js (http://localhost:4000)

```bash
cd "backend"
# Si pas déjà les modules :
npm install
# Copier .env si pas déjà présent (exemple ci-dessous)
npm run dev
# Server nodemon → http://localhost:4000  (logs sockets OK)
```

**Fichier `backend/.env` minimum obligatoire :**
```env
# ══════════════════════════════════════
# BACKEND WBC
# ══════════════════════════════════════
PORT=4000

# ══ Base de données
MONGO_URI=mongodb://127.0.0.1:27017/wessup        # (ou Atlas)

# ══ Sécurité
JWT_SECRET=<générer : node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">

# ══ IA Chatbot (Groq — MODÈLE IMPOSÉ)
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
GROQ_MODEL=openai/gpt-oss-120b

# ══ Clé SmartClass (YOLO / camera_real.py ↔ backend)
#    DOIT être IDENTIQUE dans smartclass_ai/.env et teacher-dashboard.js
SMARTCLASS_API_KEY=sc_key_change_me_before_deploy

# ══ Emails (nodemailer — optionnel)
# SMTP_HOST=smtp.gmail.com ; SMTP_PORT=465 ; SMTP_USER ; SMTP_PASS ; MAIL_FROM
```

---

### 2. Frontend (VSCode Live Server recommandé, port 5500)

```
frontend/index.html            → Connexion
frontend/feed.html             → Mur / Profil
frontend/platform.html         → Wrapper (iframe Hall + barre latérale avatar)
frontend/hall.html             → Hall 3D
frontend/class-a.html          → Classe A
frontend/class-b.html          → Classe B
frontend/teacher-dashboard.html→ Tableau de bord professeur
frontend/admin-dashboard.html  → Administration
frontend/ai-assistant.html     → Chatbot IA pédagogique
```

**Compte test (si lancé `backend/create-test-accounts.js`) :**
- Professeur : `teacher@wbc.local` / `Teacher123!`
- Étudiant A : `student-a@wbc.local` / `Student123!`
- Étudiant B : `student-b@wbc.local` / `Student123!`
- Admin : `admin@wbc.local` / `Admin123!`

---

### 3. SmartClass (IA YOLO + Détection webcam)

> **Flux recommandé 2026** — **PAS `python smartclass_camera.py`** (obsolète).  
> On lance d'abord un **service Flask local** puis les boutons du Dashboard font tout.

```bash
# ═══════════════════════════════════════════════════════════
# 1. Venv Python (si vous utilisez le .venv racine existant)
# ═══════════════════════════════════════════════════════════
cd "smartclass_ai"

# (a) Si PAS de venv :
python -m venv .venv
# Windows PowerShell :
.\.venv\Scripts\Activate.ps1
# Windows CMD     : .\.venv\Scripts\activate.bat
# Linux / macOS   : source .venv/bin/activate

# (b) Installer dépendances (YOLO + Flask Detector) :
pip install -r requirements.txt

# ═══════════════════════════════════════════════════════════
# 2. Créer smartclass_ai/.env  (DOIT matcher backend/.env!)
# ═══════════════════════════════════════════════════════════
# --- smartclass_ai/.env ---
WBC_API_BASE=http://localhost:4000
SMARTCLASS_API_KEY=sc_key_change_me_before_deploy

# Modèle YOLO entraîné WBC (classes : bow / down / lookup / sit)
MODEL_PATH=runs/detect/smartclass/weights/best.pt
```

Puis :

```bash
# Démarrer le service SmartClass Flask — ÉCOUTE localhost:5001
python smartclass-detector-service.py
# → Affiche "Service : http://localhost:5001"
```

**Ensuite côté navigateur professeur** :
1. Se connecter → `teacher-dashboard.html`
2. **Nouvelle séance SmartClass** (choisir cours + salle)
3. Cliquer **▶ Démarrer la détection**
   → Appel `POST http://localhost:5001/start` avec `X-SmartClass-API-Key`
   → Le service lance `camera_real.py` en subprocess
   → YOLOv8 (`best.pt`) tourne sur la webcam
   → Toutes les ~30s : `POST /api/smartclass/camera` → MongoDB + Socket.IO broadcast `smartclass:new_data`
4. **⏹ Arrêter la détection** → subprocess kill + session close

📘 **Voir `smartclass_ai/README.md` (dans le dossier) pour les détails du mapping classes.**

---

## 🗂️ Structure du projet

```
wessup auth/
├── frontend/                        # UI (HTML / CSS / JS / Three.js)
│   ├── index.html                   # Login
│   ├── platform.html                # Wrapper iframe + sync avatar 2D cross-iframe
│   ├── hall.html + hall-scene.js    # Hall 3D + avatars GLB
│   ├── class-a.html + class-scene.js
│   ├── teacher-dashboard.html + .js # 100% SmartClass sessions + YOLO start/stop
│   ├── chat-widget.js               # Widget chat global + rooms + privé + badges unread
│   ├── utils.js                     # createAvatarHtml + refresh vignettes 3D
│   └── ...
│
├── backend/                         # Node.js / Express / MongoDB
│   ├── server.js                    # Point d'entrée (JWT, Socket.IO rooms, 12 routes mount)
│   ├── routes/
│   │   ├── smartclass.js            # ⭐ YOLO sessions + data + /camera + Socket.IO
│   │   ├── auth.js · teacher.js · iot.js · chat.js · feed.js · ...
│   │   └── avatar-proxy.js
│   ├── models/
│   │   ├── SmartClassSession.js     # Sessions SmartClass (statut, cours, salle)
│   │   ├── SmartClassData.js        # KPIs YOLO (focused/other/sleeping %)
│   │   └── User.js · Course.js · Assignment.js · Conversation.js · Message.js · ...
│   ├── services/llmService.js       # Client Groq chatbot/corrections
│   ├── middleware/auth.js + requireRole.js
│   ├── .env                         # (à créer, template README §1)
│   ├── create-test-accounts.js
│   └── package.json
│
├── smartclass_ai/                   # ⭐ Module Python YOLO WBC 2026
│   ├── README.md                    # Guide SmartClass complet
│   ├── smartclass-detector-service.py  # Flask :5001 (ping/start/stop → subprocess camera_real)
│   ├── camera_real.py               # Capture webcam + YOLO best.pt + POST /camera
│   ├── config.py                    # .env loader, SESSION_FILE, headers API key
│   ├── smartclass_camera.py         # LEGACY STANDALONE — ne plus utiliser
│   ├── start_session.py             # LEGACY CLI cassé (pas creds prof, Q6 ok)
│   ├── requirements.txt             # (ultralytics, flask, torch, opencv, psutil, ...)
│   ├── class_mapping.yaml           # mapping classes ↔ états (fichier de référence)
│   ├── .env.example
│   └── runs/detect/smartclass/weights/best.pt    # ⭐ MODÈLE WBC 4 classes
│
├── routes/smartclassRoutes.js       # KEEP — IoT/MQTT futur (heating/plug/rooms) — non monté
├── services/mqttService.js          # KEEP — callbacks MQTT
├── iot/esp32_sensors.ino            # Firmware IoT futur
├── ai_model/                        # KEEP — MediaPipe biométrique ancien (_legacy/)
├── package.json                     # Racine (dépendances MQTT/ML optionnelles)
├── .gitignore                       # .env · node_modules · .venv · runs/ · __pycache__ · .session_id
└── README.md                        # Ce fichier
```

---

##  Mapping YOLO SmartClass (4 classes)

```
Fichier : smartclass_ai/class_mapping.yaml
───────────────────────────────────────────
  lookup  ─────────► focused   (étudiant regarde le tableau / prof)
  sit     ─────────► focused   (étudiant assis et attentif)
  down    ─────────► other     (tête baissée / distraction)
  bow     ─────────► sleeping  (tête très basse / assoupi)
```

Calcul backend :
```
focusedPct  = (lookup + sit) / total * 100
otherPct    = (down)           / total * 100
sleepingPct = (bow)            / total * 100
attentionPct = focusedPct               # envoyé au teacher-dashboard
fatiguePct   = sleepingPct
distractionPct = otherPct
```

---

##  Socket.IO — Rooms & Événements

```js
// Rooms WBC
io.join("hall")
io.join("classA")
io.join("classB")

// Événements SmartClass
socket.emit("smartclass:new_data", data)     // backend → tous les profs connectés
socket.on("smartclass:new_data", ...)         // teacher-dashboard.js L330

// Présence + chat global
socket.on("presence:snapshot")
socket.on("room:message") / socket.on("hall:message") / socket.on("classA:message")
socket.on("notification:new")                 // push widget + Notification OS
socket.on("chat:unreadUpdate")                // badge rose 3D
```

---

##  Sécurité — Checklist

| À faire | Lieu |
|---|---|
| ✅ (09/2026) Plus aucun appel réseau `models.readyplayer.me` | frontend/utils.js, chat-widget.js |
| ✅ JWT HS256 httpOnly ? — Non → localStorage `wbc_token` (vérifier futur httpOnly) | backend/middleware/auth.js |
| ✅ `SMARTCLASS_API_KEY` en-tête `x-api-key` (backend/routes/smartclass.js) | backend + smartclass_ai/.env |
| ⚠️ **TODO H** — SMARTCLASS_API_KEY hardcodée dans frontend/teacher-dashboard L22, L52 | Déplacer vers backend + endpoint protégé |
| ✅ Aucun identifiant professeur dans Python (start_session.py cassé par design Q6) | smartclass_ai/config.py |
| ✅ `.env` hors Git (`.gitignore`) | Racine |

---

##  Commandes test utiles

```bash
# ═══════════ BACKEND ═══════════
cd backend
node create-test-accounts.js       # Créer les comptes de test
node check-users.js                # Vérifier les comptes existants
node inspect_db.js                 # Explorer la BDD
npm run dev                        # Lancer le backend nodemon

# ═══════════ SMARTCLASS (Python) ═══════════
cd smartclass_ai
python -m pip install -r requirements.txt
python test_model.py               # Test rapide YOLO best.pt sur image
python smartclass-detector-service.py
# Puis teacher-dashboard bouton Démarrer
```

---

##  Technologies

| Couche | Technologies |
|---|---|
| **Frontend** | HTML5 · CSS3 · Vanilla JS · **Socket.IO client** · **Three.js (r150+)** · DiceBear 7 HTTP API |
| **Backend** | **Node.js ≥ 22** · **Express 5** · MongoDB (Mongoose 8) · **JWT (jsonwebtoken 9)** · **Socket.IO 4.8** · Groq SDK (via `node-fetch`) |
| **SmartClass IA** | Python ≥ 3.11 · **Ultralytics YOLOv8** · **Flask + flask-cors** (Detector Service) · OpenCV · Torch 2+ · python-dotenv · psutil |
| **IA générative** | **Groq `openai/gpt-oss-120b`** (chatbot, recommandations pédagogiques, correction devoirs) |
| **IoT (futur)** | ESP32-WROOM-32 · DHT22 · MAX4466 · Mosquitto MQTT QoS1 · smartclassRoutes.js (racine) |
| **Base de données** | MongoDB |

---

## 🔄 Avatars 2D (partout — barres, chat, feed, HUD, participants)

Fonction unique `window.createAvatarHtml(user, size)` ([frontend/utils.js](file:///C:/Users/User/Documents/wessup%20auth%20-%20Copie/frontend/utils.js)) :

1. 🥇 **Vignette 3D locale** : `localStorage.getItem("wbc_avatar_thumb:<userId>")`  
   → Générée par `hall-scene.js:captureAvatarThumbnail(avatarGroup, 128)` — snapshot de la TÊTE (`headWorldHeight=0.29×H`) de **l'avatar 3D ORIGINAL** (pas de clone SkinnedMesh ⇒ posture réelle).
2. 🥈 `avatarUrl` / `avatar_url` (image 2D **non-RPM** et non-`*.glb`)
3. 🥉 **DiceBear 7** : avataaars (seed = `safeDiceBearSeed(userId + name)`) + fonds gradient
4. 🥉 Initiale `NOM[0]` + gradient linéaire indigo→rose

Mise à jour globale (tous les avatars d'une page + cross-iframe sync) :
- `setLocalAvatarThumb` → event `wbc:avatarThumbReady`
- `refreshAllAvatarsForUser` (attribut HTML `data-avatar-for="<userId>"` sur TOUS les `<img>` / initiales)
- Polling localStorage + `window storage` event (platform.html ↔ iframes)

---

##  TODO général

### Sécurité
- 🔴 Extraire SMARTCLASS_API_KEY du frontend (endpoint backend dédié)
- 🟡 Passer le token `wbc_token` en cookie HttpOnly + SameSite strict
- 🟡 Valider ROTATION SMARTCLASS_API_KEY multi-prof (1 clef par prof ?)

### Entraînement YOLO (smartclass_ai/)
- 🟡 Dataset : plus d'images divers (étudiants habillages / styles / luminosités variés)
- 🟡 Classes : ajouter phone (téléphone) / writing (écriture) / sleeping (distinction plus fine down/bow)
- 🟡 Intégrer `retrain_balanced.py` (weights équilibrés classes minoritaires)
- 🟡 Test YOLO sur vidéo classe entière (plusieurs étudiants / caméra de dos)
- 🟡 Fusionner YOLO comportement + MediaPipe biométrique (EAR+GAZE) — pipeline 2 couches

### Fonctionnel
- 🟡 Validation multi-onglets 8 étapes (présence <1s, chat privé, unread badges, teacher invisible, disconnect, historique, legacy redirect, dots online)
- 🟡 Test rétrocompat bulle legacy `classA:message` (chatSendBtn)
- 🟡 Notification natives OS (2 onglets test)

---

##  Auteur

**Nadine Ataoui** — nadineataoui@gmail.com  
Wess Business City (WBC) — PFE 2026
