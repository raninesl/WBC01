import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Board Animation State
let boardTexture;
let boardCtx;
let lastBoardUpdate = 0;
let currentSlide = 0;
const slides = [
  { title: "BIENVENUE - CLASSE A", content: ["Chargement du cours...", "Veuillez patienter", "Connectez-vous au flux audio"] },
  { title: "MARKETING DIGITAL", content: ["1. Stratégie SEO/SEA", "2. Social Media Management", "3. Data Analytics & KPIs"] },
  { title: "FINANCE D'ENTREPRISE", content: ["1. Bilan & Compte de résultat", "2. Analyse des flux de trésorerie", "3. Valorisation d'actifs"] },
  { title: "STRATEGIE", content: ["1. Analyse SWOT", "2. 5 Forces de Porter", "3. Avantage Concurrentiel"] }
];

let scene, camera, renderer, controls;
let socket;
let currentUser;
let mySeatId = null;
let players = new Map(); // sessionId -> { mesh, data }
let seats = []; // Array of seat positions/objects
let teacherSeatWorldPos = null;

const loader = new GLTFLoader();

const TEACHER_SEAT_ID = "teacher-seat";

// Store avatarUrl globally in module
let myAvatarUrl = null;
let myAvatar = null;
let isAvatarLoading = false;
let pendingSeat = null;
let emojiTooltip = null;

export function initClassScene(sock, user, containerId, avatarUrl, config = {}) {
  socket = sock;
  currentUser = user;
  myAvatarUrl = avatarUrl;
  
  if (config.title) {
    slides[0].title = config.title;
  } else {
    slides[0].title = "BIENVENUE - COURS";
  }
  
  const container = document.getElementById(containerId);
  // Clear placeholder content
  container.innerHTML = '';

  // 1. Scene
  scene = new THREE.Scene();
  const bgColor = config.bgColor || 0x0b0d12; // Darker, tech feel
  scene.background = new THREE.Color(bgColor);
  scene.fog = new THREE.Fog(bgColor, 10, 60);

  // 2. Camera
  // Increased FOV to 60 to capture the whole width of the classroom
  camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 100);
  // Lower and back position for a more grounded, centered view
  camera.position.set(1, 5, 15);
  camera.lookAt(0, 0, 0); // Look slightly higher and deeper into the room (towards board)

  // 3. Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  container.appendChild(renderer.domElement);

  // 4. Lights
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.65); // Brighter ambient
  scene.add(ambientLight);
  
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x000000, 0.55);
  hemiLight.position.set(0, 20, 0);
  scene.add(hemiLight);

  const dirLight = new THREE.DirectionalLight(0xeef4ff, 1.5); // Cool white light
  dirLight.position.set(5, 15, 7);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 2048;
  dirLight.shadow.mapSize.height = 2048;
  dirLight.shadow.bias = -0.0005;
  dirLight.shadow.normalBias = 0.02;
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far = 50;
  dirLight.shadow.radius = 4; // Softer shadows
  scene.add(dirLight);

  // Blue Accent Light from back
  const backLight = new THREE.DirectionalLight(0x4488ff, 0.5);
  backLight.position.set(-5, 10, -10);
  scene.add(backLight);

  // SpotLight for the board (Holographic feel)
  const spotLight = new THREE.SpotLight(0x00ffff, 2.0);
  spotLight.position.set(0, 8, 5);
  spotLight.target.position.set(0, 3, -7);
  spotLight.angle = Math.PI / 6;
  spotLight.penumbra = 0.8;
  spotLight.distance = 30;
  spotLight.decay = 1.5;
  spotLight.castShadow = true;
  scene.add(spotLight);
  scene.add(spotLight.target);

  // 5. Environment
  createClassroom();

  // 6. Controls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 1, -5); // Match the initial lookAt target
  controls.update();

  // 7. Interaction
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  let _privateChatHandler = null;

  window.openPrivateChatWithAvatar = function setPrivateChatHandlerClass(fn) {
    if (typeof fn === 'function') _privateChatHandler = fn;
  };
  window.openPrivateChatWithAvatar.handler = () => _privateChatHandler;

  function findPlayerAvatarRoot(obj) {
    let cur = obj;
    let guard = 0;
    while (cur && guard++ < 30) {
      if (cur.userData && (cur.userData.isPlayerAvatar || (cur.userData.ownerUserId !== undefined))) return cur;
      cur = cur.parent;
    }
    return null;
  }

  function handleSceneClick(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    // Ignore click if outside canvas
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
      return;
    }
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    // A) Seats (priority 1)
    const seatIntersects = raycaster.intersectObjects(seats);
    if (seatIntersects.length > 0) {
      const seat = seatIntersects[0].object;
      if (seat.userData.isTeacherSeat) {
        if (!currentUser || String(currentUser.role).toUpperCase() !== "TEACHER") {
          console.log("Only teachers can stand here.");
          return;
        }
      }
      const seatWorldPos = new THREE.Vector3();
      seat.getWorldPosition(seatWorldPos);
      if (seat.userData.isTeacherSeat) {
        standAt(seat.userData.id, seatWorldPos);
      } else {
        sitOnSeat(seat.userData.id, seatWorldPos);
      }
      return;
    }

    // B) Avatar click → private chat (priority 2, after seats)
    const candidates = [];
    players.forEach(p => { if (p.mesh) candidates.push(p.mesh); });
    if (candidates.length > 0) {
      const hits = raycaster.intersectObjects(candidates, true);
      if (hits.length > 0) {
        const root = findPlayerAvatarRoot(hits[0].object);
        if (root && root.userData.ownerUserId) {
          // Not local check: local myAvatar also might have ownerUserId now? skip local id
          if (currentUser && (root.userData.ownerUserId === (currentUser._id || currentUser.id))) return;
          const userId = root.userData.ownerUserId;
          const userName = root.userData.ownerFullName || "Utilisateur";
          // Clear unread
          root.userData.ownerUnread = 0;
          updateAvatarUnreadBadgeClass(root);
          if (typeof _privateChatHandler === 'function') {
            _privateChatHandler(userId, userName);
          } else if (window.wbcChatWidget && typeof window.wbcChatWidget.openPrivateChat === 'function') {
            if (!window.wbcChatWidget.isOpen) window.wbcChatWidget.toggleWidget();
            window.wbcChatWidget.openPrivateChat(userId, userName);
          } else if (window.WBCChatWidget && typeof window.WBCChatWidget.startChatWith === 'function') {
            window.WBCChatWidget.startChatWith(userId, userName);
          }
          return;
        }
      }
    }
  }

  // Replace window.addEventListener('click') with DOM element click (safer)
  renderer.domElement.addEventListener('click', handleSceneClick);

  // Create Emoji Tooltip
  if (!emojiTooltip) {
    emojiTooltip = document.createElement('div');
    emojiTooltip.className = 'emoji-tooltip';
    Object.assign(emojiTooltip.style, {
      position: 'absolute',
      backgroundColor: 'rgba(10, 15, 25, 0.95)',
      color: 'white',
      padding: '10px 14px',
      borderRadius: '10px',
      fontSize: '12px',
      pointerEvents: 'none',
      display: 'none',
      zIndex: '2000',
      border: '1px solid rgba(0, 242, 255, 0.4)',
      boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
      minWidth: '180px',
      backdropFilter: 'blur(4px)',
      fontFamily: "'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    });
    document.body.appendChild(emojiTooltip);
  }

  window.addEventListener('mousemove', (event) => {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    // Collect all status emojis
    const emojiSprites = [];
    players.forEach(p => {
      if (p.mesh) {
        p.mesh.traverse(child => {
          if (child.isSprite && child.userData.isEmoji) {
            emojiSprites.push(child);
          }
        });
      }
    });
    if (myAvatar) {
      myAvatar.traverse(child => {
        if (child.isSprite && child.userData.isEmoji) {
          emojiSprites.push(child);
        }
      });
    }

    const emojiIntersects = raycaster.intersectObjects(emojiSprites);
    const seatIntersects = raycaster.intersectObjects(seats);

    if (emojiIntersects.length > 0) {
      const sprite = emojiIntersects[0].object;
      const data = sprite.userData;
      
      emojiTooltip.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:4px;">
          <div style="font-size:10px; color:#00f2ff; font-weight:bold; text-transform:uppercase; letter-spacing:0.5px;">${data.teacherName}</div>
          <div style="font-size:13px; color:white; font-weight:bold;">${data.subject}</div>
          <div style="margin-top:6px; padding-top:6px; border-top:1px solid rgba(255,255,255,0.1); color:#ddd; font-style:italic; line-height:1.4;">
            ${data.remarks || "Aucune remarque."}
          </div>
        </div>
      `;
      
      emojiTooltip.style.display = 'block';
      
      // Position tooltip near mouse but keep it within viewport
      let x = event.clientX + 15;
      let y = event.clientY + 15;
      
      if (x + 200 > window.innerWidth) x = event.clientX - 210;
      if (y + 100 > window.innerHeight) y = event.clientY - 110;
      
      emojiTooltip.style.left = x + 'px';
      emojiTooltip.style.top = y + 'px';
      document.body.style.cursor = 'help';
    } else {
      emojiTooltip.style.display = 'none';
      if (seatIntersects.length > 0) {
        document.body.style.cursor = 'pointer';
      } else {
        document.body.style.cursor = 'default';
      }
    }
  });

  const isTeacher =
    currentUser && String(currentUser.role).toUpperCase() === "TEACHER";

  // Only students get avatars!
  if (!isTeacher) {
    const studentSeats = seats.filter(
      (s) => !s.userData || !s.userData.isTeacherSeat
    );
    if (studentSeats.length > 0) {
      const randomIndex = Math.floor(Math.random() * studentSeats.length);
      const seat = studentSeats[randomIndex];
      const seatWorldPos = new THREE.Vector3();
      seat.getWorldPosition(seatWorldPos);
      sitOnSeat(seat.userData.id, seatWorldPos);
    }
  }

  window.addEventListener('resize', () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });

  // 8. Socket Listeners
  setupSocketListeners();

  // Animation Loop
  animate();
}


function resetPose(avatar) {
  if (!avatar) return;
}

function markAvatarOwnerMeta(avatar, meta) {
  if (!avatar || !meta) return;
  avatar.userData = {
    ...(avatar.userData || {}),
    isPlayerAvatar: true,
    ownerUserId: meta.userId || null,
    ownerFullName: meta.fullName || meta.userName || "",
    ownerEmail: meta.email || null,
    ownerRole: meta.role || null,
    ownerUnread: avatar.userData?.ownerUnread || 0
  };
  avatar.traverse(child => {
    if (child.isMesh) {
      child.userData = { ...(child.userData || {}), ownerUserId: meta.userId || null };
    }
  });
}

function forceNeutralPoseOnAvatar(avatar) {
  try {
    if (!avatar) return;
    const nameLower = (s) => String(s || "").toLowerCase();

    // 🔥 RÈGLES SÉCURITÉ ABSOLUES :
    //   1) ON NE TOUCHE JAMAIS bone.position / bone.scale (uniquement rotation + quaternion)
    //   2) ON NE TOUCHE JAMAIS QUE LeftArm + RightArm (pas avant-bras / épaules / mains, trop risqué)
    //   3) ANGLE MINI : 0.14 rad (~8°, PAS 34° d'avant!)
    //   4) ON APPLIQUE UNIQUEMENT SI ÇA BAISSE RÉELLEMENT LA MAIN (> 1%), sinon ORIGINAL
    const boneResetIdentity = (bone) => {
      if (!bone) return;
      try {
        bone.rotation.set(0, 0, 0);
        bone.quaternion.identity();
        bone.rotation.order = "YXZ";
        bone.matrixAutoUpdate = true;
        bone.updateMatrix();
        bone.updateMatrixWorld(true);
      } catch {}
    };
    const applyRot = (bone, x, y, z) => {
      if (!bone) return;
      try {
        bone.rotation.set(0, 0, 0);
        bone.quaternion.identity();
        bone.rotation.order = "YXZ";
        bone.rotation.set(x, y, z);
        bone.matrixAutoUpdate = true;
        bone.updateMatrix();
        bone.updateMatrixWorld(true);
      } catch {}
    };
    const getW = (bone) => { try { const p=new THREE.Vector3(); bone.getWorldPosition(p); return p;} catch { return null; }};
    const avatarBBdyn = () => { try { const b=new THREE.Box3().setFromObject(avatar); return b; } catch { const b=new THREE.Box3(); b.expandByPoint(new THREE.Vector3(0,0,0)); return b; }};
    const handWorldY = (wp) => { const b=avatarBBdyn(); return (wp.y-b.min.y)/Math.max(0.001, b.max.y-b.min.y); };

    const bones = [];
    avatar.traverse((o) => { if (o && (o.isBone || (o.type && String(o.type).toLowerCase() === "bone"))) bones.push(o); });
    if (bones.length < 10) { console.log("[Class Pose] Squelette incomplet → posture ORIGINALE préservée."); return; }

    const LeftArm = bones.find(b => nameLower(b.name) === "leftarm");
    const RightArm = bones.find(b => nameLower(b.name) === "rightarm");
    const LeftHand = bones.find(b => nameLower(b.name) === "lefthand");
    const RightHand = bones.find(b => nameLower(b.name) === "righthand");

    if (!LeftArm || !RightArm) {
      console.log("[Class Pose] Os LeftArm/RightArm non trouvés → posture ORIGINALE préservée.");
      return;
    }

    console.log("[Class Pose] Mini ajustement UNIQUEMENT LeftArm/RightArm (~8° si ça baisse la main, sinon inchangé).");

    const tryLowerArmSafely = (armBone, handBone, armLabel) => {
      const origRot = armBone.rotation.clone();
      const origQuat = armBone.quaternion.clone();

      const markers = handBone ? [handBone] : [];
      const baselineY = markers.reduce((acc, b) => { const p=getW(b); return acc + (p ? handWorldY(p) : 0); }, 0) / Math.max(1, markers.length);
      const baselineArmY = (() => { const p = getW(armBone); return p ? handWorldY(p) : 0; })();

      const SMALL_ANG = 0.14;
      const tryOnce = (signXYZ) => {
        boneResetIdentity(armBone);
        applyRot(armBone, SMALL_ANG*signXYZ[0], SMALL_ANG*signXYZ[1], SMALL_ANG*signXYZ[2]);
        armBone.updateMatrixWorld(true);
        avatar.updateMatrixWorld(true);
        return markers.length > 0
          ? markers.reduce((acc, b) => { const p=getW(b); return acc + (p ? handWorldY(p) : 0); }, 0) / markers.length
          : (() => { const p = getW(armBone); return p ? handWorldY(p) : baselineArmY; })();
      };

      const combos = [
        [+1, +1, +1], [-1, +1, +1], [+1, -1, +1], [+1, +1, -1],
        [-1, -1, +1], [-1, +1, -1], [+1, -1, -1], [-1, -1, -1]
      ];
      let best = { y: baselineY, sign: null };
      combos.forEach(sign => {
        const y = tryOnce(sign);
        if (y < best.y - 0.01) { best = { y, sign }; }
      });

      if (best.sign) {
        tryOnce(best.sign);
        const gain = Math.round((baselineY-best.y)*100);
        console.log(`[Class Pose] ${armLabel} baissé de ${gain} pts (${Math.round(baselineY*100)}% → ${Math.round(best.y*100)}%), angles sign=[${best.sign.join(",")}]`);
      } else {
        armBone.rotation.copy(origRot);
        armBone.quaternion.copy(origQuat);
        armBone.updateMatrixWorld(true);
        avatar.updateMatrixWorld(true);
        console.log(`[Class Pose] ${armLabel} Aucun angle ne baisse la main → POSTURE ORIGINALE CONSERVÉE (${Math.round(baselineY*100)}%)`);
      }
    };

    tryLowerArmSafely(LeftArm, LeftHand, "LeftArm");
    tryLowerArmSafely(RightArm, RightHand, "RightArm");

    avatar.updateMatrixWorld(true);
    console.log("[Class Pose] Mini ajustement terminé (aucun autre os touché!).");
  } catch (e) {
    console.warn("[Class Pose] Echec (aucun changement → original) :", e);
  }
}

async function captureAvatarThumbnail(avatarGroup, size = 128) {
  try {
    const snapRenderer = new THREE.WebGLRenderer({
      antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: "high-performance"
    });
    snapRenderer.setPixelRatio(1);
    snapRenderer.setSize(size, size, false);
    snapRenderer.outputColorSpace = THREE.SRGBColorSpace;
    snapRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    snapRenderer.toneMappingExposure = 1.25;

    const snapScene = new THREE.Scene();
    snapScene.background = new THREE.Color(0xf8fafc);
    snapScene.add(new THREE.AmbientLight(0xffffff, 0.92));
    const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(2,3,4); snapScene.add(key);
    const fill = new THREE.DirectionalLight(0xddeeff, 0.8); fill.position.set(-2,1.2,3); snapScene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 0.9); rim.position.set(0,2.2,-3); snapScene.add(rim);

    // FIX ULTIME POSTURE : PAS DE CLONE → transfert PROVISOIRE de l'avatar original (posture RÉELLE) vers scène snapshot
    const prevParent = avatarGroup.parent;
    const prevPos = avatarGroup.position.clone();
    const prevQuat = avatarGroup.quaternion.clone();
    const prevScale = avatarGroup.scale.clone();
    const prevVisible = avatarGroup.visible;
    const backupChildrenCount = avatarGroup.children ? avatarGroup.children.length : 0;
    const backupUuid = avatarGroup.uuid || "";
    console.log("[Class Snap] Backup pré-snapshot : uuid=" + backupUuid.slice(0,8) + "…, children=" + backupChildrenCount);

    let sizeV, maxDim, headTargetY, headWorldHeight, fovRad, dist;
    try {
      // 0) RETIRE + reset scale=1 PUIS Box3 (EVITE l'ordre inverse HORS CHAMP!)
      if (prevParent) prevParent.remove(avatarGroup);
      avatarGroup.visible = true;
      avatarGroup.quaternion.identity();
      avatarGroup.scale.set(1, 1, 1);
      avatarGroup.position.set(0, 0, 0);
      avatarGroup.updateMatrixWorld(true);

      // 1) Box3 SUR scale=1, rot=identity
      const origBox = new THREE.Box3().setFromObject(avatarGroup);
      sizeV = new THREE.Vector3(); origBox.getSize(sizeV);
      maxDim = Math.max(sizeV.x, sizeV.y, sizeV.z) || 1;
      console.log("[Class Snap] BB reset scale=1 : H=", sizeV.y.toFixed(2), "m, W=", sizeV.x.toFixed(2), "m, D=", sizeV.z.toFixed(2), "m, minY=", origBox.min.y.toFixed(2));

      // 2) Centre XZ, Y bas = 0
      avatarGroup.position.sub(new THREE.Vector3(origBox.min.x + sizeV.x/2, origBox.min.y, origBox.min.z + sizeV.z/2));
      avatarGroup.updateMatrixWorld(true);
      snapScene.add(avatarGroup);

      headTargetY = sizeV.y * 0.80;
      headWorldHeight = sizeV.y * 0.29;
      fovRad = Math.PI / 6.8;
      dist = Math.max((headWorldHeight / 2) / Math.tan(fovRad / 2), maxDim * 0.42);
      console.log("[Class Snap] headTargetY=", headTargetY.toFixed(2), "m, camDist=", dist.toFixed(2), "m, FOV=", Math.round(fovRad*180/Math.PI), "°");

      const snapCam = new THREE.PerspectiveCamera((fovRad * 180) / Math.PI, 1, 0.01, 1000);
      snapCam.position.set(0, headTargetY, dist);
      snapCam.lookAt(0, headTargetY, 0);
      snapCam.updateMatrixWorld(true);
      snapCam.updateProjectionMatrix();

      snapRenderer.clear();
      snapRenderer.render(snapScene, snapCam);
      snapRenderer.render(snapScene, snapCam);
      console.log("[Class Snap] Render effectué — calls renderer.info.render=", snapRenderer.info.render ? snapRenderer.info.render.calls : "n/a");
    } finally {
      try {
        if (avatarGroup.parent && avatarGroup.parent === snapScene) {
          snapScene.remove(avatarGroup);
        }
      } catch (e) { console.warn("[Class Snap] remove snapScene échoué:", e); }
      try {
        avatarGroup.position.copy(prevPos);
        avatarGroup.quaternion.copy(prevQuat);
        avatarGroup.scale.copy(prevScale);
        avatarGroup.visible = prevVisible;
        if (prevParent && avatarGroup.parent !== prevParent) {
          prevParent.add(avatarGroup);
        }
        avatarGroup.updateMatrixWorld(true);
        const afterChildrenCount = avatarGroup.children ? avatarGroup.children.length : 0;
        console.log("[Class Snap] Avatar restauré — uuid=" + (avatarGroup.uuid||"").slice(0,8) + "…, parent OK=" + (avatarGroup.parent===prevParent) + ", children avant=" + backupChildrenCount + " / après=" + afterChildrenCount);
        if (afterChildrenCount !== backupChildrenCount) {
          console.error("[Class Snap] 🔥 ERREUR FATALE : ENFANTS DISPARUS. Attendu:", backupChildrenCount, "obtenu:", afterChildrenCount);
        }
      } catch (e) { console.error("[Class Snap] Restauration avatar échouée:", e); }
    }

    const dataUrl = snapRenderer.domElement.toDataURL("image/png");
    snapRenderer.dispose();
    try {
      while (snapScene.children.length > 0) {
        try { snapScene.remove(snapScene.children[0]); } catch {}
      }
    } catch {}
    snapScene.clear();
    return dataUrl;
  } catch (err) { console.warn("[Class Avatar Snapshot] Échec capture :", err); return null; }
}

function scheduleLocalAvatarSnapshot(avatar, meta) {
  if (!avatar || !meta) return;
  const meId = currentUser ? String(currentUser._id || currentUser.id || "").trim() : "";
  const metaId = String(meta.userId || "").trim();
  if (!meId || !metaId || meId !== metaId) return;

  setTimeout(async () => {
    try {
      // Stop ALL animations/socket updates temporaires si possible, puis force pose
      try { forceNeutralPoseOnAvatar(avatar); } catch {}
      await new Promise(r => setTimeout(r, 60));

      console.log("[Class Avatar] Début captureAvatarThumbnail sur avatar ORIGINAL...");
      const dataUrl = await captureAvatarThumbnail(avatar, 128);
      if (dataUrl) console.log("[Class Avatar] captureAvatarThumbnail OK — taille dataUrl:", (dataUrl.length/1024).toFixed(1), "KB");
      if (dataUrl && typeof window.setLocalAvatarThumb === "function") {
        window.setLocalAvatarThumb(currentUser || meta, dataUrl);
        console.log("[Class Avatar] Vignette 3D locale générée et stockée ✅");
      }
    } catch (e) { console.warn("[Class Avatar] Échec snapshot 3D :", e); }
  }, 1700);
}

function standAt(seatId, position) {
  if (mySeatId === seatId) return;
  mySeatId = seatId;

  if (isAvatarLoading) return;

  const x = position.x;
  const z = position.z;
  // Prof debout sur la plateforme (même niveau que le bureau)
  const standY = 0.2;

  const myMeta = {
    userId: currentUser ? (currentUser._id || currentUser.id) : null,
    fullName: currentUser ? (currentUser.fullName || currentUser.username) : "",
    email: currentUser?.email,
    role: currentUser?.role
  };

  if (!myAvatar) {
    if (myAvatarUrl) {
      isAvatarLoading = true;
      
      let targetUrl = myAvatarUrl;
      const isExternal = targetUrl.startsWith("http") && !targetUrl.includes(window.location.host);
      if (isExternal) {
          targetUrl = `/api/avatar-proxy?url=${encodeURIComponent(targetUrl)}`;
      }

      loader.load(targetUrl, (gltf) => {
        isAvatarLoading = false;
        myAvatar = gltf.scene;

        myAvatar.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        markAvatarOwnerMeta(myAvatar, myMeta);

        myAvatar.position.set(x, standY, z);

        if (!teacherSeatWorldPos) {
          teacherSeatWorldPos = new THREE.Vector3(0, standY, -6);
        }

        const target = teacherSeatWorldPos.clone();
        target.z = 2;
        target.y = standY;
        const dir = new THREE.Vector3().subVectors(target, myAvatar.position);
        const yaw = Math.atan2(dir.x, dir.z);
        myAvatar.rotation.set(0, yaw, 0);
        scene.add(myAvatar);

        // Add local user's name label
        addNameLabel(myAvatar, currentUser.fullName || currentUser.username || "");

        const myEmojis = currentUser.academicStatus ? (currentUser.academicStatus.activeEmojis || currentUser.academicStatus.statusEmoji) : "";
        updatePlayerEmoji(socket.id, myEmojis);
        scheduleLocalAvatarSnapshot(myAvatar, myMeta);

        socket.emit("player:update", {
          isSitting: false,
          seatId,
          position: { x, y: standY, z },
          rotation: { x: 0, y: myAvatar.rotation.y, z: 0 },
          avatarUrl: myAvatarUrl,
          userId: myMeta.userId,
          fullName: myMeta.fullName,
          email: myMeta.email,
          role: myMeta.role,
          activeEmojis: currentUser.academicStatus ? currentUser.academicStatus.activeEmojis : []
        });
      }, undefined, (error) => {
          console.warn("Avatar load failed, using fallback", error);
          isAvatarLoading = false;
          myAvatar = createFallbackAvatar(true, myMeta);
          myAvatar.userData.isGLB = false;
          myAvatar.position.set(x, standY, z);
          scene.add(myAvatar);
          // Add local user's name label
          addNameLabel(myAvatar, currentUser.fullName || currentUser.username || "");
          updatePlayerEmoji(socket.id, currentUser.academicStatus ? (currentUser.academicStatus.activeEmojis || currentUser.academicStatus.statusEmoji) : "");
          scheduleLocalAvatarSnapshot(myAvatar, myMeta);
      });
      return;
    } else {
      const geometry = new THREE.CapsuleGeometry(0.4, 1.2, 4, 8);
      const material = new THREE.MeshStandardMaterial({ color: 0xff7a1a });
      myAvatar = createFallbackAvatar(true, myMeta);
      const avatarMesh = new THREE.Mesh(geometry, material);
      avatarMesh.castShadow = true;
      avatarMesh.position.set(0, 0.6, 0);
      myAvatar.add(avatarMesh);
      myAvatar.position.set(x, standY, z);
      scene.add(myAvatar);

      // Add local user's name label
      addNameLabel(myAvatar, currentUser.fullName || currentUser.username || "");

      const myEmoji = currentUser.academicStatus ? currentUser.academicStatus.statusEmoji : "";
      updatePlayerEmoji(socket.id, myEmoji);
      scheduleLocalAvatarSnapshot(myAvatar, myMeta);
    }
  }

  if (myAvatar) {
        myAvatar.position.set(x, standY, z);

        if (!teacherSeatWorldPos) {
            teacherSeatWorldPos = new THREE.Vector3(0, standY, -6);
        }

        const target = teacherSeatWorldPos.clone();
        target.z = 2;
        target.y = standY;
        const dir = new THREE.Vector3().subVectors(target, myAvatar.position);
        const yaw = Math.atan2(dir.x, dir.z);
        myAvatar.rotation.set(0, yaw, 0);

        socket.emit("player:update", {
            isSitting: false,
            seatId,
            position: { x, y: standY, z },
            rotation: { x: 0, y: myAvatar.rotation.y, z: 0 },
            avatarUrl: myAvatarUrl,
            activeEmojis: currentUser.academicStatus ? currentUser.academicStatus.activeEmojis : []
        });
    }
}

function createClassroom() {
  // --- Modern Tech Room Dimensions ---
  const roomWidth = 20;
  const roomDepth = 20;
  const roomHeight = 8;

  // --- Materials ---
  // Floor: Dark polished concrete with grid
  const floorMat = new THREE.MeshStandardMaterial({ 
      color: 0x111111,
      roughness: 0.1,
      metalness: 0.5,
  });

  // Walls: Light Grey Panels
  const wallMat = new THREE.MeshStandardMaterial({ 
      color: 0xeeeeee,
      roughness: 0.2,
      metalness: 0.1
  });
  
  // Glowing Accents
  const neonMat = new THREE.MeshBasicMaterial({ color: 0x00ffff });

  // --- Floor ---
  const floorGeo = new THREE.PlaneGeometry(roomWidth, roomDepth);
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Grid on floor
  const gridHelper = new THREE.GridHelper(roomWidth, 20, 0x00ffff, 0x333333);
  gridHelper.position.y = 0.01;
  scene.add(gridHelper);
  
  // --- Walls ---
  // Back Wall (Behind Board) - Feature Wall
  const backWallGeo = new THREE.BoxGeometry(roomWidth, roomHeight, 0.5);
  const backWall = new THREE.Mesh(backWallGeo, new THREE.MeshStandardMaterial({ color: 0x222222 }));
  backWall.position.set(0, roomHeight/2, -roomDepth/2);
  backWall.receiveShadow = true;
  scene.add(backWall);

  // Glowing Strips on Back Wall
  const stripGeo = new THREE.BoxGeometry(0.2, roomHeight, 0.6);
  for(let x=-8; x<=8; x+=4) {
      const strip = new THREE.Mesh(stripGeo, neonMat);
      strip.position.set(x, roomHeight/2, -roomDepth/2);
      scene.add(strip);
  }

  // Left Wall (Glass/Open)
  // Instead of a solid wall, let's have a glass railing and open view
  const railingGeo = new THREE.BoxGeometry(0.2, 1.2, roomDepth);
  const railing = new THREE.Mesh(railingGeo, new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.9 }));
  railing.position.set(-roomWidth/2, 0.6, 0);
  scene.add(railing);

  // Right Wall (Solid with Panels)
  const rightWallGeo = new THREE.BoxGeometry(0.5, roomHeight, roomDepth);
  const rightWall = new THREE.Mesh(rightWallGeo, wallMat);
  rightWall.position.set(roomWidth/2, roomHeight/2, 0);
  rightWall.receiveShadow = true;
  scene.add(rightWall);

  // Ceiling (Optional, maybe floating panels)
  const ceilingGeo = new THREE.BoxGeometry(roomWidth, 0.2, roomDepth);
  const ceiling = new THREE.Mesh(ceilingGeo, new THREE.MeshStandardMaterial({ color: 0x111111 }));
  ceiling.position.set(0, roomHeight, 0);
  scene.add(ceiling);

  // --- Holographic Board ---
  const boardGroup = new THREE.Group();
  
  // Screen Base
  const screenGeo = new THREE.PlaneGeometry(10, 5);
  const screenMat = new THREE.MeshBasicMaterial({ 
      color: 0x000510,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide
  });
  const screen = new THREE.Mesh(screenGeo, screenMat);
  boardGroup.add(screen);

  // Dynamic Content Layer
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  boardCtx = canvas.getContext('2d');
  boardTexture = new THREE.CanvasTexture(canvas);
  
  // Initial Draw
  drawBoardSlide(slides[0]);

  const uiGeo = new THREE.PlaneGeometry(9, 4);
  const uiMat = new THREE.MeshBasicMaterial({ 
    map: boardTexture, 
    transparent: true,
    opacity: 1.0,
    blending: THREE.AdditiveBlending // Glow effect
  });
  const ui = new THREE.Mesh(uiGeo, uiMat);
  ui.position.z = 0.05;
  boardGroup.add(ui);

  // Frame/Projectors
  const projGeo = new THREE.BoxGeometry(10.2, 0.2, 0.5);
  const projTop = new THREE.Mesh(projGeo, new THREE.MeshStandardMaterial({ color: 0x444444 }));
  projTop.position.y = 2.6;
  boardGroup.add(projTop);
  
  const projBot = new THREE.Mesh(projGeo, new THREE.MeshStandardMaterial({ color: 0x444444 }));
  projBot.position.y = -2.6;
  boardGroup.add(projBot);

  boardGroup.position.set(0, 3.5, -roomDepth/2 + 1);
  scene.add(boardGroup);

  // --- Teacher's Area (Podium) ---
  const podiumGeo = new THREE.CylinderGeometry(1.5, 1.5, 1.2, 32);
  const podiumMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1 });
  const podium = new THREE.Mesh(podiumGeo, podiumMat);
  podium.position.set(0, 0.6, -6);
  podium.castShadow = true;
  podium.receiveShadow = true;
  scene.add(podium);

  // Teacher Holo-Interface
  const holoGeo = new THREE.PlaneGeometry(1.2, 0.8);
  const holo = new THREE.Mesh(holoGeo, new THREE.MeshBasicMaterial({ color: 0x00ffff, side: THREE.DoubleSide, transparent: true, opacity: 0.6 }));
  holo.position.set(0, 1.6, -6);
  holo.rotation.x = -Math.PI / 4;
  scene.add(holo);

  // --- Student Seats (Modern Desks) ---
  const deskMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2, metalness: 0.1 });
  const chairMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5 });
  
  let seatCount = 0;

  function createModernDesk(x, z) {
      const group = new THREE.Group();
      
      // Desk Top (Floating look)
      const topGeo = new THREE.BoxGeometry(1.6, 0.05, 0.9);
      const top = new THREE.Mesh(topGeo, deskMat);
      top.position.y = 0.8;
      top.castShadow = true;
      top.receiveShadow = true;
      group.add(top);

      // Single Central Leg (Future style)
      const legGeo = new THREE.CylinderGeometry(0.1, 0.2, 0.8, 16);
      const leg = new THREE.Mesh(legGeo, new THREE.MeshStandardMaterial({ color: 0x888888 }));
      leg.position.y = 0.4;
      leg.castShadow = true;
      group.add(leg);

      // Base
      const baseGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.05, 16);
      const base = new THREE.Mesh(baseGeo, new THREE.MeshStandardMaterial({ color: 0x444444 }));
      base.position.y = 0.025;
      base.castShadow = true;
      group.add(base);

      group.position.set(x, 0, z);
      scene.add(group);
  }

  function createModernChair(x, z, id) {
      const group = new THREE.Group();
      
      // Seat
      const seatGeo = new THREE.BoxGeometry(0.7, 0.1, 0.7);
      const seat = new THREE.Mesh(seatGeo, chairMat);
      seat.position.y = 0.45;
      seat.castShadow = true;
      seat.receiveShadow = true;
      group.add(seat);

      // Back (Mesh look)
      const backGeo = new THREE.BoxGeometry(0.7, 0.8, 0.05);
      const back = new THREE.Mesh(backGeo, chairMat);
      back.position.set(0, 0.85, 0.35);
      back.castShadow = true;
      group.add(back);

      // Stem
      const stemGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.45);
      const stem = new THREE.Mesh(stemGeo, new THREE.MeshStandardMaterial({ color: 0x888888 }));
      stem.position.y = 0.225;
      group.add(stem);

      // Star Base
      const baseGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.05, 5);
      const base = new THREE.Mesh(baseGeo, new THREE.MeshStandardMaterial({ color: 0x222222 }));
      base.position.y = 0.025;
      group.add(base);

      // Hitbox
      const hitboxGeo = new THREE.BoxGeometry(1, 1.5, 1);
      const hitboxMat = new THREE.MeshBasicMaterial({ visible: false });
      const hitbox = new THREE.Mesh(hitboxGeo, hitboxMat);
      hitbox.position.y = 0.75;
      hitbox.userData = { id: id, type: 'seat' };
      group.add(hitbox);
      seats.push(hitbox);

      group.position.set(x, 0, z);
      scene.add(group);
  }

  // Layout Grid (Wider spacing)
  for (let x = -4; x <= 4; x += 4) {
    for (let z = -1; z <= 6; z += 3.5) {
      createModernDesk(x, z);
      createModernChair(x, z + 0.6, seatCount++);
    }
  }

  // Teacher seat hitbox
  const teacherSeatGeo = new THREE.BoxGeometry(1.5, 2, 1.5);
  const teacherSeatMat = new THREE.MeshBasicMaterial({ visible: false });
  const teacherSeat = new THREE.Mesh(teacherSeatGeo, teacherSeatMat);
  teacherSeat.position.set(0, 0.75, -6);
  teacherSeat.userData = { id: TEACHER_SEAT_ID, type: "seat", isTeacherSeat: true };
  seats.push(teacherSeat);
  scene.add(teacherSeat);
  teacherSeatWorldPos = teacherSeat.position.clone();
}


function sitOnSeat(seatId, position) {
  if (mySeatId === seatId) return; // Already here

  mySeatId = seatId;
  console.log("Sitting on seat", seatId);

  // Update pending seat target (for race conditions)
  pendingSeat = { seatId, position };

  // Calculate target position
  const targetX = position.x;
  const targetZ = position.z;
  
  let targetY = 0;

  if (isAvatarLoading) {
      return; // Wait for current load to finish
  }

  const myMeta = {
    userId: currentUser ? (currentUser._id || currentUser.id) : null,
    fullName: currentUser ? (currentUser.fullName || currentUser.username) : "",
    email: currentUser?.email,
    role: currentUser?.role
  };

  // 1. Create/Move my avatar
  if (!myAvatar) {
    if (myAvatarUrl) {
      isAvatarLoading = true;
      loader.load(myAvatarUrl, (gltf) => {
        isAvatarLoading = false;
        
        // Check if user clicked another seat while loading
        const finalPos = pendingSeat ? pendingSeat.position : position;
        const finalSeatId = pendingSeat ? pendingSeat.seatId : seatId;
        
        const finalX = finalPos.x;
        const finalZ = finalPos.z;
        let finalY = 0;
        myAvatar = gltf.scene;
        myAvatar.userData.isGLB = true;
        markAvatarOwnerMeta(myAvatar, myMeta);
        setSittingPose(myAvatar);

        myAvatar.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });
        myAvatar.position.set(finalX, finalY, finalZ);

        if (teacherSeatWorldPos && finalSeatId !== TEACHER_SEAT_ID) {
          const target = new THREE.Vector3(0, finalY, -10);
          const dir = new THREE.Vector3().subVectors(target, myAvatar.position);
          const yaw = Math.atan2(dir.x, dir.z);
          myAvatar.rotation.set(0, yaw, 0);
        }
        scene.add(myAvatar);
        
        addNameLabel(myAvatar, currentUser.fullName || currentUser.username || "");
        
        const myEmojis = currentUser.academicStatus ? (currentUser.academicStatus.activeEmojis || currentUser.academicStatus.statusEmoji) : "";
        updatePlayerEmoji(socket.id, myEmojis);
        scheduleLocalAvatarSnapshot(myAvatar, myMeta);

        socket.emit('player:update', {
            isSitting: true,
            seatId: finalSeatId,
            position: { x: finalX, y: finalY, z: finalZ },
            rotation: {
              x: myAvatar.rotation.x,
              y: myAvatar.rotation.y,
              z: myAvatar.rotation.z,
            },
            avatarUrl: myAvatarUrl,
            userId: myMeta.userId,
            fullName: myMeta.fullName,
            email: myMeta.email,
            role: myMeta.role,
            activeEmojis: currentUser.academicStatus ? currentUser.academicStatus.activeEmojis : []
        });
      }, undefined, (error) => {
          console.warn("Avatar load failed, using fallback", error);
          isAvatarLoading = false;
          const finalPos = pendingSeat ? pendingSeat.position : position;
          const finalX = finalPos.x;
          const finalZ = finalPos.z;
          myAvatar = createFallbackAvatar(true, myMeta);
          myAvatar.userData.isGLB = false;
          myAvatar.position.set(finalX, 0, finalZ);
          scene.add(myAvatar);
          addNameLabel(myAvatar, currentUser.fullName || currentUser.username || "");
          updatePlayerEmoji(socket.id, currentUser.academicStatus ? (currentUser.academicStatus.activeEmojis || currentUser.academicStatus.statusEmoji) : "");
          scheduleLocalAvatarSnapshot(myAvatar, myMeta);
      });
      return; // Async load
    } else {
        // Capsule fallback
        const geometry = new THREE.CapsuleGeometry(0.4, 1.2, 4, 8);
        const material = new THREE.MeshStandardMaterial({ color: 0xff7a1a });
        myAvatar = createFallbackAvatar(true, myMeta);
        const avatarMesh = new THREE.Mesh(geometry, material);
        avatarMesh.castShadow = true;
        avatarMesh.position.set(0, 0.6, 0);
        myAvatar.add(avatarMesh);
        myAvatar.position.set(targetX, targetY, targetZ);
        scene.add(myAvatar);
        
        addNameLabel(myAvatar, currentUser.fullName || currentUser.username || "");

        const myEmojis = currentUser.academicStatus ? (currentUser.academicStatus.activeEmojis || currentUser.academicStatus.statusEmoji) : "";
        updatePlayerEmoji(socket.id, myEmojis);
        scheduleLocalAvatarSnapshot(myAvatar, myMeta);
    }
  }
  
  if (myAvatar) {
      // If we have a GLB, ensure pose is applied (idempotent)
      setSittingPose(myAvatar);
      
      // myAvatar is now always a group
      let y = 0;
      if (myAvatar.userData.isGLB) {
          y = targetY;
      } else {
          // Fallback group
          y = targetY;
      }
      
      myAvatar.position.set(targetX, y, targetZ);

      if (teacherSeatWorldPos && seatId !== TEACHER_SEAT_ID) {
        // Students face the board center
        const target = new THREE.Vector3(0, y, -10);
        const dir = new THREE.Vector3().subVectors(target, myAvatar.position);
        const yaw = Math.atan2(dir.x, dir.z);
        myAvatar.rotation.set(0, yaw, 0);
      }

      // Send update
        socket.emit('player:update', {
          isSitting: true,
          seatId: seatId,
          position: { x: targetX, y: y, z: targetZ },
          rotation: {
            x: myAvatar.rotation.x,
            y: myAvatar.rotation.y,
            z: myAvatar.rotation.z,
          },
          avatarUrl: myAvatarUrl, // Send always to be safe?
          activeEmojis: currentUser.academicStatus ? currentUser.academicStatus.activeEmojis : []
        });
  }
}

function createFallbackAvatar(isLocal, userMeta) {
  const group = new THREE.Group();
  group.userData.isGLB = false;
  group.userData = {
    ...(group.userData || {}),
    isPlayerAvatar: true,
    isLocal: !!isLocal,
    ownerUserId: userMeta?.userId || null,
    ownerFullName: userMeta?.fullName || "",
    ownerEmail: userMeta?.email || null,
    ownerRole: userMeta?.role || null,
    ownerUnread: 0
  };
  
  // Body (Capsule)
  const bodyGeom = new THREE.CapsuleGeometry(0.35, 1.2, 4, 8);
  const bodyMat = new THREE.MeshStandardMaterial({ 
    color: isLocal ? 0x00f2ff : 0xbd00ff,
    metalness: 0.5,
    roughness: 0.2,
    emissive: isLocal ? 0x00f2ff : 0xbd00ff,
    emissiveIntensity: 0.2
  });
  const body = new THREE.Mesh(bodyGeom, bodyMat);
  body.position.y = 0.95; // Half of height + offset from floor
  body.userData = { ...(body.userData || {}), ownerUserId: userMeta?.userId || null };
  group.add(body);
  
  // Head (Sphere)
  const headGeom = new THREE.SphereGeometry(0.25, 16, 16);
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const head = new THREE.Mesh(headGeom, headMat);
  head.position.y = 1.7;
  group.add(head);

  return group;
}

function setSittingPose(avatar) {
  if (!avatar) return;
}

function setupSocketListeners() {
  socket.on('room:users', (roomUsers) => {
    roomUsers.forEach((u) => {
      // Skip teacher/admin users entirely!
      if (u.role === "TEACHER" || u.role === "ADMIN") {
          // If they exist in players, remove them
          const key = u.sessionId || u.id;
          if (players.has(key)) removePlayer(key);
          return;
      }
      
      // Check if this user is me (only for non-teacher!)
      if (socket && u.sessionId === socket.id) {
          // If server assigned a seat and I'm not sitting yet
          if (u.seatId !== null && mySeatId === null) {
              const seat = seats.find(s => s.userData.id === u.seatId);
              if (seat) {
                   const seatWorldPos = new THREE.Vector3();
                   seat.getWorldPosition(seatWorldPos);
                   
                   // Only sit if not a teacher (which we already checked)
                   sitOnSeat(u.seatId, seatWorldPos);
              }
          }
      }
      updatePlayer(u);
    });
    
    const currentIds = new Set(roomUsers.map((u) => u.sessionId));
    for (const [sessionId] of players) {
      if (!currentIds.has(sessionId)) {
        removePlayer(sessionId);
      }
    }
  });

  socket.on('player:updated', (data) => {
    updatePlayer(data);
  });

  socket.on('player:left', (sessionId) => {
    removePlayer(sessionId);
  });

  // Listen for personal evaluation updates
  socket.on('evaluation:updated', (data) => {
      console.log("Received evaluation update:", data);
      if (currentUser) {
          if (!currentUser.academicStatus) currentUser.academicStatus = {};
          
          currentUser.academicStatus.remarks = data.remarks;
          currentUser.academicStatus.statusEmoji = data.statusEmoji;
          currentUser.academicStatus.activeEmojis = data.activeEmojis;
          
          // Update local display
          updatePlayerEmoji(socket.id, data.activeEmojis || data.statusEmoji);
          
          // Broadcast to others
          socket.emit('player:update', {
              activeEmojis: data.activeEmojis || data.statusEmoji
          });
      }
  });
}

function updatePlayer(data) {
  if (!socket) return;
  if (data.sessionId && data.sessionId === socket.id) return;
  
  // Ignore teacher/non-student avatars!
  if (data.role && (data.role === "TEACHER" || data.role === "ADMIN")) {
    const key = data.sessionId || data.id;
    if (players.has(key)) removePlayer(key);
    return;
  }

  const key = data.sessionId || data.id;
  const userMeta = {
    userId: data.userId || data.id || data._id,
    fullName: data.fullName || data.username || "",
    email: data.email,
    role: data.role
  };
  let player = players.get(key);
  
  // Check if we need to upgrade from Cylinder to GLB
  if (player && !player.isGLB && data.avatarUrl) {
      scene.remove(player.mesh);
      players.delete(key);
      player = null;
  }
  
  if (!player) {
    if (players.has(key + "_loading")) return;
    
    if (data.avatarUrl) {
      players.set(key + "_loading", true);
      
      let targetUrl = data.avatarUrl;
      const isExternal = targetUrl.startsWith("http") && !targetUrl.includes(window.location.host);
      if (isExternal) {
          targetUrl = `/api/avatar-proxy?url=${encodeURIComponent(targetUrl)}`;
      }

      loader.load(targetUrl, (gltf) => {
        if (!players.has(key + "_loading")) return;
        
        if (players.has(key) && players.get(key) !== true) {
             const existing = players.get(key);
             scene.remove(existing.mesh);
        }

        const mesh = gltf.scene;
        if (data.isSitting && data.position) {
          setSittingPose(mesh);
          mesh.position.set(data.position.x, data.position.y, data.position.z);
        } else if (data.position) {
          mesh.position.set(data.position.x, data.position.y, data.position.z);
        }
        mesh.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            child.frustumCulled = false;
          }
        });
        mesh.frustumCulled = false;
        markAvatarOwnerMeta(mesh, userMeta);

        scene.add(mesh);
        
        addNameLabel(mesh, data.fullName || data.username || "");
        
        players.set(key, { mesh, data, isGLB: true });
        players.delete(key + "_loading");
        
        updatePlayer({ ...data, sessionId: key });
      }, undefined, (error) => {
          console.warn("Remote avatar load failed", error);
          players.delete(key + "_loading");
          const mesh = createFallbackAvatar(false, userMeta);
          mesh.userData.isGLB = false;
          if (data.position) {
            mesh.position.set(data.position.x, data.position.y, data.position.z);
          }
          scene.add(mesh);
          addNameLabel(mesh, data.fullName || data.username || "");
          players.set(key, { mesh, data, isGLB: false });
          updatePlayer({ ...data, sessionId: key });
      });
      return;
    }

    const geometry = new THREE.CapsuleGeometry(0.3, 0.3, 1.6, 16);
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff * Math.random() });
    const mesh = createFallbackAvatar(false, userMeta);
    const capsuleMesh = new THREE.Mesh(geometry, material);
    capsuleMesh.position.set(0, 0.6, 0);
    mesh.add(capsuleMesh);
    if (data.position) mesh.position.set(data.position.x, data.position.y, data.position.z);
    scene.add(mesh);
    addNameLabel(mesh, data.fullName || data.username || "");

    player = { mesh, data, isGLB: false };
    players.set(key, player);
  } else {
    // Update existing avatar meta
    if (player.mesh) {
      markAvatarOwnerMeta(player.mesh, userMeta);
    }
  }

  // Update position
  if (data.seatId !== null && data.seatId !== undefined) {
      // If user is sitting, snap to seat position (authoritative source for seat location)
      const seat = seats.find(s => s.userData.id === data.seatId);
      if (seat) {
          const seatPos = new THREE.Vector3();
          seat.getWorldPosition(seatPos);
          // Use seat position, but keep Y adjustment logic if needed
          // For now, seatPos.y is around 0.75 (hitbox center)
          // sitOnSeat uses this directly.
          if (player.mesh) {
              // Adjust Y for capsule vs GLB if needed, similar to sitOnSeat
              let y = seatPos.y; 
              // But sitOnSeat does specific logic. 
              // Let's just trust the seat position X/Z and maybe Y
              
              let finalY = 0;
              if (data.seatId === TEACHER_SEAT_ID) {
                  finalY = 0.2;
              } else if (!player.isGLB) {
                  finalY = 0.6 + seatPos.y;
              }
              player.mesh.position.set(seatPos.x, finalY, seatPos.z);
              
              // Also rotation: face the teacher?
               if (teacherSeatWorldPos && data.seatId !== TEACHER_SEAT_ID) {
                    const target = teacherSeatWorldPos.clone();
                    target.y = seatPos.y;
                    const dir = new THREE.Vector3().subVectors(target, player.mesh.position);
                    const yaw = Math.atan2(dir.x, dir.z);
                    player.mesh.rotation.set(0, yaw + Math.PI, 0);
               } else if (data.seatId === TEACHER_SEAT_ID) {
                   // Teacher faces the class (z=2)
                   if (teacherSeatWorldPos) {
                       const target = teacherSeatWorldPos.clone();
                       target.z = 2;
                       target.y = seatPos.y;
                       const dir = new THREE.Vector3().subVectors(target, player.mesh.position);
                       const yaw = Math.atan2(dir.x, dir.z);
                       player.mesh.rotation.set(0, yaw + Math.PI, 0);
                   }
               }
          }
      }
  } else if (data.position && player.mesh) {
    player.mesh.position.set(data.position.x, data.position.y, data.position.z);
  }
  
  if (data.rotation && player.mesh && data.seatId === null) { // Only apply manual rotation if not sitting (sitting enforces teacher-facing)
    const rx = data.rotation.x || 0;
    const ry = data.rotation.y || 0;
    const rz = data.rotation.z || 0;
    player.mesh.rotation.set(rx, ry, rz);
  }

  // Update Emoji
  if (data.activeEmojis !== undefined) {
      updatePlayerEmoji(key, data.activeEmojis);
  } else if (data.statusEmoji !== undefined) {
      updatePlayerEmoji(key, data.statusEmoji);
  }
  
  // Update state (sitting/standing color change?)
  if (data.isSitting && player.mesh) {
      if (!player.data.isSitting) { // If just sat down
          setSittingPose(player.mesh);
      }
      // Re-apply pose just in case
      setSittingPose(player.mesh);
  }

  // Update stored data
  Object.assign(player.data, data);
}

function addNameLabel(avatar, label) {
  if (!label) {
    console.log("No label provided for avatar");
    return;
  }
  
  console.log("Adding name label:", label);

  const nameCanvas = document.createElement('canvas');
  nameCanvas.width = 512;
  nameCanvas.height = 160;
  const nameCtx = nameCanvas.getContext('2d');
  
  // Clear canvas
  nameCtx.clearRect(0, 0, 512, 160);
  
  // Simple text without background or border
  nameCtx.textAlign = 'center';
  nameCtx.textBaseline = 'middle';
  
  // No glow effect
  nameCtx.shadowColor = 'transparent';
  nameCtx.shadowBlur = 0;
  
  // Main text - simple white (no bold)
  nameCtx.font = '34px Arial, sans-serif';
  nameCtx.fillStyle = '#ffffff';
  nameCtx.fillText(label, 256, 80);
  
  const nameTexture = new THREE.CanvasTexture(nameCanvas);
  nameTexture.colorSpace = THREE.SRGBColorSpace;
  nameTexture.needsUpdate = true;
  
  const nameMaterial = new THREE.SpriteMaterial({
    map: nameTexture,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    depthTest: false
  });
  
  const nameSprite = new THREE.Sprite(nameMaterial);
  nameSprite.name = 'id_label';
  nameSprite.scale.set(1.6, 0.4, 1);
  nameSprite.position.set(0, 0.05, 0.5); // Position in front of avatar
  nameSprite.renderOrder = 999; // Render last, on top
  avatar.add(nameSprite);
  console.log("Name label added successfully");
}

function removePlayer(userId) {
  const player = players.get(userId);
  if (player) {
    scene.remove(player.mesh);
    players.delete(userId);
  }
}

function updateAvatarUnreadBadgeClass(avatarRoot) {
  if (!avatarRoot) return;
  const count = Math.max(0, avatarRoot.userData?.ownerUnread | 0);
  let badge = avatarRoot.getObjectByName('unread_badge');
  if (count <= 0) {
    if (badge) avatarRoot.remove(badge);
    return;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,256,256);
  ctx.fillStyle = '#ec4899';
  ctx.beginPath();
  ctx.arc(128,128,100,0,Math.PI*2);
  ctx.fill();
  ctx.strokeStyle = '#0f0f1e';
  ctx.lineWidth = 16;
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 130px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(count > 99 ? '99+' : String(count), 128, 132);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
  if (!badge) {
    badge = new THREE.Sprite(mat);
    badge.name = 'unread_badge';
    badge.renderOrder = 9999;
    badge.scale.set(0.45, 0.45, 1);
    badge.position.set(0.4, 2.6, 0.4);
    avatarRoot.add(badge);
  } else {
    badge.material.map && badge.material.map.dispose && badge.material.map.dispose();
    badge.material = mat;
  }
}

window.classIncrementAvatarUnread = function classIncrementAvatarUnread(userId, amount = 1) {
  if (!userId) return;
  players.forEach((p) => {
    if (p.mesh && p.mesh.userData?.ownerUserId && String(p.mesh.userData.ownerUserId) === String(userId)) {
      p.mesh.userData.ownerUnread = (p.mesh.userData.ownerUnread | 0) + amount;
      updateAvatarUnreadBadgeClass(p.mesh);
    }
  });
};
window.classClearAvatarUnread = function classClearAvatarUnread(userId) {
  if (!userId) return;
  players.forEach((p) => {
    if (p.mesh && p.mesh.userData?.ownerUserId && String(p.mesh.userData.ownerUserId) === String(userId)) {
      p.mesh.userData.ownerUnread = 0;
      updateAvatarUnreadBadgeClass(p.mesh);
    }
  });
};

function updateBoard(time) {
  if (!boardCtx || !boardTexture) return;

  // Change slide every 5 seconds
  if (time - lastBoardUpdate > 5) {
    lastBoardUpdate = time;
    currentSlide = (currentSlide + 1) % slides.length;
    drawBoardSlide(slides[currentSlide]);
  }
}

function drawBoardSlide(slide) {
  if (!boardCtx) return;
  const ctx = boardCtx;
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;

  // Clear
  ctx.clearRect(0, 0, w, h);

  // Background (Semi-transparent dark blue)
  ctx.fillStyle = 'rgba(0, 10, 30, 0.9)';
  ctx.fillRect(0, 0, w, h);
  
  // Grid pattern (Holo effect)
  ctx.strokeStyle = 'rgba(0, 255, 255, 0.1)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for(let x=0; x<w; x+=40) { ctx.moveTo(x,0); ctx.lineTo(x,h); }
  for(let y=0; y<h; y+=40) { ctx.moveTo(0,y); ctx.lineTo(w,y); }
  ctx.stroke();

  // Border
  ctx.strokeStyle = '#00aaff';
  ctx.lineWidth = 4;
  ctx.strokeRect(10, 10, w-20, h-20);

  // Header
  ctx.fillStyle = '#00ffff';
  ctx.font = 'bold 50px Arial';
  ctx.textAlign = 'center';
  ctx.shadowColor = '#00ffff';
  ctx.shadowBlur = 10;
  ctx.fillText(slide.title, w/2, 80);
  ctx.shadowBlur = 0;
  
  // Separator
  ctx.beginPath();
  ctx.moveTo(100, 100);
  ctx.lineTo(w-100, 100);
  ctx.strokeStyle = '#00aaff';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Content
  ctx.fillStyle = '#e0f7fa';
  ctx.font = '35px Arial';
  ctx.textAlign = 'left';
  let y = 180;
  slide.content.forEach(line => {
    ctx.fillText("• " + line, 150, y);
    y += 70;
  });

  // Footer / Progress Bar
  const progress = (currentSlide + 1) / slides.length;
  ctx.fillStyle = '#003366';
  ctx.fillRect(50, h-40, w-100, 10);
  ctx.fillStyle = '#00ffff';
  ctx.shadowColor = '#00ffff';
  ctx.shadowBlur = 10;
  ctx.fillRect(50, h-40, (w-100) * progress, 10);
  ctx.shadowBlur = 0;

  if (boardTexture) boardTexture.needsUpdate = true;
}

function animate() {
  requestAnimationFrame(animate);
  
  const time = performance.now() * 0.001;
  updateBoard(time);

  if (controls) controls.update();
  if (renderer && scene && camera) renderer.render(scene, camera);
}

function createEmojiTexture(data) {
    const emoji = typeof data === 'object' ? data.emoji : data;

    const canvas = document.createElement('canvas');
    canvas.width = 256; 
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    
    // Clear
    ctx.clearRect(0, 0, 256, 256);

    // Draw Emoji (smaller, flatter, moins lumineux)
    ctx.font = '140px Arial'; 
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.6;

    ctx.fillText(emoji, 128, 138);
    
    const texture = new THREE.CanvasTexture(canvas);
    return texture;
}

export function updatePlayerEmoji(sessionId, emojiData) {
    let playerObj = null;
    if (socket && sessionId === socket.id) {
        if (!myAvatar) return; // Not loaded yet
        playerObj = { mesh: myAvatar };
    } else {
        playerObj = players.get(sessionId);
    }

    if (!playerObj || !playerObj.mesh) return;

    // Remove existing emoji(s)
    for (let i = playerObj.mesh.children.length - 1; i >= 0; i--) {
        const child = playerObj.mesh.children[i];
        if (child.name && child.name.startsWith("status_emoji")) {
            playerObj.mesh.remove(child);
        }
    }

    if (!emojiData) return;

    // Normalize input to array of OBJECTS
    let items = [];
    if (Array.isArray(emojiData)) {
        // Handle objects from backend { emoji: "X", remarks: "Y" } or strings
        items = emojiData.map(e => (typeof e === 'object' ? e : { emoji: e, remarks: "" }));
    } else if (typeof emojiData === 'string') {
        items = [{ emoji: emojiData, remarks: "" }];
    }
    
    // Filter empty emojis
    items = items.filter(e => e.emoji && e.emoji.trim() !== "");

    if (items.length === 0) return;

    // Calculate positions
    // Texture is 512x256 (2:1 ratio). Sprite scale should be (1, 0.5).
    // Effective visual width of emoji is about 0.5 units.
    // With badge, it's wider.
    
    const spacing = 1.2; 
    const totalWidth = (items.length - 1) * spacing;
    const startX = -totalWidth / 2;

    items.forEach((item, index) => {
        const map = createEmojiTexture(item);
        const material = new THREE.SpriteMaterial({ 
            map: map,
            transparent: true,
            opacity: 0.7,
            depthWrite: false
        });
        const sprite = new THREE.Sprite(material);
        sprite.name = "status_emoji_" + index;
        
        // Store metadata for tooltip
        sprite.userData = {
            isEmoji: true,
            teacherName: item.teacherName || "Professeur",
            subject: item.subject || "Général",
            remarks: item.remarks || ""
        };
        
        // Scale to match square aspect ratio (reduced size)
        sprite.scale.set(0.55, 0.55, 1.0); 
        
        const xPos = startX + (index * spacing);
        sprite.position.set(xPos, 2.4, 0); 
        
        playerObj.mesh.add(sprite);
    });
}
