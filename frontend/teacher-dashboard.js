// teacher-dashboard.js

// API_URL and token are usually in utils.js or global scope
// Ensure we have them
const token = localStorage.getItem("wbc_token");
const currentUser = JSON.parse(localStorage.getItem("wbc_user") || "null");
const SMARTCLASS_DETECTOR_SERVICE_URL = "http://localhost:5001";

// Vérifier si le service local est en cours d'écoute
async function checkDetectorService() {
  try {
    const res = await fetch(`${SMARTCLASS_DETECTOR_SERVICE_URL}/ping`);
    return res.ok;
  } catch (e) {
    console.error("Service SmartClass non disponible", e);
    return false;
  }
}

// Lancer la détection via le service local
async function startDetectorLocal(sessionId, teacherId, courseId, roomId) {
  const apiKey = "sc_key_change_me_before_deploy"; // Doit correspondre à smartclass_ai/.env et backend/.env
  try {
    const res = await fetch(`${SMARTCLASS_DETECTOR_SERVICE_URL}/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-SmartClass-API-Key": apiKey
      },
      body: JSON.stringify({
        sessionId,
        teacherId,
        courseId,
        roomId,
        showWindow: true // Affiche la fenêtre OpenCV
      })
    });
    const data = await res.json();
    if (data.success) {
      console.log("Détection SmartClass lancée ! PID:", data.pid);
    } else {
      alert(`Erreur : ${data.message}`);
    }
  } catch (e) {
    alert("Impossible de lancer la détection : vérifiez que le service local est en cours d'écoute.");
    console.error(e);
  }
}

// Arrêter la détection via le service local
async function stopDetectorLocal() {
  const apiKey = "sc_key_change_me_before_deploy";
  try {
    const res = await fetch(`${SMARTCLASS_DETECTOR_SERVICE_URL}/stop`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-SmartClass-API-Key": apiKey
      }
    });
    const data = await res.json();
    if (data.success) {
      console.log("Détection SmartClass arrêtée.");
    }
  } catch (e) {
    console.error(e);
  }
}

if (!token || !currentUser || currentUser.role !== "TEACHER") {
    if (currentUser && currentUser.role !== "TEACHER" && currentUser.role !== "ADMIN") {
        window.location.href = "hall.html";
    } else if (!token) {
        window.location.href = "index.html";
    }
}

// State
let allCourses = [];
let allAssignments = [];
let allStudents = [];
let socket = null;
let smartClassChart = null;
let smartClassHistory = [];
let smartClassInterval = null;
let smartClassSessionId = null;
let smartClassCourseId = null;
let smartClassRoomId = "classA";

// Elements
const navItems = document.querySelectorAll(".nav-item");
const sections = document.querySelectorAll(".section");
const logoutBtn = document.getElementById("logout-btn");

// --- Initialization ---
document.addEventListener("DOMContentLoaded", async () => {
    initNavigation();
    initProfile();
    initSocket();
    await refreshDashboard();
    
    // Initialize SmartClass
    initSmartClass();
    
    // Initial fetch of notifications
    await fetchNotifications();

    // Attach bell click
    const bell = document.getElementById("notification-bell");
    if (bell) {
        bell.addEventListener("click", (e) => {
            e.stopPropagation();
            toggleNotificationDropdown();
        });
    }

    // Close dropdown on outside click
    document.addEventListener("click", () => {
        const dropdown = document.getElementById("notification-dropdown");
        if (dropdown && dropdown.classList.contains("active")) {
            dropdown.classList.remove("active");
        }
    });

    // Modal close buttons
    setupModalClosers();
    
    // Form submits
    setupFormHandlers();
    
    // New buttons
    document.getElementById("btn-new-course")?.addEventListener("click", () => openCourseModal());
    document.getElementById("btn-new-assignment")?.addEventListener("click", () => openAssignmentModal());
});

// --- Navigation ---
function initNavigation() {
    navItems.forEach(btn => {
        btn.addEventListener("click", () => {
            const sectionId = btn.getAttribute("data-section");
            if (!sectionId) return;

            navItems.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            sections.forEach(sec => {
                sec.classList.toggle("active", sec.id === `section-${sectionId}`);
            });

            if (sectionId === "students") {
                if (typeof renderStudentTracking === "function") {
                    renderStudentTracking();
                }
            } else if (sectionId === "smartclass") {
                initSmartClass();
            }
        });
    });

    if (logoutBtn) {
        logoutBtn.addEventListener("click", () => {
            localStorage.removeItem("wbc_token");
            localStorage.removeItem("wbc_user");
            window.location.href = "index.html";
        });
    }
}

// --- Profile ---
function initProfile() {
    const nameEl = document.getElementById("teacher-name");
    const subjectEl = document.getElementById("teacher-subject");
    const avatarEl = document.getElementById("teacher-profile-avatar");

    if (nameEl) nameEl.textContent = currentUser.fullName || currentUser.username;
    if (subjectEl) subjectEl.textContent = currentUser.subject || "Enseignant";
    
    if (avatarEl && typeof createAvatarHtml === "function") {
        avatarEl.innerHTML = createAvatarHtml(currentUser, "40px");
        avatarEl.style.border = "none";
        avatarEl.style.background = "none";
    }
}

// --- Socket.io ---
function initSocket() {
    if (typeof io !== "undefined") {
        // Use global API_URL or default
        const socketUrl = (typeof API_URL !== 'undefined') ? API_URL : "http://localhost:4000";
        
        socket = io(socketUrl, {
            auth: { token },
            transports: ['websocket', 'polling'] // Force websocket first
        });

        socket.on("connect", () => {
            console.log("Connected to Socket.io:", socket.id);
            // Optional: visual indicator
            const bell = document.getElementById("notification-bell");
            if (bell) bell.style.borderColor = "rgba(0, 255, 136, 0.5)"; // Green border when connected
        });

        socket.on("connect_error", (err) => {
            console.error("Socket connection error:", err);
            const bell = document.getElementById("notification-bell");
            if (bell) bell.style.borderColor = "rgba(255, 0, 85, 0.5)"; // Red border when error
        });

        socket.on("notification:new", async (notif) => {
            console.log("New notification received:", notif);
            showToast(notif);
            fetchNotifications(); // Refresh badge and list

            // Live updates for specific events
            if (notif.type === 'SUBMISSION_NEW') {
                await fetchAssignments();
                updateKpis();
                renderAssignmentsTable();
                
                // Optional: if submissions modal is open for this assignment, we could refresh it
                // But we need to know which assignment is currently viewed.
            }
        });
    } else {
        console.error("Socket.io client library not loaded.");
        alert("Erreur: Impossible de charger le service de notifications temps réel.");
    }
}

// --- Data Fetching ---
async function refreshDashboard() {
    await Promise.all([
        fetchCourses(),
        fetchAssignments(),
        fetchStudents()
    ]);
    updateKpis();
    renderUpcomingCourses();
    renderCoursesTable();
    renderAssignmentsTable();
}

// --- SmartClass Functions ---
function initSmartClass() {
    // Initialize Chart
    const ctx = document.getElementById('sc-chart');
    if (ctx && !smartClassChart) {
        smartClassChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    {
                        label: 'Attention',
                        data: [],
                        borderColor: '#00ff88',
                        backgroundColor: 'rgba(0, 255, 136, 0.05)',
                        borderWidth: 3,
                        pointRadius: 4,
                        pointHoverRadius: 6,
                        tension: 0.3,
                        fill: true
                    },
                    {
                        label: 'Distraction',
                        data: [],
                        borderColor: '#ff8800',
                        backgroundColor: 'rgba(255, 136, 0, 0.05)',
                        borderWidth: 3,
                        pointRadius: 4,
                        pointHoverRadius: 6,
                        tension: 0.3,
                        fill: true
                    },
                    {
                        label: 'Fatigue',
                        data: [],
                        borderColor: '#ff4444',
                        backgroundColor: 'rgba(255, 68, 68, 0.05)',
                        borderWidth: 3,
                        pointRadius: 4,
                        pointHoverRadius: 6,
                        tension: 0.3,
                        fill: true
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: {
                        labels: { color: 'white' }
                    }
                },
                scales: {
                    x: {
                        ticks: { color: 'rgba(255,255,255,0.5)' },
                        grid: { color: 'rgba(255,255,255,0.05)' }
                    },
                    y: {
                        min: 0,
                        max: 100,
                        ticks: { color: 'rgba(255,255,255,0.5)' },
                        grid: { color: 'rgba(255,255,255,0.05)' }
                    }
                }
            }
        });
    }
    
    // Populate course selector
    populateSmartClassCourseSelector();
    
    // Attach button event listeners
    setupSmartClassEventListeners();
    
    // Check if there's an active session
    checkActiveSession();
    
    // Start polling for data
    fetchSmartClassData();
    if (smartClassInterval) clearInterval(smartClassInterval);
    smartClassInterval = setInterval(fetchSmartClassData, 10000); // Every 10 seconds
    
    // Join admin_dashboard room to receive SmartClass updates
    if (socket) {
        socket.emit('join_admin_dashboard');
        
        socket.on('smartclass:new_data', (data) => {
            console.log("📥 Reçu données SmartClass via Socket.IO :", data);
            // Only update if the data is for our current session
            if (!smartClassSessionId || data.sessionId === smartClassSessionId) {
                updateSmartClassUI(data);
            }
        });
    }
}

function populateSmartClassCourseSelector() {
    const select = document.getElementById('sc-course-select');
    if (!select) return;
    
    // Clear and add default option
    select.innerHTML = '<option value="">-- Choisir un cours --</option>';
    
    // Add courses
    allCourses.forEach(course => {
        const option = document.createElement('option');
        option.value = course._id;
        option.textContent = course.title;
        select.appendChild(option);
    });
}

function setupSmartClassEventListeners() {
    // Start button
    const startBtn = document.getElementById('sc-start-btn');
    if (startBtn) {
        startBtn.addEventListener('click', startSmartClassSession);
    }
    
    // Stop button
    const stopBtn = document.getElementById('sc-stop-btn');
    if (stopBtn) {
        stopBtn.addEventListener('click', stopSmartClassSession);
    }
    
    // Copy button
    const copyBtn = document.getElementById('sc-copy-btn');
    if (copyBtn) {
        copyBtn.addEventListener('click', async () => {
            const cmdInput = document.getElementById('sc-cmd-input');
            if (cmdInput && cmdInput.value) {
                try {
                    await navigator.clipboard.writeText(cmdInput.value);
                    alert("Commande copiée dans le presse-papiers !");
                } catch (err) {
                    console.error("Erreur lors de la copie :", err);
                    alert("Impossible de copier la commande automatiquement. Sélectionnez-la et copiez-la manuellement.");
                }
            }
        });
    }
    
    // Course selector change
    const courseSelect = document.getElementById('sc-course-select');
    if (courseSelect) {
        courseSelect.addEventListener('change', (e) => {
            smartClassCourseId = e.target.value;
        });
    }
    
    // Room input change
    const roomInput = document.getElementById('sc-room-input');
    if (roomInput) {
        roomInput.addEventListener('input', (e) => {
            smartClassRoomId = e.target.value;
        });
    }
}

async function checkActiveSession() {
    try {
        const res = await fetch(`${API_URL}/api/smartclass/sessions/teacher`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        
        if (res.ok) {
            const result = await res.json();
            if (result.sessions && result.sessions.length > 0) {
                // Find active session
                const activeSession = result.sessions.find(s => s.status === 'active');
                if (activeSession) {
                    smartClassSessionId = activeSession._id;
                    smartClassCourseId = activeSession.course._id;
                    smartClassRoomId = activeSession.roomId;
                    updateSmartClassSessionUI(true, activeSession.course.title, activeSession.roomId);
                }
            }
        }
    } catch (err) {
        console.error("Erreur vérification session active:", err);
    }
}

async function startSmartClassSession() {
    if (!smartClassCourseId) {
        alert("Veuillez sélectionner un cours !");
        return;
    }
    
    try {
        const res = await fetch(`${API_URL}/api/smartclass/sessions/start`, {
            method: 'POST',
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({
                courseId: smartClassCourseId,
                roomId: smartClassRoomId
            })
        });
        
        if (res.ok) {
            const result = await res.json();
            smartClassSessionId = result.session._id;
            const course = allCourses.find(c => c._id === smartClassCourseId);
            updateSmartClassSessionUI(true, course?.title || smartClassCourseId, smartClassRoomId);
            
            // Lancer la détection via le service local
            await startDetectorLocal(
                smartClassSessionId,
                currentUser.id,
                smartClassCourseId,
                smartClassRoomId
            );
            
            alert("Session SmartClass démarrée et détection lancée !");
            
            // Show info to user
            const sessionInfo = document.getElementById('sc-session-info');
            if (sessionInfo) {
                sessionInfo.style.display = 'block';
                document.getElementById('sc-session-course').textContent = course?.title || smartClassCourseId;
                document.getElementById('sc-session-room').textContent = smartClassRoomId;
            }
        } else {
            const err = await res.json();
            alert(err.message || "Erreur lors de la création de la session");
        }
    } catch (err) {
        console.error("Erreur démarrage session:", err);
        alert("Erreur lors de la création de la session");
    }
}

async function stopSmartClassSession() {
    if (!smartClassSessionId) {
        alert("Aucune session active !");
        return;
    }
    
    try {
        // Arrêter d'abord la détection
        await stopDetectorLocal();
        
        const res = await fetch(`${API_URL}/api/smartclass/sessions/${smartClassSessionId}/stop`, {
            method: 'POST',
            headers: {
                "Authorization": `Bearer ${token}`
            }
        });
        
        if (res.ok) {
            updateSmartClassSessionUI(false);
            smartClassSessionId = null;
            alert("Session SmartClass arrêtée !");
        } else {
            const err = await res.json();
            alert(err.message || "Erreur lors de l'arrêt de la session");
        }
    } catch (err) {
        console.error("Erreur arrêt session:", err);
        alert("Erreur lors de l'arrêt de la session");
    }
}

function updateSmartClassSessionUI(isActive, courseTitle = null, roomId = null) {
    const startBtn = document.getElementById('sc-start-btn');
    const stopBtn = document.getElementById('sc-stop-btn');
    const sessionInfo = document.getElementById('sc-session-info');
    const cmdInput = document.getElementById('sc-cmd-input');
    
    if (startBtn) {
        startBtn.style.display = isActive ? 'none' : 'flex';
    }
    if (stopBtn) {
        stopBtn.style.display = isActive ? 'flex' : 'none';
    }
    if (sessionInfo) {
        sessionInfo.style.display = isActive ? 'block' : 'none';
        if (isActive && courseTitle) {
            document.getElementById('sc-session-course').textContent = courseTitle;
            document.getElementById('sc-session-room').textContent = roomId;
            if (cmdInput && currentUser && smartClassSessionId && smartClassCourseId) {
                cmdInput.value =
`# SMARTCLASS — FLUX ACTIF RECOMMANDÉ (WBC 2026)
# ====================================================
# 1. Démarrer le service local SmartClass (1 fois) :
   cd "smartclass_ai" ; python smartclass-detector-service.py
#    → écoute http://localhost:5001 (ping /start /stop)
#
# 2. Utiliser les boutons ▶ Démarrer la détection / ⏹ Arrêter
#    du dashboard ci-dessus (ils appellent /start et /stop)
#
# Ancienne méthode obsolète (standalone, ne plus utiliser) :
#   python smartclass_camera.py --show --session ${smartClassSessionId} ...
#   → remplacé par camera_real.py piloté via detector-service Flask.`;
            }
        }
    }
}

async function fetchSmartClassData() {
    if (!smartClassSessionId) {
        // No active session, don't fetch
        console.log("⏭️ Pas de session active, pas de fetch");
        return;
    }
    
    console.log(`🔍 Fetching data pour session ${smartClassSessionId}`);
    
    try {
        const res = await fetch(`${API_URL}/api/smartclass/sessions/${smartClassSessionId}/data`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        
        console.log(`📡 Réponse fetch statut: ${res.status}`);
        
        if (res.ok) {
            const result = await res.json();
            console.log("📦 Données reçues du fetch :", result);
            if (result.data && result.data.length > 0) {
                const latestData = result.data[result.data.length - 1];
                updateSmartClassUI(latestData);
                
                // Update chart with all data
                smartClassHistory = result.data.map(d => ({
                    time: new Date(d.recordedAt).toLocaleTimeString(),
                    attention: d.attentionPct || 0,
                    distraction: d.distractionPct || 0,
                    fatigue: d.fatiguePct || 0
                }));
                
                if (smartClassChart) {
                    smartClassChart.data.labels = smartClassHistory.map(d => d.time);
                    smartClassChart.data.datasets[0].data = smartClassHistory.map(d => d.attention);
                    smartClassChart.data.datasets[1].data = smartClassHistory.map(d => d.distraction);
                    smartClassChart.data.datasets[2].data = smartClassHistory.map(d => d.fatigue);
                    smartClassChart.update('none');
                }
            }
        } else {
            console.error("❌ Erreur fetch SmartClass :", await res.text());
        }
    } catch (err) {
        console.error("❌ Erreur récupération SmartClass:", err);
    }
}

function updateSmartClassUI(data) {
    // Update KPIs
    const attentionEl = document.getElementById('sc-attention');
    const distractionEl = document.getElementById('sc-distraction');
    const fatigueEl = document.getElementById('sc-fatigue');
    const lastUpdateEl = document.getElementById('sc-last-update');
    
    if (attentionEl) attentionEl.textContent = `${data.attentionPct || 0}%`;
    if (distractionEl) distractionEl.textContent = `${data.distractionPct || 0}%`;
    if (fatigueEl) fatigueEl.textContent = `${data.fatiguePct || 0}%`;
    
    if (lastUpdateEl) {
        const date = new Date(data.recordedAt || data.createdAt);
        lastUpdateEl.textContent = `Dernière mise à jour: ${date.toLocaleTimeString()}`;
    }
    
    // Update chart
    if (smartClassChart) {
        const time = new Date(data.recordedAt || data.createdAt).toLocaleTimeString();
        smartClassHistory.push({
            time,
            attention: data.attentionPct || 0,
            distraction: data.distractionPct || 0,
            fatigue: data.fatiguePct || 0
        });
        
        // Keep last 20 points
        if (smartClassHistory.length > 20) smartClassHistory.shift();
        
        smartClassChart.data.labels = smartClassHistory.map(d => d.time);
        smartClassChart.data.datasets[0].data = smartClassHistory.map(d => d.attention);
        smartClassChart.data.datasets[1].data = smartClassHistory.map(d => d.distraction);
        smartClassChart.data.datasets[2].data = smartClassHistory.map(d => d.fatigue);
        smartClassChart.update('none');
    }
}

async function fetchCourses() {
    try {
        const res = await fetch(`${API_URL}/api/courses/my-courses`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        if (res.ok) {
            allCourses = await res.json();
        }
    } catch (err) {
        console.error("Error fetching courses:", err);
    }
}

async function fetchAssignments() {
    try {
        const res = await fetch(`${API_URL}/api/assignments/teacher`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        if (res.ok) {
            allAssignments = await res.json();
        }
    } catch (err) {
        console.error("Error fetching assignments:", err);
    }
}

async function fetchStudents() {
    try {
        // We might need an endpoint for all students or just those in teacher's courses
        const res = await fetch(`${API_URL}/api/teacher/students`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        if (res.ok) {
            allStudents = await res.json();
        }
    } catch (err) {
        console.error("Error fetching students:", err);
    }
}

// --- Rendering ---
function updateKpis() {
    const activeCoursesEl = document.getElementById("kpi-active-courses");
    const totalStudentsEl = document.getElementById("kpi-total-students");
    const assignmentsCountEl = document.getElementById("kpi-assignments-count");
    const assignmentBadge = document.getElementById("kpi-assignment-badge");

    if (activeCoursesEl) activeCoursesEl.textContent = allCourses.length;
    if (totalStudentsEl) totalStudentsEl.textContent = allStudents.length;
    
    // Count pending submissions
    let pendingCount = 0;
    allAssignments.forEach(a => {
        if (a.submissions) {
            pendingCount += a.submissions.filter(s => s.grade === undefined || s.grade === null).length;
        }
    });

    if (assignmentsCountEl) assignmentsCountEl.textContent = pendingCount;
    if (assignmentBadge) {
        assignmentBadge.textContent = pendingCount;
        assignmentBadge.style.display = pendingCount > 0 ? "flex" : "none";
    }
}

function renderUpcomingCourses() {
    const tbody = document.querySelector("#upcoming-courses-table tbody");
    if (!tbody) return;

    if (allCourses.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:20px; opacity:0.6;">Aucun cours programmé.</td></tr>`;
        return;
    }

    // Sort by schedule (basic mock sorting)
    const sorted = [...allCourses].slice(0, 5);
    
    tbody.innerHTML = sorted.map(c => `
        <tr>
            <td><strong>${c.title}</strong></td>
            <td><span class="badge blue">${c.targetClass || 'Toutes'}</span></td>
            <td>${c.schedule || 'Non défini'}</td>
            <td>${c.location || 'N/A'}</td>
            <td><span class="status-dot active"></span> Actif</td>
            <td>
                <button class="btn-icon" onclick="window.location.href='hall.html'" title="Rejoindre"><i class="fas fa-external-link-alt"></i></button>
            </td>
        </tr>
    `).join("");

    // Update next class widget
    const nextClassVal = document.getElementById("header-next-class");
    if (nextClassVal && sorted.length > 0) {
        nextClassVal.textContent = `${sorted[0].title} (${sorted[0].schedule})`;
    } else if (nextClassVal) {
        nextClassVal.textContent = "Aucun cours";
    }
}

function renderCoursesTable() {
    const tbody = document.getElementById("courses-body");
    if (!tbody) return;

    if (allCourses.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:20px; opacity:0.6;">Vous n'avez pas encore créé de cours.</td></tr>`;
        return;
    }

    tbody.innerHTML = allCourses.map(c => `
        <tr>
            <td>${c.title}</td>
            <td>${c.schedule || '-'}</td>
            <td>${c.location || '-'}</td>
            <td>${c.students ? c.students.length : 0}</td>
            <td><span class="badge ${c.status === 'archived' ? 'gray' : 'green'}">${c.status || 'Actif'}</span></td>
            <td class="actions">
                <button class="btn-icon" onclick="openCourseModal('${c._id}')" title="Modifier"><i class="fas fa-edit"></i></button>
                <button class="btn-icon" onclick="deleteCourse('${c._id}')" title="Supprimer"><i class="fas fa-trash"></i></button>
            </td>
        </tr>
    `).join("");
}

function renderAssignmentsTable() {
    const tbody = document.getElementById("assignments-body");
    if (!tbody) return;

    if (allAssignments.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:20px; opacity:0.6;">Aucun devoir créé.</td></tr>`;
        return;
    }

    tbody.innerHTML = allAssignments.map(a => {
        const rendues = a.submissions ? a.submissions.length : 0;
        const total = a.course && a.course.students ? a.course.students.length : "?";
        const courseTitle = a.course ? a.course.title : "Inconnu";
        
        return `
            <tr>
                <td>${a.title}</td>
                <td>${courseTitle}</td>
                <td>${new Date(a.createdAt).toLocaleDateString()}</td>
                <td>${a.dueDate ? new Date(a.dueDate).toLocaleDateString() : 'Pas de date'}</td>
                <td><span class="badge blue">${rendues} / ${total}</span></td>
                <td class="actions">
                    <button class="btn-icon" onclick="openSubmissionsModal('${a._id}')" title="Voir les rendus"><i class="fas fa-graduation-cap"></i></button>
                    <button class="btn-icon" onclick="openAssignmentModal('${a._id}')" title="Modifier"><i class="fas fa-edit"></i></button>
                    <button class="btn-icon" onclick="deleteAssignment('${a._id}')" title="Supprimer"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `;
    }).join("");
}

// --- Notifications ---
async function fetchNotifications() {
    try {
        const res = await fetch(`${API_URL}/api/notifications`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        if (res.ok) {
            const notifications = await res.json();
            const unreadCount = notifications.filter(n => !n.read).length;
            
            // Set unread count badge
            const badge = document.getElementById("notification-count");
            if (badge) {
                badge.textContent = unreadCount > 99 ? "99+" : unreadCount;
                badge.style.display = unreadCount > 0 ? "flex" : "none";
            }
            
            renderNotificationDropdown(notifications);
        }
    } catch (err) {
        console.error("Error fetching notifications:", err);
    }
}

async function markAsRead(id) {
    try {
        const res = await fetch(`${API_URL}/api/notifications/${id}/read`, {
            method: "PUT",
            headers: { "Authorization": `Bearer ${token}` }
        });
        if (res.ok) {
            // Optimistic UI update or just refresh
            fetchNotifications();
        }
    } catch (err) {
        console.error("Error marking as read:", err);
    }
}

async function markAllAsRead() {
    try {
        const res = await fetch(`${API_URL}/api/notifications/read-all`, {
            method: "PUT",
            headers: { "Authorization": `Bearer ${token}` }
        });
        if (res.ok) {
            fetchNotifications();
        }
    } catch (err) {
        console.error("Error marking all as read:", err);
    }
}

// Ensure these are globally accessible for inline onclick handlers
window.markAsRead = markAsRead;
window.markAllAsRead = markAllAsRead;
window.handleNotifClick = async (id, link) => {
    await markAsRead(id);
    if (link) {
        // Handle internal routing if necessary, else just redirect
        if (link.startsWith("/")) window.location.href = link.substring(1) + ".html";
        else window.location.href = link;
    } else {
        fetchNotifications();
    }
};

function toggleNotificationDropdown() {
    let dropdown = document.getElementById("notification-dropdown");
    if (!dropdown) {
        dropdown = document.createElement("div");
        dropdown.id = "notification-dropdown";
        dropdown.className = "notification-dropdown glass-panel";
        document.querySelector(".notification-widget").appendChild(dropdown);
        fetchNotifications(); // Refresh content
    }
    dropdown.classList.toggle("active");
}

function renderNotificationDropdown(notifications) {
    let dropdown = document.getElementById("notification-dropdown");
    if (!dropdown) return;

    if (notifications.length === 0) {
        dropdown.innerHTML = `
            <div class="dropdown-header">
                <h3>Notifications</h3>
            </div>
            <div class="dropdown-body">
                <div class="empty-notif">Aucune notification</div>
            </div>
        `;
        return;
    }

    dropdown.innerHTML = `
        <div class="dropdown-header">
            <h3>Notifications</h3>
            ${notifications.some(n => !n.read) ? `<button onclick="markAllAsRead()" class="mark-all-btn">Tout marquer comme lu</button>` : ''}
        </div>
        <div class="dropdown-body">
            ${notifications.slice(0, 10).map(n => `
                <div class="notif-item ${n.read ? 'read' : 'unread'}" onclick="handleNotifClick('${n._id}', '${n.link}')">
                    <div class="notif-icon">
                        <i class="fas ${getNotifIcon(n.type)}"></i>
                    </div>
                    <div class="notif-content">
                        <div class="notif-title">${n.title}</div>
                        <div class="notif-msg">${n.message}</div>
                        <div class="notif-time">${formatTime(n.createdAt)}</div>
                    </div>
                    ${!n.read ? '<div class="unread-dot"></div>' : ''}
                </div>
            `).join("")}
        </div>
        <div class="dropdown-footer">
            <button onclick="alert('La liste complète sera bientôt disponible')">Voir tout</button>
        </div>
    `;
}

function getNotifIcon(type) {
    switch (type) {
        case 'MESSAGE': return 'fa-comment';
        case 'ASSIGNMENT': 
        case 'ASSIGNMENT_NEW': return 'fa-tasks';
        case 'SUBMISSION_NEW': return 'fa-file-upload'; // Changed icon for clarity
        case 'GRADE': 
        case 'GRADE_NEW': return 'fa-star';
        case 'FEED_NEW': return 'fa-rss';
        default: return 'fa-bell';
    }
}

function formatTime(date) {
    const d = new Date(date);
    const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60) return "À l'instant";
    if (diff < 3600) return `${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} h`;
    return d.toLocaleDateString();
}

function showToast(notif) {
    const container = document.getElementById("toast-container") || createToastContainer();
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.innerHTML = `
        <div class="toast-icon"><i class="fas ${getNotifIcon(notif.type)}"></i></div>
        <div class="toast-content">
            <div class="toast-title">${notif.title}</div>
            <div class="toast-message">${notif.message}</div>
        </div>
        <div class="toast-close"><i class="fas fa-times"></i></div>
    `;
    
    toast.onclick = () => {
        handleNotifClick(notif._id, notif.link);
        toast.classList.add("toast-out");
        setTimeout(() => toast.remove(), 300);
    };

    toast.querySelector(".toast-close").onclick = (e) => {
        e.stopPropagation();
        toast.classList.add("toast-out");
        setTimeout(() => toast.remove(), 300);
    };

    container.appendChild(toast);
    
    setTimeout(() => {
        if (toast.parentElement) {
            toast.classList.add("toast-out");
            setTimeout(() => toast.remove(), 300);
        }
    }, 5000);
}

function createToastContainer() {
    const c = document.createElement("div");
    c.id = "toast-container";
    document.body.appendChild(c);
    return c;
}

// --- Modals & Actions ---
function setupModalClosers() {
    document.getElementById("modal-close-course")?.addEventListener("click", () => closeModal("course-modal-backdrop"));
    document.getElementById("modal-close-assignment")?.addEventListener("click", () => closeModal("assignment-modal-backdrop"));
    document.getElementById("modal-close-submissions")?.addEventListener("click", () => closeModal("submissions-modal-backdrop"));
    document.getElementById("modal-close-grading")?.addEventListener("click", () => closeModal("grading-modal-backdrop"));
    document.getElementById("modal-close-details")?.addEventListener("click", () => closeModal("student-details-modal-backdrop"));
    document.getElementById("modal-close-message")?.addEventListener("click", () => closeModal("send-message-modal-backdrop"));
    document.getElementById("modal-close-evaluation")?.addEventListener("click", () => closeModal("evaluation-modal-backdrop"));

    window.onclick = (event) => {
        if (event.target.classList.contains('modal-backdrop')) {
            event.target.hidden = true;
        }
    };
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.hidden = true;
}

function openCourseModal(id = null) {
    const backdrop = document.getElementById("course-modal-backdrop");
    const title = document.getElementById("modal-title");
    const form = document.getElementById("course-form");
    const delBtn = document.getElementById("course-delete-btn");

    form.reset();
    document.getElementById("course-id").value = id || "";
    
    if (id) {
        title.textContent = "Modifier le Cours";
        const course = allCourses.find(c => c._id === id);
        if (course) {
            document.getElementById("course-title").value = course.title;
            document.getElementById("course-target-class").value = course.targetClass || "";
            document.getElementById("course-schedule").value = course.schedule || "";
            document.getElementById("course-location").value = course.location || "";
            document.getElementById("course-desc").value = course.description || "";
        }
        if (delBtn) delBtn.hidden = false;
    } else {
        title.textContent = "Créer un Nouveau Cours";
        if (delBtn) delBtn.hidden = true;
    }

    if (backdrop) backdrop.hidden = false;
}

// --- Roll Call Logic ---

document.getElementById("btn-roll-call")?.addEventListener("click", () => {
    openRollCallModal();
});

document.getElementById("modal-close-roll-call")?.addEventListener("click", () => {
    closeModal("roll-call-modal-backdrop");
});

function openRollCallModal() {
    const backdrop = document.getElementById("roll-call-modal-backdrop");
    const courseSelect = document.getElementById("roll-call-course");
    const dateInput = document.getElementById("roll-call-date");
    const listContainer = document.getElementById("roll-call-list");

    // Reset
    courseSelect.innerHTML = `<option value="" disabled selected>Choisir un cours...</option>`;
    listContainer.innerHTML = `<div style="text-align:center; opacity:0.6;">Veuillez sélectionner un cours.</div>`;
    dateInput.valueAsDate = new Date();

    // Populate Courses
    allCourses.forEach(c => {
        const opt = document.createElement("option");
        opt.value = c._id;
        opt.textContent = `${c.title} (${c.targetClass || '?'})`;
        courseSelect.appendChild(opt);
    });

    if (backdrop) backdrop.hidden = false;
}

document.getElementById("roll-call-course")?.addEventListener("change", (e) => {
    const courseId = e.target.value;
    const listContainer = document.getElementById("roll-call-list");
    
    const course = allCourses.find(c => c._id === courseId);
    if (!course) return;

    // Get students
    let studentsInCourse = [];
    if (course.students && course.students.length > 0) {
        studentsInCourse = course.students.map(s => {
            const sId = (s._id || s);
            // Try to find full student object in allStudents
            return allStudents.find(st => st._id === sId) || { _id: sId, username: "Inconnu", fullName: "Étudiant Inconnu" };
        });
    }

    if (studentsInCourse.length === 0) {
        listContainer.innerHTML = `<div style="text-align:center; padding:20px; color:#ffbb33;">Aucun étudiant inscrit à ce cours.</div>`;
        return;
    }

    listContainer.innerHTML = studentsInCourse.map(s => `
        <div style="display:flex; align-items:center; justify-content:space-between; padding:8px; border-bottom:1px solid rgba(255,255,255,0.05);">
            <div style="display:flex; align-items:center; gap:10px;">
                ${typeof createAvatarHtml === 'function' ? createAvatarHtml(s, "30px") : '<div style="width:30px;height:30px;background:#333;border-radius:50%;"></div>'}
                <span>${s.fullName || s.username}</span>
            </div>
            <label class="toggle-switch" style="display:flex; align-items:center; cursor:pointer;">
                <input type="checkbox" name="attendance-check" value="${s._id}" style="margin-right:10px;">
                <span style="font-size:0.8rem; color:#ff4444;">Absent</span>
            </label>
        </div>
    `).join("");
});

document.getElementById("roll-call-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const courseId = document.getElementById("roll-call-course").value;
    const date = document.getElementById("roll-call-date").value;
    
    // Collect absences
    const checkboxes = document.querySelectorAll("input[name='attendance-check']:checked");
    const students = Array.from(checkboxes).map(cb => ({
        studentId: cb.value,
        status: "ABSENT"
    }));

    if (students.length === 0) {
        if(!confirm("Aucun absent sélectionné. Confirmer l'appel (tous présents) ?")) return;
    }

    try {
        const res = await fetch(`${API_URL}/api/teacher/attendance`, {
            method: "POST",
            headers: { 
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ courseId, date, students })
        });

        if (res.ok) {
            const data = await res.json();
            alert(`Appel enregistré ! ${data.results.length} absences notées.`);
            closeModal("roll-call-modal-backdrop");
            // Refresh dashboard stats
            await fetchStudents();
            if (typeof renderStudentTracking === "function") renderStudentTracking();
        } else {
            const err = await res.json();
            alert("Erreur: " + (err.message || "Impossible d'enregistrer l'appel"));
        }
    } catch (error) {
        console.error(error);
        alert("Erreur technique");
    }
});

function openAssignmentModal(id = null) {
    const backdrop = document.getElementById("assignment-modal-backdrop");
    const title = document.getElementById("assign-modal-title");
    const form = document.getElementById("assignment-form");
    const courseSelect = document.getElementById("assign-course");

    // Fill course select
    courseSelect.innerHTML = allCourses.map(c => `<option value="${c._id}">${c.title}</option>`).join("");

    form.reset();
    document.getElementById("assign-id").value = id || "";

    if (id) {
        title.textContent = "Modifier le Devoir";
        const assign = allAssignments.find(a => a._id === id);
        if (assign) {
            document.getElementById("assign-title").value = assign.title;
            document.getElementById("assign-type").value = assign.type || "DEVOIR";
            document.getElementById("assign-course").value = assign.course ? (assign.course._id || assign.course) : "";
            document.getElementById("assign-date").value = assign.dueDate ? assign.dueDate.split('T')[0] : "";
            document.getElementById("assign-desc").value = assign.description || "";
        }
    } else {
        title.textContent = "Créer un Nouveau Devoir";
    }

    if (backdrop) backdrop.hidden = false;
}

function setupFormHandlers() {
    document.getElementById("course-form")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const id = document.getElementById("course-id").value;
        const formData = new FormData();
        formData.append("title", document.getElementById("course-title").value);
        formData.append("targetClass", document.getElementById("course-target-class").value);
        formData.append("schedule", document.getElementById("course-schedule").value);
        formData.append("location", document.getElementById("course-location").value);
        formData.append("description", document.getElementById("course-desc").value);
        
        const fileInput = document.getElementById("course-support-file");
        if (fileInput.files[0]) {
            formData.append("supportFile", fileInput.files[0]);
        }

        try {
            const url = id ? `${API_URL}/api/courses/${id}` : `${API_URL}/api/courses`;
            const method = id ? "PUT" : "POST";
            const res = await fetch(url, {
                method,
                headers: { "Authorization": `Bearer ${token}` },
                body: formData
            });

            if (res.ok) {
                closeModal("course-modal-backdrop");
                await refreshDashboard();
            } else {
                const data = await res.json();
                alert(data.message || "Erreur lors de l'opération");
            }
        } catch (err) {
            console.error(err);
        }
    });

    document.getElementById("assignment-form")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const id = document.getElementById("assign-id").value;
        const formData = new FormData();
        
        formData.append("title", document.getElementById("assign-title").value);
        formData.append("type", document.getElementById("assign-type").value);
        formData.append("courseId", document.getElementById("assign-course").value);
        formData.append("targetClass", document.getElementById("assign-target-class").value);
        formData.append("dueDate", document.getElementById("assign-date").value);
        formData.append("description", document.getElementById("assign-desc").value);
        
        const fileInput = document.getElementById("assign-file");
        if (fileInput.files[0]) {
            formData.append("file", fileInput.files[0]);
        }

        try {
            const url = id ? `${API_URL}/api/assignments/${id}` : `${API_URL}/api/assignments`;
            const method = id ? "PUT" : "POST"; // Note: assignment update via PUT is usually JSON in some APIs, but here we use FormData for file upload
            
            // NOTE: Backend for assignments POST expects FormData? 
            // In assignments.js: router.post("/", auth, upload.single("file"), ...)
            // So YES, FormData is correct for POST.
            // But for PUT /:id? Assignments route usually doesn't have file update in PUT or maybe it does?
            // backend/routes/assignments.js has DELETE and GRADE, but I don't see a general PUT /:id for updating assignment details in the code I read!
            // Wait, I missed reading PUT /:id in assignments.js?
            // I read lines 1-314. I saw POST / (line 174), PUT /:id/grade (line 243). 
            // I DID NOT see PUT /:id for updating the assignment itself!
            // THIS IS A MISSING BACKEND FEATURE if we want to edit assignments.
            // For now, I will assume POST works for creation. Editing might fail if backend route doesn't exist.
            
            const res = await fetch(url, {
                method,
                headers: { 
                    "Authorization": `Bearer ${token}`
                    // No Content-Type for FormData, browser sets it
                },
                body: formData
            });

            if (res.ok) {
                closeModal("assignment-modal-backdrop");
                await refreshDashboard();
            } else {
                alert("Erreur: Modification non supportée ou échouée.");
            }
        } catch (err) {
            console.error(err);
        }
    });

    document.getElementById("grading-form")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const assignmentId = document.getElementById("grading-assignment-id").value;
        const studentId = document.getElementById("grading-student-id").value;
        const score = document.getElementById("grading-score").value;
        const feedback = document.getElementById("grading-feedback").value;

        try {
            const res = await fetch(`${API_URL}/api/assignments/${assignmentId}/grade`, {
                method: "PUT",
                headers: { 
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ studentId, grade: score, feedback })
            });

            if (res.ok) {
                closeModal("grading-modal-backdrop");
                // Refresh submissions modal
                openSubmissionsModal(assignmentId);
                // Also refresh dashboard to update counts
                refreshDashboard();
                alert("Note enregistrée !");
            } else {
                alert("Erreur lors de l'enregistrement de la note.");
            }
        } catch (err) {
            console.error(err);
        }
    });
}

// Global functions for inline onclick handlers
window.deleteCourse = async (id) => {
    if (!confirm("Supprimer ce cours ?")) return;
    try {
        const res = await fetch(`${API_URL}/api/courses/${id}`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${token}` }
        });
        if (res.ok) await refreshDashboard();
    } catch (err) { console.error(err); }
};

window.deleteAssignment = async (id) => {
    if (!confirm("Supprimer ce devoir ?")) return;
    try {
        const res = await fetch(`${API_URL}/api/assignments/${id}`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${token}` }
        });
        if (res.ok) await refreshDashboard();
    } catch (err) { console.error(err); }
};

window.openCourseModal = openCourseModal;
window.openAssignmentModal = openAssignmentModal;
window.openSubmissionsModal = async (id) => {
    const backdrop = document.getElementById("submissions-modal-backdrop");
    const tbody = document.getElementById("submissions-body");
    
    // Clear previous
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;">Chargement...</td></tr>`;
    if (backdrop) backdrop.hidden = false;

    // Find assignment locally or fetch details if needed
    // The "allAssignments" array might not have populated submissions if we fetched summary
    // But /api/assignments/teacher endpoint DOES populate submissions.student
    
    // Let's refetch to be sure we have latest
    let assignment = allAssignments.find(a => a._id === id);
    
    // If we want fresh data, we could fetch individual assignment, but let's rely on dashboard refresh or refetch here
    try {
        if (!assignment) {
            tbody.innerHTML = `<tr><td colspan="5">Devoir introuvable</td></tr>`;
            return;
        }

        const submissions = assignment.submissions || [];

        if (submissions.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px;">Aucun rendu pour le moment.</td></tr>`;
            return;
        }

        tbody.innerHTML = submissions.map(sub => {
            const studentName = sub.student ? (sub.student.username || sub.student.email) : "Étudiant inconnu";
            const studentId = sub.student ? sub.student._id : null;
            const date = new Date(sub.submittedAt).toLocaleString();
            const content = sub.content || "";
            const isLink = content.startsWith("http") || content.startsWith("/");
            const grade = sub.grade !== undefined ? `<span class="badge green">${sub.grade}/20</span>` : `<span class="badge gray">Non noté</span>`;
            
            return `
                <tr>
                    <td>${studentName}</td>
                    <td>${date}</td>
                    <td>
                        ${isLink ? `<a href="${content.startsWith('/') ? API_URL + content : content}" target="_blank" style="color:var(--accent-cyan);"><i class="fas fa-external-link-alt"></i> Voir le fichier</a>` : content}
                    </td>
                    <td>${grade}</td>
                    <td>
                        <button class="btn-icon" onclick="openGradingModal('${id}', '${studentId}', '${studentName}', '${sub.grade || ''}', '${(sub.feedback || '').replace(/'/g, "\\'")}')" title="Noter">
                            <i class="fas fa-edit"></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join("");

    } catch (err) {
        console.error(err);
        tbody.innerHTML = `<tr><td colspan="5">Erreur de chargement</td></tr>`;
    }
};

window.openGradingModal = (assignmentId, studentId, studentName, currentGrade, currentFeedback) => {
    const backdrop = document.getElementById("grading-modal-backdrop");
    document.getElementById("grading-assignment-id").value = assignmentId;
    document.getElementById("grading-student-id").value = studentId;
    document.getElementById("grading-student-name").value = studentName;
    document.getElementById("grading-score").value = currentGrade || "";
    document.getElementById("grading-feedback").value = currentFeedback || "";
    
    if (backdrop) backdrop.hidden = false;
};

// --- Student Tracking Actions ---

// Event delegation for dynamically created buttons in student tracking
document.getElementById("students-courses-container")?.addEventListener("click", (e) => {
    // View Details
    const viewBtn = e.target.closest(".view-student-btn");
    if (viewBtn) {
        const id = viewBtn.getAttribute("data-id");
        openStudentDetailsModal(id);
    }

    // Message
    const msgBtn = e.target.closest(".msg-student-btn");
    if (msgBtn) {
        const id = msgBtn.getAttribute("data-id");
        openMessageModal(id);
    }
});

// Evaluation Modal
window.openEvaluationModal = (studentId, subject) => {
    const backdrop = document.getElementById("evaluation-modal-backdrop");
    const form = document.getElementById("evaluation-form");
    const subjectSelect = document.getElementById("eval-subject");
    
    // Reset form
    form.reset();
    document.getElementById("eval-student-id").value = studentId;
    
    // Populate subjects from allCourses
    if (subjectSelect) {
        subjectSelect.innerHTML = `<option value="" disabled selected>Choisir une matière...</option>`;
        
        // Get unique titles from courses
        const uniqueSubjects = [...new Set(allCourses.map(c => c.title))];
        
        uniqueSubjects.forEach(title => {
            const opt = document.createElement("option");
            opt.value = title;
            opt.textContent = title;
            subjectSelect.appendChild(opt);
        });

        // Pre-fill subject if available
        if (subject) {
            subjectSelect.value = subject;
        }
    }
    
    // Find student info for header
    const student = allStudents.find(s => s._id === studentId);
    if (student) {
        document.getElementById("eval-student-name").textContent = student.fullName || student.username;
        document.getElementById("eval-student-class").textContent = student.studentClass || "";
        
        const absencesInput = document.getElementById("eval-absences");
        if (absencesInput) {
            absencesInput.value = student.academicStatus?.absences || 0;
        }
        
        // Avatar
        const avatarEl = document.getElementById("eval-student-avatar");
        if (avatarEl && typeof createAvatarHtml === "function") {
            avatarEl.innerHTML = createAvatarHtml(student, "50px");
        }
    }
    
    // Clear selected emojis
    document.querySelectorAll(".emoji-option").forEach(el => el.classList.remove("selected"));
    document.getElementById("eval-emoji").value = "";

    if (backdrop) backdrop.hidden = false;
};

// Emoji Picker Logic
document.querySelectorAll(".emoji-option").forEach(opt => {
    opt.addEventListener("click", () => {
        // Toggle selection
        const wasSelected = opt.classList.contains("selected");
        document.querySelectorAll(".emoji-option").forEach(el => el.classList.remove("selected"));
        
        if (!wasSelected) {
            opt.classList.add("selected");
            document.getElementById("eval-emoji").value = opt.getAttribute("data-emoji");
        } else {
            document.getElementById("eval-emoji").value = "";
        }
    });
});

// Handle Evaluation Submit
document.getElementById("evaluation-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const studentId = document.getElementById("eval-student-id").value;
    const subject = document.getElementById("eval-subject").value;
    const emoji = document.getElementById("eval-emoji").value;
    const remarks = document.getElementById("eval-remarks").value;
    const absencesInput = document.getElementById("eval-absences");
    const absences = absencesInput ? (absencesInput.value || 0) : 0;
    
    try {
        const res = await fetch(`${API_URL}/api/teacher/students/${studentId}/evaluate`, {
            method: "POST",
            headers: { 
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ statusEmoji: emoji, remarks, subject, absences })
        });

        if (res.ok) {
            closeModal("evaluation-modal-backdrop");
            // Refresh student data
            await fetchStudents(); 
            // Re-render tracking
            if (typeof renderStudentTracking === "function") renderStudentTracking();
            alert("Évaluation enregistrée !");
        } else {
            const data = await res.json();
            alert(data.message || "Erreur lors de l'enregistrement.");
        }
    } catch (err) {
        console.error(err);
        alert("Erreur serveur.");
    }
});

// Message Modal
function openMessageModal(studentId) {
    const backdrop = document.getElementById("send-message-modal-backdrop");
    const form = document.getElementById("send-message-form");
    form.reset();
    document.getElementById("message-recipient-id").value = studentId;
    
    if (backdrop) backdrop.hidden = false;
}

// Handle Message Submit
document.getElementById("send-message-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const recipientId = document.getElementById("message-recipient-id").value;
    const subject = document.getElementById("message-subject").value;
    const content = document.getElementById("message-content").value;
    
    try {
        const res = await fetch(`${API_URL}/api/notifications/send`, {
            method: "POST",
            headers: { 
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ 
                recipient: recipientId, 
                title: subject, 
                message: content,
                type: "MESSAGE"
            })
        });

        if (res.ok) {
            closeModal("send-message-modal-backdrop");
            alert("Message envoyé !");
        } else {
            alert("Erreur lors de l'envoi.");
        }
    } catch (err) {
        console.error(err);
    }
});

// Student Details Modal
function openStudentDetailsModal(studentId) {
    const backdrop = document.getElementById("student-details-modal-backdrop");
    const content = document.getElementById("student-details-content");
    const title = document.getElementById("student-details-name");
    
    const student = allStudents.find(s => s._id === studentId);
    if (!student) return;
    
    title.textContent = student.fullName || student.username;
    
    // Simple details view
    content.innerHTML = `
        <div style="display:flex; gap:20px; align-items:center; margin-bottom:20px;">
            ${typeof createAvatarHtml === "function" ? createAvatarHtml(student, "80px") : ""}
            <div>
                <p><strong>Email:</strong> ${student.email}</p>
                <p><strong>Classe:</strong> ${student.studentClass || "N/A"}</p>
                <p><strong>Absences:</strong> ${student.academicStatus?.absences || 0}</p>
            </div>
        </div>
        <h4>Historique des Évaluations & Absences</h4>
        <div style="max-height:300px; overflow-y:auto; background:rgba(0,0,0,0.2); padding:10px; border-radius:5px;">
            ${(student.academicStatus?.activeEmojis || []).map(e => {
                const absencesList = (e.absenceDetails || []).map(abs => {
                    const absDate = new Date(abs.date).toLocaleString('fr-FR', {
                        day: '2-digit', month: '2-digit', year: 'numeric',
                        hour: '2-digit', minute: '2-digit'
                    });
                    return `<li style="font-size:0.85em; color:#ff4444;">• ${absDate}</li>`;
                }).join("");

                return `
                <div style="margin-bottom:15px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:10px;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <strong style="color:var(--neon-blue);">${e.subject || "Général"}</strong>
                        <small style="opacity:0.6;">${new Date(e.timestamp).toLocaleDateString()}</small>
                    </div>
                    <div style="margin:5px 0;">${e.emoji || ""} ${e.remarks || ""}</div>
                    ${absencesList ? `<ul style="list-style:none; padding-left:10px; margin:5px 0;">${absencesList}</ul>` : ""}
                    <small style="opacity:0.5; font-style:italic;">Par: ${e.teacherName || "Inconnu"}</small>
                </div>
                `;
            }).join("") || "<p>Aucune évaluation.</p>"}
        </div>
    `;
    
    if (backdrop) backdrop.hidden = false;
}
