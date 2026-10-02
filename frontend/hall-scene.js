import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

let scene, camera, renderer, composer, controls;
let socket;
let currentUser;
let portals = [];
let hoveredPortal = null;
let isCameraAnimating = false;
let mixer; // Animation Mixer for Local Avatar
let localAvatarMesh = null; // Store local avatar mesh to update position later
let localLightingGroup = null; // Store lighting group to move with avatar
let otherPlayers = {}; // Map of sessionId -> { mesh, mixer }
let emojiTooltip = null;

// Config "Sirena Style"
const params = {
  bloomStrength: 0.6,
  bloomRadius: 0.25,
  bloomThreshold: 0.2,
  fogColor: 0x050510,
  bgColor: 0x050510
};

export function initHallScene(sock, user, containerId, avatarUrl) {
  socket = sock;
  currentUser = user;

  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = '';

  // 1. Scene Setup
  scene = new THREE.Scene();
  scene.background = new THREE.Color(params.bgColor);
  scene.fog = new THREE.FogExp2(params.fogColor, 0.015); // Exponential fog for depth

  // 2. Camera
  camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 1000);
  camera.position.set(0, 8, 32);

  // 3. Renderer (High Quality)
  renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: "high-performance" });
  renderer.setSize(container.clientWidth, container.clientHeight);
  const maxPixelRatio = 1.5;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPixelRatio));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  container.appendChild(renderer.domElement);

  // 4. Post-Processing (Bloom is key for "Sirena" look)
  const renderScene = new RenderPass(scene, camera);

  const bloomPass = new UnrealBloomPass(new THREE.Vector2(container.clientWidth, container.clientHeight), 1.0, 0.3, 0.85);
  bloomPass.threshold = params.bloomThreshold;
  bloomPass.strength = params.bloomStrength;
  bloomPass.radius = params.bloomRadius;

  composer = new EffectComposer(renderer);
  composer.addPass(renderScene);
  composer.addPass(bloomPass);

  // 5. Lighting (Cinematic)
  setupLighting();

  // 6. World Generation
  createEnvironment();
  createMainBuilding();
  createPortals();
  createDecorations();
  createCampusBuildings();
  createParticles(); // Floating "dust"

  const myEmoji = currentUser.academicStatus ? (currentUser.academicStatus.activeEmojis || currentUser.academicStatus.statusEmoji) : "";
  const myLabel = currentUser.fullName || currentUser.username || "";
  
  // If the user is a teacher or admin, don't spawn an avatar for them
  const isTeacherOrAdmin = currentUser.role === "TEACHER" || currentUser.role === "ADMIN";
  
  if (!isTeacherOrAdmin) {
    spawnAvatar(avatarUrl || null, true, socket.id, {x:0, y:0, z:0}, myEmoji, myLabel);
    
    if (avatarUrl) {
      socket.emit('player:update', {
        avatarUrl: avatarUrl,
        activeEmojis: currentUser.academicStatus ? (currentUser.academicStatus.activeEmojis || currentUser.academicStatus.statusEmoji) : []
      });
    }
  }

  const layoutHallUsers = (users) => {
    if (!users || users.length === 0) return;
    const slots = [
      { x: -3.5, z: 3.5 },
      { x: 0, z: 3.5 },
      { x: 3.5, z: 3.5 }
    ];
    const ordered = [...users].sort((a, b) => {
      if (a.sessionId < b.sessionId) return -1;
      if (a.sessionId > b.sessionId) return 1;
      return 0;
    });
    ordered.forEach((u, index) => {
      const base = slots[index] || { x: 0, z: 3.5 + 3 * (index - 2) };
      if (u.sessionId === socket.id && localAvatarMesh) {
        localAvatarMesh.position.set(base.x, 0, base.z);
        if (localLightingGroup) {
          localLightingGroup.position.copy(localAvatarMesh.position);
        }
      } else {
        const p = otherPlayers[u.sessionId];
        if (p && p.mesh) {
          p.mesh.position.set(base.x, 0, base.z);
          if (p.lightGroup) {
            p.lightGroup.position.copy(p.mesh.position);
          }
        }
      }
    });
  };

  // 6.6 Setup Multiplayer Listeners
  socket.on('room:users', (users) => {
    // Sync all users in the room
    users.forEach(u => {
        // Check if this user is a teacher or admin (we don't want to show their avatars)
        const isOtherUserTeacherOrAdmin = u.role === "TEACHER" || u.role === "ADMIN";
        
        if (u.sessionId === socket.id) {
            // It's me! Skip since we already handled it earlier
            return;
        }
        
        // Only spawn avatars for non-teacher/non-admin users
        if (!isOtherUserTeacherOrAdmin) {
            if (!otherPlayers[u.sessionId]) {
                const label = u.fullName || u.username || "";
                const userMeta = {
                    userId: u.userId || u.id || u._id,
                    fullName: u.fullName || u.username || "",
                    email: u.email,
                    role: u.role
                };
                if (u.avatarUrl) {
                    spawnAvatar(u.avatarUrl, false, u.sessionId, u.position, u.activeEmojis || u.statusEmoji, label, userMeta);
                } else {
                    spawnAvatar(null, false, u.sessionId, u.position, u.activeEmojis || u.statusEmoji, label, userMeta);
                }
            } else {
                 // Existing player, update emoji & meta
                 if (otherPlayers[u.sessionId].mesh) {
                    otherPlayers[u.sessionId].mesh.userData.ownerUserId = u.userId || u.id || u._id;
                    otherPlayers[u.sessionId].mesh.userData.ownerFullName = u.fullName || u.username || "";
                    otherPlayers[u.sessionId].mesh.userData.ownerEmail = u.email;
                    otherPlayers[u.sessionId].mesh.userData.ownerRole = u.role;
                 }
                 updatePlayerEmoji(u.sessionId, u.activeEmojis || u.statusEmoji);
            }
        }
    });

    // Cleanup users who left (not in the list anymore)
    const activeSessionIds = users.map(u => u.sessionId);
    Object.keys(otherPlayers).forEach(sid => {
        if (!activeSessionIds.includes(sid)) {
            removePlayer(sid);
        }
    });

    layoutHallUsers(users);
  });

  socket.on('player:updated', (data) => {
      // data: { sessionId, avatarUrl, position, statusEmoji, ... }
      if (data.sessionId === socket.id) return;
      
      // Don't process teacher/admin avatars
      const isOtherUserTeacherOrAdmin = data.role === "TEACHER" || data.role === "ADMIN";
      if (isOtherUserTeacherOrAdmin) return;

      const playerObj = otherPlayers[data.sessionId];
      if (playerObj) {
          // Update Position
          if (data.position && playerObj.mesh) {
            // Simple snap for now (could be lerped)
            playerObj.mesh.position.set(data.position.x, data.position.y, data.position.z);
            if (playerObj.lightGroup) {
              playerObj.lightGroup.position.copy(playerObj.mesh.position);
            }
          }
          // Update Emoji
          if (data.activeEmojis !== undefined || data.statusEmoji !== undefined) {
              updatePlayerEmoji(data.sessionId, data.activeEmojis || data.statusEmoji);
          }
      } else {
          const label = data.fullName || data.username || "";
          const userMeta = {
            userId: data.userId || data.id || data._id,
            fullName: data.fullName || data.username || "",
            email: data.email,
            role: data.role
          };
          if (data.avatarUrl) {
              spawnAvatar(data.avatarUrl, false, data.sessionId, data.position, data.activeEmojis || data.statusEmoji, label, userMeta);
          } else {
              spawnAvatar(null, false, data.sessionId, data.position, data.activeEmojis || data.statusEmoji, label, userMeta);
          }
      }
  });

  socket.on('player:left', (sessionId) => {
      removePlayer(sessionId);
  });

  // 7. Controls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.minDistance = 40;
  controls.maxDistance = 80;
  controls.maxPolarAngle = Math.PI / 2 - 0.05; // Don't go below ground
  controls.minAzimuthAngle = -Math.PI / 3;
  controls.maxAzimuthAngle = Math.PI / 3;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.5;
  controls.target.set(0, 4, 0);

  // 8. Interaction
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  let hoveredAvatar = null;
  let _privateChatHandler = null;

  window.openPrivateChatWithAvatar = function setPrivateChatHandler(fn) {
    if (typeof fn === 'function') _privateChatHandler = fn;
  };
  window.openPrivateChatWithAvatar.handler = () => _privateChatHandler;

  function findPlayerAvatarRoot(obj) {
    let cur = obj;
    let guard = 0;
    while (cur && guard++ < 30) {
      if (cur.userData && cur.userData.isPlayerAvatar) return cur;
      cur = cur.parent;
    }
    return null;
  }

  function onMouseMove(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    
    // --- PORTALS INTERACTION ---
    const portalIntersects = raycaster.intersectObjects(portals, true);

    // --- EMOJIS INTERACTION ---
    const emojiSprites = [];
    // Remote players
    Object.values(otherPlayers).forEach(p => {
        if (p.mesh) {
            p.mesh.traverse(child => {
                if (child.isSprite && child.userData.isEmoji) emojiSprites.push(child);
            });
        }
    });
    // Local player
    if (localAvatarMesh) {
        localAvatarMesh.traverse(child => {
            if (child.isSprite && child.userData.isEmoji) emojiSprites.push(child);
        });
    }

    const emojiIntersects = raycaster.intersectObjects(emojiSprites);

    if (emojiIntersects.length > 0) {
        const sprite = emojiIntersects[0].object;
        const data = sprite.userData;
        
        if (!emojiTooltip) {
            createEmojiTooltip();
        }

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
        
        let x = event.clientX + 15;
        let y = event.clientY + 15;
        if (x + 200 > window.innerWidth) x = event.clientX - 210;
        if (y + 100 > window.innerHeight) y = event.clientY - 110;
        
        emojiTooltip.style.left = x + 'px';
        emojiTooltip.style.top = y + 'px';
        document.body.style.cursor = 'help';
        return; // Prioritize emoji hover over portal hover
    } else if (emojiTooltip) {
        emojiTooltip.style.display = 'none';
    }

    if (portalIntersects.length > 0) {
      document.body.style.cursor = 'pointer';
    } else {
      document.body.style.cursor = 'default';
    }
  }

  function createEmojiTooltip() {
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

  function onClick(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    // 1) Emoji Sprites priority (no click action, hover only already handled)
    // 2) Portals
    const portalIntersects = raycaster.intersectObjects(portals, true);
    if (portalIntersects.length > 0) {
      const p = portalIntersects[0].object.parent; // Group is the portal
      if (p.userData.action === "open_classes_menu") {
        const menu = document.getElementById('portal-menu');
        if (menu) menu.classList.add('active');
      } else if (p.userData.url) {
        window.location.href = p.userData.url;
      }
      return;
    }

    // 3) Avatar click → private chat
    const avatarCandidates = [];
    Object.values(otherPlayers).forEach(p => {
      if (p.mesh) avatarCandidates.push(p.mesh);
    });
    if (avatarCandidates.length > 0) {
      const hits = raycaster.intersectObjects(avatarCandidates, true);
      if (hits.length > 0) {
        const root = findPlayerAvatarRoot(hits[0].object);
        if (root && !root.userData.isLocal) {
          const userId = root.userData.ownerUserId;
          const userName = root.userData.ownerFullName || "Utilisateur";
          // Clear unread badge if any
          root.userData.ownerUnread = 0;
          updateAvatarUnreadBadge(root);
          if (typeof _privateChatHandler === 'function') {
            _privateChatHandler(userId, userName);
          } else if (window.wbcChatWidget && typeof window.wbcChatWidget.openPrivateChat === 'function') {
            if (!window.wbcChatWidget.isOpen) window.wbcChatWidget.toggleWidget();
            window.wbcChatWidget.openPrivateChat(userId, userName);
          } else {
            // Fallback: try static WBCChatWidget
            if (window.WBCChatWidget && typeof window.WBCChatWidget.startChatWith === 'function') {
              window.WBCChatWidget.startChatWith(userId, userName);
            }
          }
          return;
        }
      }
    }

    // 4) Click outside -> Close menu
    const menu = document.getElementById('portal-menu');
    if (menu && menu.classList.contains('active')) {
      menu.classList.remove('active');
    }
  }

  window.addEventListener('resize', onWindowResize);
  renderer.domElement.addEventListener('mousemove', onMouseMove);
  renderer.domElement.addEventListener('click', onClick);

  function onWindowResize() {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
    composer.setSize(container.clientWidth, container.clientHeight);
  }

  animate();
}

function setupLighting() {
  // Ambient - very low for contrast
  const ambient = new THREE.AmbientLight(0xffffff, 0.6); 
  scene.add(ambient);

  // Main Moonlight/Sunlight
  const dirLight = new THREE.DirectionalLight(0xaaccff, 2);
  dirLight.position.set(-20, 50, 20);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 1024;
  dirLight.shadow.mapSize.height = 1024;
  dirLight.shadow.bias = -0.0001;
  scene.add(dirLight);

  const backLight = new THREE.DirectionalLight(0x335577, 0.7);
  backLight.position.set(0, 40, -60);
  scene.add(backLight);

  // Orange Rim Light (Cyberpunk feel)
  const spotLight = new THREE.SpotLight(0xffaa00, 1000);
  spotLight.position.set(30, 20, 10);
  spotLight.angle = Math.PI / 4;
  spotLight.penumbra = 0.5;
  spotLight.castShadow = false;
  scene.add(spotLight);

  // Blue fill from bottom
  const hemiLight = new THREE.HemisphereLight(0x88aaff, 0x050510, 0.9);
  scene.add(hemiLight);
}

function createEnvironment() {
  // Infinite grid floor with reflection
  const gridHelper = new THREE.GridHelper(200, 50, 0x444444, 0x111111);
  scene.add(gridHelper);

  const planeGeo = new THREE.PlaneGeometry(200, 200);
  const planeMat = new THREE.MeshStandardMaterial({ 
    color: 0x050510,
    roughness: 0.1,
    metalness: 0.5
  });
  const plane = new THREE.Mesh(planeGeo, planeMat);
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = -0.1;
  plane.receiveShadow = true;
  scene.add(plane);
}

function createMainBuilding() {
  const structureMat = new THREE.MeshStandardMaterial({
    color: 0x111111,
    roughness: 0.25,
    metalness: 0.7
  });

  const neonMat = new THREE.MeshBasicMaterial({
    color: 0x00ffff
  });

  const building = new THREE.Group();

  // 2. Neon Rings
  const ringGeo = new THREE.TorusGeometry(15.2, 0.1, 8, 50);
  const ring1 = new THREE.Mesh(ringGeo, neonMat);
  ring1.rotation.x = Math.PI / 2;
  ring1.position.y = 12;
  building.add(ring1);

  const ring2 = new THREE.Mesh(ringGeo, neonMat);
  ring2.rotation.x = Math.PI / 2;
  ring2.position.y = 0.5;
  building.add(ring2);

  // 3. Floating Roof (contour only)
  const roofGeo = new THREE.CylinderGeometry(18, 16, 1, 16);
  const roofEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(roofGeo),
    new THREE.LineBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.4 })
  );
  roofEdges.position.y = 13;
  building.add(roofEdges);

  // 4. Logo Text (WBC) - Neon Tubes Construction (No external assets)
  const logoGroup = new THREE.Group();
  const logoNeonMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
  const tubeRadius = 0.3;

  // Helper to create a tube line
  function createLine(x1, y1, x2, y2) {
    const height = Math.sqrt((x2-x1)**2 + (y2-y1)**2);
    const geo = new THREE.CylinderGeometry(tubeRadius, tubeRadius, height, 8);
    const mesh = new THREE.Mesh(geo, logoNeonMat);
    
    // Position: mid-point
    mesh.position.set((x1+x2)/2, (y1+y2)/2, 0);
    
    // Rotation:
    const angle = Math.atan2(x2-x1, y2-y1);
    mesh.rotation.z = -angle;
    
    return mesh;
  }

  // Letter W
  const wGroup = new THREE.Group();
  wGroup.add(createLine(-2, 4, -1.5, 0));
  wGroup.add(createLine(-1.5, 0, -0.5, 2));
  wGroup.add(createLine(-0.5, 2, 0.5, 0));
  wGroup.add(createLine(0.5, 0, 1, 4));
  wGroup.position.x = -4;
  logoGroup.add(wGroup);

  // Letter B
  const bGroup = new THREE.Group();
  bGroup.add(createLine(-1, 0, -1, 4)); // Vertical
  // Loops using Torus
  const loopGeo = new THREE.TorusGeometry(1, tubeRadius, 8, 16, Math.PI);
  const loop1 = new THREE.Mesh(loopGeo, logoNeonMat);
  loop1.position.set(-1, 3, 0);
  loop1.rotation.z = -Math.PI / 2;
  bGroup.add(loop1);
  
  const loop2 = new THREE.Mesh(loopGeo, logoNeonMat);
  loop2.position.set(-1, 1, 0);
  loop2.rotation.z = -Math.PI / 2;
  bGroup.add(loop2);
  
  bGroup.position.x = 0;
  logoGroup.add(bGroup);

  // Letter C
  const cGroup = new THREE.Group();
  const cGeo = new THREE.TorusGeometry(2, tubeRadius, 8, 24, Math.PI * 1.5);
  const cMesh = new THREE.Mesh(cGeo, logoNeonMat);
  cMesh.rotation.z = Math.PI / 4;
  cGroup.add(cMesh);
  cGroup.position.x = 4;
  cGroup.position.y = 2;
  logoGroup.add(cGroup);

  logoGroup.position.set(0, 10, 0);
  logoGroup.scale.set(1.6, 1.6, 1.6);
  building.add(logoGroup);

  building.scale.set(1.6, 1.6, 1.6);
  scene.add(building);
}

function createPortals() {
  const locations = [
    { x: -18, z: 8, label: "Classes", color: 0xffaa00, action: "open_classes_menu" },
    { x: 0, z: -14, label: "Feed", color: 0x00ffff, url: "feed.html" },
    { x: 18, z: 8, label: "Chatbot", color: 0x7000ff, url: "ai-assistant.html" }
  ];

  locations.forEach(loc => {
    const group = new THREE.Group();
    group.position.set(loc.x, 4, loc.z);
    // Face center
    group.lookAt(0, 0, 0);
    
    // Store data
    group.userData = { url: loc.url, action: loc.action };

    // 1. Black Hole Core (Singularity)
    const coreGeo = new THREE.SphereGeometry(1.5, 32, 32);
    const coreMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.userData = { portal: true }; // Hit target
    group.add(core);
    portals.push(core);

    // 2. Event Horizon (Glowing Rim)
    const horizonGeo = new THREE.RingGeometry(1.48, 1.6, 64);
    const horizonMat = new THREE.MeshBasicMaterial({ 
      color: 0xffffff, 
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.9
    });
    const horizon = new THREE.Mesh(horizonGeo, horizonMat);
    group.add(horizon);

    // 3. Accretion Disk (Swirling Particles)
    const particlesGeo = new THREE.BufferGeometry();
    const particleCount = 800;
    const posArray = new Float32Array(particleCount * 3);
    const sizeArray = new Float32Array(particleCount);
    
    for(let i=0; i<particleCount; i++) {
        // Spiral distribution
        const angle = Math.random() * Math.PI * 2;
        const radius = 1.8 + Math.random() * 3.5; 
        
        posArray[i*3] = Math.cos(angle) * radius;
        posArray[i*3+1] = (Math.random() - 0.5) * 0.4; // Flattened
        posArray[i*3+2] = Math.sin(angle) * radius;

        sizeArray[i] = Math.random();
    }
    particlesGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
    particlesGeo.setAttribute('size', new THREE.BufferAttribute(sizeArray, 1));

    const diskMat = new THREE.PointsMaterial({
        color: loc.color,
        size: 0.15,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending
    });
    const disk = new THREE.Points(particlesGeo, diskMat);
    group.add(disk);

    // 4. Vertical Energy Rings (Teleportation Tech)
    const torusGeo = new THREE.TorusGeometry(5, 0.02, 16, 100);
    const torusMat = new THREE.MeshBasicMaterial({ color: loc.color, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending });
    
    const ring1 = new THREE.Mesh(torusGeo, torusMat);
    const ring2 = new THREE.Mesh(torusGeo, torusMat);
    
    group.add(ring1);
    group.add(ring2);

    // 5. Dynamic Light
    const light = new THREE.PointLight(loc.color, 4, 15);
    group.add(light);

    // 6. Label (Sprite)
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 1024;
    canvas.height = 256;
    
    // Background Box for readability
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(50, 20, 924, 216, 40) : ctx.fillRect(50, 20, 924, 216);
    ctx.fill();
    
    // Border
    ctx.strokeStyle = '#'+loc.color.toString(16).padStart(6, '0');
    ctx.lineWidth = 5;
    ctx.stroke();

    // Text
    ctx.font = 'bold 100px Arial';
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    
    // Glow effect for text
    ctx.shadowColor = '#'+loc.color.toString(16).padStart(6, '0');
    ctx.shadowBlur = 8;
    
    ctx.fillText(loc.label, 512, 170);

    const texture = new THREE.CanvasTexture(canvas);
    // Standard blending (not additive) so it stands out against bright backgrounds
    const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.position.y = 7.5;
    sprite.scale.set(12, 3, 1);
    group.add(sprite);

    // 7. Hit Box (Large Invisible Click Target)
    // Covers both the portal core/rings and the label above it
    const hitGeo = new THREE.BoxGeometry(16, 16, 2);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    const hitBox = new THREE.Mesh(hitGeo, hitMat);
    hitBox.position.y = 6; 
    group.add(hitBox);
    portals.push(hitBox);

    // Animation Logic
    group.userData = { url: loc.url, action: loc.action };
    group.userData.animate = (time) => {
      // 1. Horizon always faces camera
      horizon.lookAt(camera.position);

      // 2. Rotate Disk (Vortex effect)
      disk.rotation.y = -time * 2.5;

      // 3. Rotate Rings randomly
      ring1.rotation.x = time * 0.5;
      ring1.rotation.y = time * 0.3;
      
      ring2.rotation.x = time * 0.4 + Math.PI/2;
      ring2.rotation.z = time * 0.6;

      // 4. Float entire portal
      group.position.y = 4 + Math.sin(time + loc.x) * 0.2;

      // 5. Pulse Light
      light.intensity = 3 + Math.sin(time * 5) * 1.5;
    };

    scene.add(group);
  });
}

function createDecorations() {
  // 1. Floating Ring/Orbit (Surrounding the capsule)
  const orbitGeo = new THREE.TorusGeometry(60, 0.4, 8, 64); // Thicker tube
  const orbitMat = new THREE.MeshBasicMaterial({ color: 0x00aaff, transparent: true, opacity: 0.6 }); // Brighter
  const orbit = new THREE.Mesh(orbitGeo, orbitMat);
  orbit.rotation.x = Math.PI / 2;
  orbit.position.y = 7;
  scene.add(orbit);

  // 3. Floor Pathways (Glowing Lines)
  const pathMat = new THREE.LineBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.3 });
  
  // Create paths to portals
  const portals = [
    { x: -18, z: 8 },
    { x: 0, z: -14 },
    { x: 18, z: 8 }
  ];

  portals.forEach(p => {
    const points = [];
    points.push(new THREE.Vector3(0, 0.1, 0)); // Center
    // Midpoint curve
    points.push(new THREE.Vector3(p.x * 0.5, 0.1, p.z * 0.5)); 
    points.push(new THREE.Vector3(p.x, 0.1, p.z)); // Portal

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geometry, pathMat);
    scene.add(line);
    
    // Moving pulse on the line
    const pulseGeo = new THREE.BoxGeometry(0.5, 0.1, 0.5);
    const pulseMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const pulse = new THREE.Mesh(pulseGeo, pulseMat);
    
    pulse.userData = {
      start: new THREE.Vector3(0, 0.1, 0),
      end: new THREE.Vector3(p.x, 0.1, p.z),
      progress: 0,
      speed: 0.5 + Math.random() * 0.5
    };
    
    pulse.userData.animate = (time) => {
      pulse.userData.progress += 0.01 * pulse.userData.speed;
      if(pulse.userData.progress > 1) pulse.userData.progress = 0;
      
      pulse.position.lerpVectors(pulse.userData.start, pulse.userData.end, pulse.userData.progress);
    };
    
    scene.add(pulse);
  });
}

function createCampusBuildings() {
  const campuses = [
    { label: "Wes'sup Lyon", color: 0x00f2ff, x: -34, z: -18, rotY: Math.PI / 10 },
    { label: "Wes'sup Genève", color: 0xff3aa6, x: 0, z: -38, rotY: 0 },
    { label: "Wes'sup St-Genis Pouilly", color: 0xffaa00, x: 34, z: -18, rotY: -Math.PI / 10 },
  ];

  const baseMat = new THREE.MeshStandardMaterial({
    color: 0x0b0d12,
    roughness: 0.4,
    metalness: 0.6,
  });

  campuses.forEach((c, i) => {
    const g = new THREE.Group();

    const w = 10;
    const d = 10;
    const h = 18;

    const core = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), baseMat);
    core.position.y = h / 2;
    core.castShadow = true;
    core.receiveShadow = true;
    g.add(core);

    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(core.geometry),
      new THREE.LineBasicMaterial({ color: c.color, transparent: true, opacity: 0.6 })
    );
    edge.position.copy(core.position);
    g.add(edge);

    const stripMat = new THREE.MeshBasicMaterial({ color: c.color, transparent: true, opacity: 0.9 });
    const stripGeo = new THREE.BoxGeometry(0.22, h * 0.9, 0.22);
    const strip1 = new THREE.Mesh(stripGeo, stripMat);
    strip1.position.set(-w / 2 + 0.25, h * 0.5, -d / 2 + 0.25);
    g.add(strip1);
    const strip2 = strip1.clone();
    strip2.position.set(w / 2 - 0.25, h * 0.5, d / 2 - 0.25);
    g.add(strip2);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(w * 1.05, 0.25, d * 1.05), stripMat);
    roof.position.set(0, h + 0.2, 0);
    g.add(roof);

    const glow = new THREE.PointLight(c.color, 2.6, 35);
    glow.position.set(0, h * 0.7, 0);
    g.add(glow);

    const sign = createNeonTextSprite(c.label, c.color);
    sign.position.set(0, h + 2.0, 0);
    sign.scale.set(26, 6.0, 1);
    sign.renderOrder = 999;
    g.add(sign);

    g.position.set(c.x, 0, c.z);
    g.rotation.y = c.rotY;

    g.userData.animate = (time) => {
      const p = 0.65 + 0.35 * Math.sin(time * 2.2 + i * 0.9);
      glow.intensity = 2.1 + p * 1.3;
      roof.material.opacity = 0.75 + p * 0.2;
      g.position.y = 0.15 * Math.sin(time + i * 0.8);
    };

    scene.add(g);
  });
}

function createNeonTextSprite(text, color) {
  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const hex = `#${Number(color).toString(16).padStart(6, "0")}`;

  let fontSize = 140;
  ctx.font = `900 ${fontSize}px Orbitron, Arial`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const maxWidth = canvas.width * 0.9;
  while (fontSize > 64 && ctx.measureText(text).width > maxWidth) {
    fontSize -= 6;
    ctx.font = `900 ${fontSize}px Orbitron, Arial`;
  }

  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const measured = ctx.measureText(text);
  const textWidth = measured.width;
  const padX = 110;
  const padY = 70;
  const boxW = Math.min(canvas.width * 0.96, textWidth + padX * 2);
  const boxH = fontSize + padY * 2;
  const boxX = cx - boxW / 2;
  const boxY = cy - boxH / 2;
  const r = 60;

  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(boxX, boxY, boxW, boxH, r);
  } else {
    ctx.moveTo(boxX + r, boxY);
    ctx.arcTo(boxX + boxW, boxY, boxX + boxW, boxY + boxH, r);
    ctx.arcTo(boxX + boxW, boxY + boxH, boxX, boxY + boxH, r);
    ctx.arcTo(boxX, boxY + boxH, boxX, boxY, r);
    ctx.arcTo(boxX, boxY, boxX + boxW, boxY, r);
  }
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = hex;
  ctx.lineWidth = 10;
  ctx.globalAlpha = 0.55;
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.shadowColor = hex;
  ctx.shadowBlur = 34;
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.fillText(text, cx, cy);

  ctx.shadowBlur = 0;
  ctx.lineWidth = 12;
  ctx.strokeStyle = hex;
  ctx.globalAlpha = 0.8;
  ctx.strokeText(text, cx, cy);
  ctx.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, fog: false });
  const sprite = new THREE.Sprite(material);
  return sprite;
}

function createParticles() {
  const particlesGeo = new THREE.BufferGeometry();
  const count = 1000;
  const posArray = new Float32Array(count * 3);

  for(let i = 0; i < count * 3; i++) {
    posArray[i] = (Math.random() - 0.5) * 100; // Spread 100 units
  }

  particlesGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
  const material = new THREE.PointsMaterial({
    size: 0.2,
    color: 0xffffff,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending
  });

  const particles = new THREE.Points(particlesGeo, material);
  scene.add(particles);
}

function animate() {
  requestAnimationFrame(animate);

  const time = performance.now() * 0.001;
  const delta = 0.016; // Approx 60fps

  // Update Avatar Animation (Local)
  if (mixer) mixer.update(delta);

  // Update Other Players Animations
  Object.values(otherPlayers).forEach(p => {
      if (p.mixer) p.mixer.update(delta);
  });

  // Animate Portals
  scene.traverse(obj => {
    if (obj.userData && obj.userData.animate) {
      obj.userData.animate(time);
    }
  });

  controls.update();
  composer.render();
}

function removePlayer(sessionId) {
    if (otherPlayers[sessionId]) {
        const p = otherPlayers[sessionId];
        if (p.mesh) scene.remove(p.mesh);
        if (p.lightGroup) scene.remove(p.lightGroup);
        delete otherPlayers[sessionId];
    }
}

// Unread badge 2D canvas sprite on top of avatar
function updateAvatarUnreadBadge(avatarRoot) {
  if (!avatarRoot) return;
  const count = Math.max(0, avatarRoot.userData.ownerUnread | 0);
  // Find existing badge
  let badge = avatarRoot.getObjectByName('unread_badge');
  if (count <= 0) {
    if (badge) avatarRoot.remove(badge);
    return;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,256,256);
  // Circle
  ctx.fillStyle = '#ec4899';
  ctx.beginPath();
  ctx.arc(128,128,100,0,Math.PI*2);
  ctx.fill();
  ctx.strokeStyle = '#0f0f1e';
  ctx.lineWidth = 16;
  ctx.stroke();
  // Text
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
    badge.scale.set(0.55, 0.55, 1);
    badge.position.set(0.7, 3.6, 0.4);
    avatarRoot.add(badge);
  } else {
    badge.material.map && badge.material.map.dispose && badge.material.map.dispose();
    badge.material = mat;
  }
}

window.hallIncrementAvatarUnread = function hallIncrementAvatarUnread(userId, amount = 1) {
  if (!userId) return;
  Object.values(otherPlayers).forEach(p => {
    if (p.mesh && p.mesh.userData.ownerUserId && String(p.mesh.userData.ownerUserId) === String(userId)) {
      p.mesh.userData.ownerUnread = (p.mesh.userData.ownerUnread | 0) + amount;
      updateAvatarUnreadBadge(p.mesh);
    }
  });
};
window.hallClearAvatarUnread = function hallClearAvatarUnread(userId) {
  if (!userId) return;
  Object.values(otherPlayers).forEach(p => {
    if (p.mesh && p.mesh.userData.ownerUserId && String(p.mesh.userData.ownerUserId) === String(userId)) {
      p.mesh.userData.ownerUnread = 0;
      updateAvatarUnreadBadge(p.mesh);
    }
  });
};

// Helper: Create Emoji Texture (Flat, non-neon)
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
    if (sessionId === socket.id) {
        if (!localAvatarMesh) return; // Not loaded yet
        playerObj = { mesh: localAvatarMesh };
    } else {
        playerObj = otherPlayers[sessionId];
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
        items = emojiData.map(e => (typeof e === 'object' ? e : { emoji: e, remarks: "" }));
    } else if (typeof emojiData === 'string') {
        items = [{ emoji: emojiData, remarks: "" }];
    }
    
    // Filter empty
    items = items.filter(e => e.emoji && e.emoji.trim() !== "");

    if (items.length === 0) return;

    // Calculate positions
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
        
        // Scale to match square aspect ratio (smaller for less “in your face”)
        sprite.scale.set(0.55, 0.55, 1.0); 
        
        const xPos = startX + (index * spacing);
        sprite.position.set(xPos, 2.4, 0); 
        
        playerObj.mesh.add(sprite);
    });
}

function forceNeutralPoseOnAvatar(avatar) {
  try {
    if (!avatar) return;
    const nameLower = (s) => String(s || "").toLowerCase();

    // 🔥 RÈGLES SÉCURITÉ ABSOLUES (plus de catastrophe!) :
    //   1) ON NE TOUCHE JAMAIS bone.position / bone.scale (uniquement rotation + quaternion)
    //   2) ON NE TOUCHE JAMAIS QUE LeftArm + RightArm (pas avant-bras / épaules / mains, trop risqué)
    //   3) ANGLE MINI : 0.14 rad (~8°, PAS 34° d'avant!)
    //   4) ON APPLIQUE UNIQUEMENT SI ÇA BAISSE RÉELLEMENT LA MAIN (gainDesc > 0.01 = 1%), sinon on GARDE ORIGINAL
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
    if (bones.length < 10) { console.log("[Hall Pose] Squelette incomplet → posture ORIGINALE préservée."); return; }

    // Récupère EXACTEMENT les 2 os qu'on veut toucher (et leurs mains/enfants pour mesurer)
    const LeftArm = bones.find(b => nameLower(b.name) === "leftarm");
    const RightArm = bones.find(b => nameLower(b.name) === "rightarm");
    const LeftHand = bones.find(b => nameLower(b.name) === "lefthand");
    const RightHand = bones.find(b => nameLower(b.name) === "righthand");

    if (!LeftArm || !RightArm) {
      console.log("[Hall Pose] Os LeftArm/RightArm non trouvés → posture ORIGINALE préservée.");
      return;
    }

    console.log("[Hall Pose] Mini ajustement UNIQUEMENT LeftArm/RightArm (~8° si ça baisse la main, sinon inchangé).");

    // 🔬 FONCTION SÉCURISÉE : teste 8 sens, applique SEULEMENT si gainDesc > 1% (sinon ON NE TOUCHE PAS)
    const tryLowerArmSafely = (armBone, handBone, armLabel) => {
      // Sauvegarde de L'ÉTAT ORIGINAL COMPLET de l'os (si aucun bon résultat → RESTAURATION EXACTE)
      const origRot = armBone.rotation.clone();
      const origQuat = armBone.quaternion.clone();

      const markers = handBone ? [handBone] : [];
      const baselineY = markers.reduce((acc, b) => { const p=getW(b); return acc + (p ? handWorldY(p) : 0); }, 0) / Math.max(1, markers.length);
      const baselineArmY = (() => { const p = getW(armBone); return p ? handWorldY(p) : 0; })();

      const SMALL_ANG = 0.14; // ~8°, TRÈS PETIT !
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
        if (y < best.y - 0.01) { best = { y, sign }; } // -1% MINIMUM pour valider
      });

      if (best.sign) {
        tryOnce(best.sign); // Applique LA MEILLEURE combinaison
        const gain = Math.round((baselineY-best.y)*100);
        console.log(`[Hall Pose] ${armLabel} baissé de ${gain} pts (${Math.round(baselineY*100)}% → ${Math.round(best.y*100)}%), angles sign=[${best.sign.join(",")}]`);
      } else {
        // AUCUNE combinaison ne baisse → RESTAURATION EXACTE ORIGINAL (pas de changement!)
        armBone.rotation.copy(origRot);
        armBone.quaternion.copy(origQuat);
        armBone.updateMatrixWorld(true);
        avatar.updateMatrixWorld(true);
        console.log(`[Hall Pose] ${armLabel} Aucun angle ne baisse la main → POSTURE ORIGINALE CONSERVÉE (${Math.round(baselineY*100)}%)`);
      }
    };

    tryLowerArmSafely(LeftArm, LeftHand, "LeftArm");
    tryLowerArmSafely(RightArm, RightHand, "RightArm");

    avatar.updateMatrixWorld(true);
    console.log("[Hall Pose] Mini ajustement terminé (aucun autre os touché!).");
  } catch (e) {
    console.warn("[Hall Pose] Echec (aucun changement appliqué → original) :", e);
  }
}

async function captureAvatarThumbnail(avatarGroup, size = 128) {
  try {
    // ─── STRATÉGIE FIX ULTIME POSTURE :
    //     Au lieu de .clone(true) (qui casse le lien SkinnedMesh ↔ Skeleton → T-pose figée),
    //     on snapshot L'AVATAR DIRECTEMENT DANS LA SCÈNE PRINCIPALE avec sa posture RÉELLE/ANIMÉE.
    //     On sauvegarde l'état (position/rotation), on le déplace PROVISOIREMENT devant
    //     une mini caméra orthographique dédiée, puis on le remet à sa place. 0 clone = 0 problème skin!
    const snapRenderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance"
    });
    snapRenderer.setPixelRatio(1);
    snapRenderer.setSize(size, size, false);
    snapRenderer.outputColorSpace = THREE.SRGBColorSpace;
    snapRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    snapRenderer.toneMappingExposure = 1.25;

    const snapScene = new THREE.Scene();
    snapScene.background = new THREE.Color(0xf8fafc);

    // Éclairage (ajouté dans la scène snapshot, AVANT le transfert de l'avatar)
    const amb = new THREE.AmbientLight(0xffffff, 0.92); snapScene.add(amb);
    const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(2, 3, 4); snapScene.add(key);
    const fill = new THREE.DirectionalLight(0xddeeff, 0.8); fill.position.set(-2, 1.2, 3); snapScene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 0.9); rim.position.set(0, 2.2, -3); snapScene.add(rim);

    // Sauvegarde de l'état actuel de l'avatar dans la scène principale
    const prevParent = avatarGroup.parent;
    const prevPos = avatarGroup.position.clone();
    const prevQuat = avatarGroup.quaternion.clone();
    const prevScale = avatarGroup.scale.clone();
    const prevVisible = avatarGroup.visible;
    const backupChildrenCount = avatarGroup.children ? avatarGroup.children.length : 0;
    const backupUuid = avatarGroup.uuid || "";
    console.log("[Hall Snap] Backup pré-snapshot : uuid=" + backupUuid.slice(0,8) + "…, children=" + backupChildrenCount);

    try {
      // 0) RETIRE PUIS RESET SCALE=1, QUATERNION, POSITION (SANS Box3 !)
      if (prevParent) prevParent.remove(avatarGroup);
      avatarGroup.visible = true;
      avatarGroup.quaternion.identity();
      avatarGroup.scale.set(1, 1, 1);
      avatarGroup.position.set(0, 0, 0);
      avatarGroup.updateMatrixWorld(true);

      // 1) MAINTENANT Box3 : avatar est en (0,0,0), scale=1, rot=identity → BB CORRECTE !
      const origBox = new THREE.Box3().setFromObject(avatarGroup);
      const sizeV = new THREE.Vector3();
      origBox.getSize(sizeV);
      const maxDim = Math.max(sizeV.x, sizeV.y, sizeV.z) || 1;
      console.log("[Hall Snap] BB reset scale=1 : H=", sizeV.y.toFixed(2), "m, W=", sizeV.x.toFixed(2), "m, D=", sizeV.z.toFixed(2), "m, minY=", origBox.min.y.toFixed(2));

      // 2) Centre XZ, bas Y = 0 (via origBox.min.y obtenu SUR scale=1)
      avatarGroup.position.sub(new THREE.Vector3(
        origBox.min.x + sizeV.x / 2,
        origBox.min.y,
        origBox.min.z + sizeV.z / 2
      ));
      avatarGroup.updateMatrixWorld(true);

      snapScene.add(avatarGroup);

      // 3) CADRAGE ULTRA SERRÉ SUR LA TETE
      const headTargetY = sizeV.y * 0.80;
      const headWorldHeight = sizeV.y * 0.29;
      const fovRad = Math.PI / 6.8;
      const distRaw = (headWorldHeight / 2) / Math.tan(fovRad / 2);
      const dist = Math.max(distRaw, maxDim * 0.42);

      console.log("[Hall Snap] headTargetY=", headTargetY.toFixed(2), "m, camDist=", dist.toFixed(2), "m, FOV=", Math.round(fovRad*180/Math.PI), "°");

      const snapCam = new THREE.PerspectiveCamera((fovRad * 180) / Math.PI, 1, 0.01, 1000);
      snapCam.position.set(0, headTargetY, dist);
      snapCam.lookAt(0, headTargetY, 0);
      snapCam.updateMatrixWorld(true);
      snapCam.updateProjectionMatrix();

      // Render (2x pour WebGL initialisation sometimes skip frame)
      snapRenderer.clear();
      snapRenderer.render(snapScene, snapCam);
      snapRenderer.render(snapScene, snapCam);
      console.log("[Hall Snap] Render effectué — calls renderer.info.render=", snapRenderer.info.render ? snapRenderer.info.render.calls : "n/a");
    } finally {
      // 4) RAPATRIEMENT DE L'AVATAR DANS LA SCÈNE PRINCIPALE (toujours exécuté même si throw!)
      // 🔥 JAMAIS appeler .clear() / .traverse() / parent=null SUR SNAPSCENE AVANT d'avoir sorti l'avatar!
      try {
        if (avatarGroup.parent && avatarGroup.parent === snapScene) {
          snapScene.remove(avatarGroup);
        }
      } catch (e) { console.warn("[Hall Snap] remove snapScene échoué:", e); }
      try {
        avatarGroup.position.copy(prevPos);
        avatarGroup.quaternion.copy(prevQuat);
        avatarGroup.scale.copy(prevScale);
        avatarGroup.visible = prevVisible;
        if (prevParent && avatarGroup.parent !== prevParent) {
          prevParent.add(avatarGroup);
        }
        avatarGroup.updateMatrixWorld(true);
        // VÉRIFICATION FATALE : nombre d'enfants identique avant/après!
        const afterChildrenCount = avatarGroup.children ? avatarGroup.children.length : 0;
        console.log("[Hall Snap] Avatar restauré — uuid=" + (avatarGroup.uuid||"").slice(0,8) + "…, parent OK=" + (avatarGroup.parent===prevParent) + ", children avant=" + backupChildrenCount + " / après=" + afterChildrenCount);
        if (afterChildrenCount !== backupChildrenCount) {
          console.error("[Hall Snap] 🔥 ERREUR FATALE : ENFANTS DISPARUS. Attendu:", backupChildrenCount, "obtenu:", afterChildrenCount);
        }
      } catch (e) { console.error("[Hall Snap] Restauration avatar échouée:", e); }
    }

    const dataUrl = snapRenderer.domElement.toDataURL("image/png");

    snapRenderer.dispose();
    // 🔥 IMPORTANT : ON NE TOUCHE PAS avatarGroup.children (pas de clear, pas parent=null!).
    //    Nettoyer uniquement les lights ET LA SCENE SNAP (on a déjà .remove() avatarGroup AVANT!).
    try {
      while (snapScene.children.length > 0) {
        try { snapScene.remove(snapScene.children[0]); } catch {}
      }
    } catch {}
    snapScene.clear();

    return dataUrl;
  } catch (err) {
    console.warn("[Avatar Snapshot] Échec capture :", err);
    return null;
  }
}

function spawnAvatar(url, isLocal, sessionId, position, initialEmoji, label, userMeta) {
  const loader = new GLTFLoader();

  const finalizeAvatar = (avatar, localMixer = null) => {
    const pos = position || { x: 0, y: 0, z: 0 };
    avatar.position.set(pos.x || 0, pos.y || 0, pos.z || 0);
    avatar.rotation.y = 0;

    const scale = 4;
    avatar.scale.set(scale, scale, scale);

    avatar.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        child.frustumCulled = false;
        child.userData = { ...(child.userData || {}), ownerSessionId: sessionId };
      }
    });
    avatar.frustumCulled = false;
    avatar.userData = {
      ...(avatar.userData || {}),
      isPlayerAvatar: true,
      isLocal: !!isLocal,
      ownerSessionId: sessionId,
      ownerUserId: userMeta?.userId || null,
      ownerFullName: userMeta?.fullName || label || "",
      ownerEmail: userMeta?.email || null,
      ownerRole: userMeta?.role || null,
      ownerUnread: 0
    };

    if (label) {
      console.log("Adding name label in hall:", label);
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
      nameSprite.scale.set(2.0, 0.5, 1);
      nameSprite.position.set(0, 0.05, 0.5); // Position in front of avatar
      nameSprite.renderOrder = 999; // Render last, on top
      avatar.add(nameSprite);
      console.log("Name label added in hall successfully");
    }

    scene.add(avatar);

    const lightingGroup = new THREE.Group();
    lightingGroup.position.copy(avatar.position);
    scene.add(lightingGroup);

    const keyLight = new THREE.PointLight(0xffffff, isLocal ? 14 : 6, 15);
    keyLight.position.set(3, 4, 5);
    keyLight.castShadow = false;
    lightingGroup.add(keyLight);

    const fillLight = new THREE.PointLight(0xaaccff, isLocal ? 6 : 3, 15);
    fillLight.position.set(-3, 2, 5);
    lightingGroup.add(fillLight);

    const backLight = new THREE.PointLight(0xffaa00, isLocal ? 10 : 4, 15);
    backLight.position.set(0, 4, -4);
    lightingGroup.add(backLight);

    if (isLocal) {
      localLightingGroup = lightingGroup;
    }

    if (isLocal) {
      mixer = localMixer;
      localAvatarMesh = avatar;
    } else {
      otherPlayers[sessionId] = { mesh: avatar, mixer: localMixer, lightGroup: lightingGroup };
    }

    if (initialEmoji) {
      updatePlayerEmoji(sessionId, initialEmoji);
    }

    if (isLocal) {
      const targetUser = userMeta || currentUser || null;
      setTimeout(async () => {
        try {
          // ── PRIORITÉ MAX : STOPPER mixer (override toute rotation toutes les 16ms!)
          const hasMixer = typeof mixer !== "undefined" && mixer;
          let mixerActions = null, mixerTime = 0, mixerRunning = false;
          if (hasMixer) {
            try {
              mixerActions = mixer._actions || [];
              mixerTime = mixer.time || 0;
              mixerRunning = mixerActions.length > 0 && mixerActions.some(a => a && a.isRunning && a.isRunning());
              mixer.stopAllAction ? mixer.stopAllAction() : null;
              mixer.update(0);
              console.log("[Hall Avatar] Mixer PAUSÉ (empêche override rotations bone pendant snapshot) — actions=", mixerActions.length, "running=", mixerRunning);
            } catch (me) { console.warn("[Hall Avatar] Stop mixer échec:", me); }
          }

          // Pose neutre SUR L'ORIGINAL (skeleton intact!) → maintenant mixer stoppé, CA RESTE!
          try { forceNeutralPoseOnAvatar(avatar); } catch {}

          // Attend 2 frames pour validation des bones avant rendu
          await new Promise(r => setTimeout(r, 60));

          console.log("[Hall Avatar] Début captureAvatarThumbnail sur avatar ORIGINAL...");
          const dataUrl = await captureAvatarThumbnail(avatar, 128);
          if (dataUrl) console.log("[Hall Avatar] captureAvatarThumbnail OK — taille dataUrl:", (dataUrl.length/1024).toFixed(1), "KB");
          if (dataUrl && typeof window.setLocalAvatarThumb === "function" && targetUser) {
            window.setLocalAvatarThumb(targetUser, dataUrl);
            console.log("[Hall Avatar] Vignette 3D locale générée et stockée ✅");
          }

          // ── RESTAURER mixer (reprend l'animation idle OU T-pose)
          if (hasMixer) {
            try {
              mixer.time = mixerTime;
              if (mixerActions && mixerActions.length > 0) {
                mixerActions.forEach(a => { try { a.reset(); a.play(); } catch {} });
              }
              mixer.update(0);
              console.log("[Hall Avatar] Mixer RESTAURÉ — animation idle/par défaut reprise");
            } catch (me) { console.warn("[Hall Avatar] Restore mixer échec:", me); }
          }
        } catch (e) {
          console.warn("[Hall Avatar] Échec snapshot 3D :", e);
        }
      }, 1600);
    }

    console.log("Avatar loaded successfully for:", sessionId);
  };

  const createAvatarBaseLocal = () => {
    const group = new THREE.Group();
    group.userData.isGLB = false;
    
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
    group.add(body);
    
    // Head (Sphere)
    const headGeom = new THREE.SphereGeometry(0.25, 16, 16);
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const head = new THREE.Mesh(headGeom, headMat);
    head.position.y = 1.7;
    group.add(head);

    return group;
  };

  const DEFAULT_AVATAR = "/assets/models/avatars/cyber_explorer.glb";
  let targetUrl = url || DEFAULT_AVATAR;

  // Utiliser le proxy pour les avatars externes
  const isExternal = targetUrl.startsWith("http") && !targetUrl.includes(window.location.host);
  if (isExternal) {
    targetUrl = `/api/avatar-proxy?url=${encodeURIComponent(targetUrl)}`;
  }

  loader.load(
    targetUrl,
    (gltf) => {
      const avatar = gltf.scene;
      avatar.userData.isGLB = true;
      let localMixer = null;

      if (gltf.animations && gltf.animations.length > 0) {
        localMixer = new THREE.AnimationMixer(avatar);
        let action = localMixer.clipAction(gltf.animations[0]);
        const idleAnim = gltf.animations.find((a) => a.name.toLowerCase().includes('idle'));
        if (idleAnim) {
          action = localMixer.clipAction(idleAnim);
        }
        action.play();
      }

      finalizeAvatar(avatar, localMixer);
    },
    undefined,
    (error) => {
      console.warn("Échec du chargement du modèle (distant ou local), activation du mode de secours.", error);
      const fallback = createAvatarBaseLocal();
      finalizeAvatar(fallback, null);
    }
  );
}
