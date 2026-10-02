# Présence Multi-Utilisateurs + Chat (Groupe & Privé) - Plan d'Implémentation

## Repository Research (Constat de l'existant)

### Architecture actuelle (fonctionnelle mais incomplète)
- **Backend Socket.IO** ([server.js](file:///c:/Users/User/Documents/wessup%20auth%20-%20Copie/backend/server.js#L136-L422)) :
  - Auth via JWT, stockage dans `classAUsers` Map (key = socket.id, value = userState)
  - Rooms existantes : `hall`, `classA`, `classB`, `class:XXX`, `conversation:XXX`, `admin_dashboard`
  - Events existants : `joinRoom`, `player:update`, `room:users`, `player:updated`, `player:left`, `classA:message`, `classB:message`
  - PROBLÈMES détectés :
    1. `fullName` n'est PAS extrait de `User` dans l'authentification socket (seulement `username`, ligne 163-170) — donc les avatars affichent `username` au lieu du vrai nom
    2. Pas d'event `hall:message` (chat de hall) — seulement `classA` et `classB`
    3. Pas de sync globale "qui est en ligne dans quelle room"
    4. Lors d'un `joinRoom`, on ne notifie PAS les autres rooms (un user connecté en classA n'est pas visible par ceux dans classB ou hall)
- **Frontend Hall** ([hall-scene.js](file:///c:/Users/User/Documents/wessup%20auth%20-%20Copie/frontend/hall-scene.js#L129-L202)) :
  - `room:users` → spawn les avatars distants via `spawnAvatar` ✅
  - `player:updated` → sync position/emoji ✅
  - `player:left` → removePlayer ✅
  - MAIS : pas d'intégration avec le chat (aucun clic sur avatar → ouvrir chat privé)
- **Frontend Classes** ([class-scene.js](file:///c:/Users/User/Documents/wessup%20auth%20-%20Copie/frontend/class-scene.js#L807-L849)) :
  - Même logique multiplayer que le hall ✅
  - Chat de room : `classA:message` / `classB:message` gérés dans `class-a.js`/`class-b.js`
- **Chat Widget Global** ([chat-widget.js](file:///c:/Users/User/Documents/wessup%20auth%20-%20Copie/frontend/chat-widget.js#L1-L400+)) :
  - Crée SA PROPRE socket (ligne 169-172) → double connexion pour chaque client, sans partage d'état
  - Utilise REST API `/api/chat` pour historique
  - Listen `new_message` pour les messages en temps réel
  - Pas d'indicateur en ligne sur les users, pas de lien avec les avatars 3D

### Ce qui manque pour répondre au besoin utilisateur
1. Afficher TOUS les utilisateurs connectés partout (hall + classes) en temps réel
2. Chat de groupe dans le HALL
3. Chat privé déclenché en cliquant sur un avatar (hall ou classes)
4. Une seule connexion Socket.IO partagée (widget + scene 3D)
5. Indicateur "en ligne" sur le chat widget
6. Notifications de join/leave avec le `fullName`
7. Sync initiale robuste (historique du chat de room + liste complète des connectés)

---

## Files and Modules à modifier

| Fichier | Modification attendue |
|---|---|
| `backend/server.js` | 1) Ajouter `fullName` + `email` dans `socket.user`; 2) Génériser les events de chat (`hall:message`, `room:chat_history`); 3) Notifier cross-room sur join/leave; 4) Event `presence:all` pour liste complète des connectés; 5) Event `user:typing` (optionnel) |
| `backend/routes/chat.js` | Vérifier que le REST renvoie bien les conversations group/private avec lastMessage (probablement OK) |
| `frontend/hall.js` | Intégrer widget chat PARTAGEANT la même socket; écouter `hall:message`; bouton chat hall + UI chat de groupe overlay |
| `frontend/hall-scene.js` | Au clic sur un avatar distant → émettre event `request:private_chat` avec l'userId de l'avatar; indicateur bulle de nouveau message sur avatar |
| `frontend/class-a.js` / `frontend/class-b.js` | Remplacer chat de classe ad-hoc par widget chat partagé (ou améliorer l'existant pour history + typing); connecter clic avatar → chat privé |
| `frontend/class-scene.js` | Clic avatar → chat privé (même hook que hall-scene.js) |
| `frontend/chat-widget.js` | **Refonte majeure** : Accepter une socket externe (passée par hall.js/class-a.js/…) au lieu d'en créer une nouvelle; indocrateur dot vert "en ligne" sur avatars des users connectés; méthode `openPrivateChat(userId)` déclenchable depuis scenes 3D; méthode `openGroupRoomChat(roomId, roomName)` pour hall/classA/classB |
| `frontend/utils.js` (nouvelle fonction) | Helper partagé `initSharedSocket()` + `getSharedChatWidget(socket, currentUser)` si besoin |
| `frontend/hall.html` / `frontend/class-a.html` / `frontend/class-b.html` | Vérifier la présence de la div d'ancrage du widget chat (devrait déjà être ok via chat-widget.js qui injecte dans body) |

---

## Implementation Steps (ordre de dépendances)

### Étape 1 — Backend Socket.IO : Fondations robustes (server.js)
1. **Auth socket enrichie** (io.use) : ajouter `fullName: user.fullName || user.username` et `email: user.email` dans `socket.user`
2. **userState enrichi** dans connection : inclure `fullName`, `email`, `online: true`, `lastActive: Date.now()`
3. **Event global `presence:snapshot`** : chaque client sur `connect` reçoit `presence:snapshot` = tous les users connectés (filtré teacher/admin invisible)
4. **Event `presence:update`** : sur joinRoom/disconnect, broadcast à tout le monde la mise à jour de présence (user, nouvelle room, disconnected true/false)
5. **Génériciser les chats de room** : remplacer `classA:message` et `classB:message` par un handler générique `room:message` (roomId dans le payload, validé parmi hall/classA/classB)
   - ⚠️ Compatibilité : garder aussi un emit sur `classA:message`/`classB:message`/`hall:message` pendant migration
   - Sauvegarder le message dans `ClassroomActivity` ou `ChatMessage` ? Décision : utiliser `ChatMessage` avec `channel = class:hall` etc. pour garder l'historique
6. **Event `room:chat_history`** : à l'émission d'un joinRoom, envoyer les N derniers messages de la room
7. **Chat privé en temps réel** : confirmation que `new_message` + `conversation:XXX` (déjà implémenté) fonctionne — on garde l'existant
8. **Event `request:private_chat`** : handler socket qui vérifie userId destinataire → crée ou récupère la conversation 1v1 → renvoie `conversation:created` à l'émetteur + notification au destinataire

### Étape 2 — Chat Widget : partage de socket + API publique (chat-widget.js)
1. Refacto connectSocket : **ne plus créer de socket** si une socket est passée en paramètre du constructeur
   - Nouveau constructeur : `new ChatWidget({ socket, currentUser, token })` (anciens params gardés pour rétro)
2. API publique : ajouter méthodes
   - `openPrivateChat(userId, userName)` → fetch ou crée la conversation 1v1
   - `openRoomChat(roomId, roomName)` → ouvre l'onglet chat de salle (hall/classA/classB)
   - `markOnlineUserIds(Set<userId>)` → affiche point vert sur ces users
3. Dans la vue "rechercher un utilisateur" et dans la liste conversations :
   - Ajouter un `<span class="online-dot green"></span>` devant les users connectés
4. Écouter socket `presence:snapshot` et `presence:update` pour mettre à jour `this.onlineUserIds`

### Étape 3 — Hall : chat de salle + widget partagé (hall.js + hall-scene.js)
1. hall.js : stocker `socket` en variable accessible, initialiser `ChatWidget({ socket, currentUser, token })`
2. hall.js : bouton UI "💬 Chat Hall" qui appelle `chatWidget.openRoomChat('hall', 'Hall WES\'SUP')`
3. hall.js : écouter socket `hall:message` et `room:message` (si on est en hall) pour update l'UI chat
4. hall.js : au `connect`, appeler `socket.emit('joinRoom', 'hall')` puis demander `socket.emit('room:chat_history', 'hall')`
5. hall-scene.js : dans le clique handler avatars distant (après emoji check) — si on clique sur un avatar qui n'est pas un emoji → trigger `chatWidget.openPrivateChat(otherUserId, otherUserName)`
6. hall-scene.js : sur `otherPlayers[u.sessionId]`, stocker aussi `userId` (= u.id) et `userName` (= u.fullName) dans le userData du mesh pour pouvoir récupérer au clic

### Étape 4 — Classes A/B : même logique que hall (class-a.js, class-b.js, class-scene.js)
1. class-a.js / class-b.js : partager la socket vers ChatWidget
2. class-scene.js : clic avatar → chat privé (exactement même hook que hall-scene.js)
3. class-a.js / class-b.js : intégrer le chat de groupe existant avec room:chat_history et room:message

### Étape 5 — Indicateurs visuels sur avatars 3D (hall-scene.js + class-scene.js)
1. Au-dessus de chaque avatar distant : si `unreadMessagesCount > 0`, afficher un petit badge rose "💬 X" au-dessus du nom
2. Au reçu d'un `new_message` privé ou `hall:message` : if `senderId !== myId` → incrémenter le badge sur l'avatar correspondant
3. Au clic sur l'avatar (ouverture chat) → reset le badge à 0

### Étape 6 — Edge cases et sécurité (backend server.js)
1. **Validation room** : les events room:message et room:chat_history checkent que la room est bien parmis ['hall','classA','classB'] + que le sender a bien `socket.rooms.has(roomId)`
2. **Validation destinataire chat privé** : event `request:private_chat` vérifie que le destinataire existe dans la BDD
3. **Doublons de connexions** : un même user avec 2 onglets → 2 entrées dans classAUsers avec sessionId différents (c'est correct). Dans `presence:snapshot`, grouper par userId (un user avec 2 onglets = un indicateur en ligne UNIQUE)
4. **Enseignants invisibles** : ne jamais renvoyer dans presence:snapshot / presence:update les users avec role=TEACHER ou ADMIN (convention déjà existante)

---

## Dependencies and Considerations
- Aucune nouvelle dépendance npm → tout utilise socket.io et fetch existants
- `ChatMessage` model existe déjà en base : servira pour l'historique des salles (hall/classA/classB) avec `channelType = 'ROOM'`, `channelId = 'hall'|'classA'|'classB'`
- Convention hard du projet : **enseignants invisibles** → on maintient cette règle partout (présence, avatars, chat)
- Les noms d'avatars doivent rester `fullName` (convention du projet) : blanc 34px, Z=0.5, renderOrder 999, `depthTest:false`
- Le fallback REST est important : si socket.io coupe, le chat reste fonctionnel en HTTP polling via `/api/chat`

---

## Validation (après implémentation)
1. **Test multi-onglets** : ouvrir 3 fenêtres de navigateur (2 étudiants + 1 admin)
   - Compte etu.test → login dans fenêtre 1 + fenêtre 2 (même user, 2 onglets) → 1 indicateur en ligne unique, 2 avatars visibles? ⚠️ NON, un user avec 2 sessions → un avatar OU deux ? Décision : deux avatars (deux positions possibles) MAIS un seul indicateur en ligne dans le widget chat
2. **Hall** : fenêtre 1 va en hall, fenêtre 2 va en hall → les 2 avatars apparaissent immédiatement
3. **Chat hall** : fenêtre 1 envoie "Bonjour" → fenêtre 2 reçoit instantanément avec bulle sur avatar
4. **Chat privé depuis avatar** : fenêtre 1 clique sur avatar fenêtre 2 → chat privé s'ouvre, envoie message privé
5. **Changement de room** : fenêtre 2 va en classA → fenêtre 1 voit l'avatar disparaître du hall; troisième fenêtre en classA voit apparaitre l'avatar dans classA
6. **Deconnexion** : fermer fenêtre 2 → avatar disparaît partout en < 1s
7. **Mode Strict Cloud / Production** : vérifier que tout fonctionne sans Ollama (n'impacte pas les chats)
8. **Teachers invisibles** : login teacher → pas d'avatars dans hall ni dans classA (respect convention)

---

## Risques
- **Double connexion Socket.IO par client** → corrigé via ChatWidget({ socket }) partagé. Si oublié : 2x sockets = 2x presence entries = 2x avatars fantômes. Solution : rigoureusement passer la même socket.
- **Perte de sync entre Map classAUsers et rooms socket.rooms** → classAUsers est la source de vérité; `presence:snapshot` reconstruit tout, donc une fois par connexion tout est corrigé.
- **Historique ChatMessage pas chargé** → si aucun message dans ChatMessage, les chats de salle sont vides (normal, 1er lancement). Solution : gérer liste vide élégamment dans l'UI.
- **Gros volume de connectés (50+)** → broadcast presence:update devient bruyant. Mitigation : throttle les presence:update côté serveur (100ms) et envoyer par lots.
- **Click-through entre emoji et avatar** : le raycaster du hall-scene.js ne doit pas confondre click sur emoji et click sur avatar pour ouvrir chat. Solution : ordre de test explicit (d'abord les emojis, puis si aucun match → test avatar mesh principal).
