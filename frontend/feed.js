const API_URL = window.API_URL || "http://localhost:4000";
const token = localStorage.getItem("wbc_token");
let currentUser = JSON.parse(localStorage.getItem("wbc_user") || "null");

if (!token || !currentUser) {
    console.error("Auth token missing or invalid.");
    // Only redirect if absolutely necessary, or show an error overlay
    // window.location.href = "index.html"; 
}

document.addEventListener("DOMContentLoaded", async () => {
    await fetchAndRefreshUser();

    const postBtn = document.getElementById("feed-send-btn");
    const fileInput = document.getElementById("feed-file");
    const attachBtn = document.getElementById("btn-attach");
    const fileName = document.getElementById("file-name");
    const backBtn = document.getElementById("btn-back-hall");
    const viewFeedBtn = document.getElementById("btn-view-feed");
    const viewGradesBtn = document.getElementById("btn-view-grades");
    const logoutBtn = document.getElementById("btn-logout");

    setupProfile(viewGradesBtn);
    loadFeed();

    if (viewFeedBtn && viewGradesBtn) {
        viewFeedBtn.addEventListener("click", () => switchView('feed'));
        viewGradesBtn.addEventListener("click", () => switchView('grades'));
    }

    if (fileInput && fileName) {
        fileInput.addEventListener("change", () => {
            if (fileInput.files.length > 0) {
                fileName.textContent = fileInput.files[0].name;
            } else {
                fileName.textContent = "";
            }
        });
    }

    if (attachBtn && fileInput) {
        attachBtn.addEventListener("click", (e) => {
            e.preventDefault(); // Prevent default button behavior
            fileInput.click();
        });
    }

    if (postBtn) {
        postBtn.addEventListener("click", (e) => {
            e.preventDefault(); // CRITICAL: Prevent form submission or reload
            createPost();
        });
    }

    if (backBtn) {
        backBtn.addEventListener("click", (e) => {
            e.preventDefault();
            if (String(currentUser?.role || "").toUpperCase() === "ADMIN") {
                window.location.href = "admin-dashboard.html";
            } else {
                window.location.href = "hall.html";
            }
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener("click", (e) => {
            e.preventDefault();
            localStorage.removeItem("wbc_token");
            localStorage.removeItem("wbc_user");
            window.top.location.href = "index.html";
        });
    }
});

async function fetchAndRefreshUser() {
    if (!token) return;
    try {
        const res = await fetch(`${API_URL}/api/me`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        if (res.ok) {
            currentUser = await res.json();
            localStorage.setItem("wbc_user", JSON.stringify(currentUser));
        }
    } catch (e) {
        console.error("Error refreshing user", e);
    }
}

function setupProfile(viewGradesBtn) {
    const nameEl = document.getElementById("feed-user-name");
    const roleEl = document.getElementById("feed-user-role");
    const avatarEl = document.getElementById("feed-user-avatar");
    const controlBtn = document.getElementById("btn-control-center");
    const profileCard = document.getElementById("profile-card");
    const backBtn = document.getElementById("btn-back-hall");

    if (currentUser) {
        if (nameEl) nameEl.textContent = currentUser.username || currentUser.email;
        if (roleEl) {
             let roleText = currentUser.role;
             if (currentUser.role === "STUDENT" && currentUser.studentClass) {
                 roleText += ` (${currentUser.studentClass})`;
             }
             roleEl.textContent = roleText;
        }
        if (avatarEl) {
            avatarEl.innerHTML = createAvatarHtml(currentUser, "80px");
        }

        if (profileCard) {
            profileCard.onclick = null;
            if (String(currentUser.role || "").toUpperCase() !== "ADMIN") {
                profileCard.onclick = () => (window.location.href = "avatar-setup.html");
            } else {
                profileCard.style.cursor = "default";
            }
        }

        if (backBtn) {
            if (String(currentUser.role || "").toUpperCase() === "ADMIN") {
                backBtn.innerHTML = `<i class="fa-solid fa-arrow-left"></i> Retour Admin`;
            } else {
                backBtn.innerHTML = `<i class="fa-solid fa-arrow-left"></i> Retour au Hall`;
            }
        }

        // Control visibility of navigation buttons based on role
        if (currentUser.role === "STUDENT") {
            if (viewGradesBtn) viewGradesBtn.style.display = "flex";
        } else if (currentUser.role === "TEACHER" || currentUser.role === "ADMIN") {
            if (controlBtn) controlBtn.style.display = currentUser.role === "TEACHER" ? "flex" : "none";
            if (viewGradesBtn) viewGradesBtn.style.display = "none";
        }

        // Academic Status Logic
        const statusContainer = document.getElementById("academic-status-container");

        if (statusContainer) {
            const hasStatus = currentUser.academicStatus && 
                ((currentUser.academicStatus.activeEmojis && currentUser.academicStatus.activeEmojis.length > 0) || 
                 currentUser.academicStatus.statusEmoji || 
                 currentUser.academicStatus.remarks);

            if (hasStatus) {
                statusContainer.style.display = "block";
                statusContainer.innerHTML = `<h4>Suivi Académique</h4>`;
                
                let items = [];
                if (currentUser.academicStatus.activeEmojis && currentUser.academicStatus.activeEmojis.length > 0) {
                    items = currentUser.academicStatus.activeEmojis;
                } else if (currentUser.academicStatus.statusEmoji || currentUser.academicStatus.remarks) {
                    // Legacy support
                    items = [{
                        emoji: currentUser.academicStatus.statusEmoji || "📝",
                        remarks: currentUser.academicStatus.remarks || "Aucune remarque."
                    }];
                }

                items.forEach(item => {
                    const statusItem = document.createElement("div");
                    statusItem.style.marginBottom = "10px";
                    statusItem.style.padding = "8px";
                    statusItem.style.background = "rgba(255,255,255,0.05)";
                    statusItem.style.borderRadius = "8px";
                    statusItem.innerHTML = `
                        <div style="display:flex; align-items:center; gap:10px; margin-bottom:4px;">
                            <span style="font-size:1.4rem;">${item.emoji}</span>
                            <div>
                                <span style="font-size:0.75rem; color:#00f2ff; text-transform:uppercase; font-weight:bold; display:block; line-height:1.2;">${item.teacherName || 'Professeur'}</span>
                                <span style="font-size:0.65rem; color:#fff; opacity:0.7; display:block;">${item.subject || 'Général'}</span>
                            </div>
                        </div>
                        <p style="margin:0; font-size:0.85rem; color:#ccc; font-style:italic; padding-top:4px; border-top:1px solid rgba(255,255,255,0.05);">${item.remarks || "Aucune remarque."}</p>
                    `;
                    statusContainer.appendChild(statusItem);
                });
            } else {
                statusContainer.style.display = "none";
            }
        }
    }
}

// --- View Switching ---
async function switchView(viewName) {
    const feedView = document.getElementById("feed-view");
    const gradesView = document.getElementById("grades-view");
    const btnFeed = document.getElementById("btn-view-feed");
    const btnGrades = document.getElementById("btn-view-grades");

    if (viewName === 'feed') {
        feedView.style.display = "flex"; // or block depending on layout, flex for feed-container
        gradesView.style.display = "none";
        btnFeed.classList.add("active");
        btnGrades.classList.remove("active");
    } else if (viewName === 'grades') {
        feedView.style.display = "none";
        gradesView.style.display = "grid"; // Use grid for layout or block
        btnFeed.classList.remove("active");
        btnGrades.classList.add("active");
        
        // Fetch data if not already loaded? Or always refresh?
        await loadGradesAndAbsences();
    }
}

async function loadGradesAndAbsences() {
    const grid = document.getElementById("grades-grid");
    const absencesDisplay = document.getElementById("grades-total-absences");
    const breakdownContainer = document.getElementById("absences-breakdown");
    
    // 1. Absences from user profile
    if (currentUser && currentUser.academicStatus) {
        absencesDisplay.textContent = currentUser.academicStatus.absences || 0;

        // Breakdown logic
        if (breakdownContainer && currentUser.academicStatus.activeEmojis) {
             breakdownContainer.innerHTML = "";
             
             const absenceEntries = currentUser.academicStatus.activeEmojis.filter(e => e.absences > 0);
             
             if (absenceEntries.length > 0) {
                 absenceEntries.forEach(entry => {
                     const pill = document.createElement("div");
                     pill.style.background = "rgba(255, 68, 68, 0.1)";
                     pill.style.border = "1px solid rgba(255, 68, 68, 0.3)";
                     pill.style.color = "#ff4444";
                     pill.style.padding = "5px 12px";
                     pill.style.borderRadius = "20px";
                     pill.style.fontSize = "0.85rem";
                     pill.style.fontWeight = "bold";
                     pill.innerHTML = `${entry.subject || "Matière inconnue"}: ${entry.absences}`;
                     breakdownContainer.appendChild(pill);
                 });
             } else {
                 breakdownContainer.innerHTML = `<span style="color:rgba(255,255,255,0.4); font-size:0.8rem;">Aucun détail disponible.</span>`;
             }
        }
    }

    // 2. Grades
    if (!grid) return;
    grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: rgba(255,255,255,0.5);">
        <i class="fa-solid fa-circle-notch fa-spin fa-2x"></i><br><br>Chargement...
    </div>`;

    try {
        const res = await fetch(`${API_URL}/api/assignments/student`, {
            headers: { "Authorization": `Bearer ${token}` }
        });

        if (res.ok) {
            const assignments = await res.json();
            
            // Group by Course
            const courses = {};
            
            assignments.forEach(a => {
                const courseId = a.course ? a.course._id : "unknown";
                const courseTitle = a.course ? a.course.title : "Cours Inconnu";
                
                if (!courses[courseId]) {
                    courses[courseId] = {
                        title: courseTitle,
                        assignments: []
                    };
                }
                courses[courseId].assignments.push(a);
            });

            if (Object.keys(courses).length === 0) {
                grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: rgba(255,255,255,0.5);">
                    Aucun cours ou devoir trouvé.
                </div>`;
                return;
            }

            grid.innerHTML = "";

            Object.values(courses).forEach(courseData => {
                // Calculate average for this course
                let sum = 0;
                let count = 0;
                
                const assignmentRows = courseData.assignments.map(a => {
                    let gradeHtml = `<span class="badge" style="background:rgba(255,255,255,0.1); color:#aaa;">Non rendu</span>`;
                    let feedbackHtml = "";

                    if (a.mySubmission) {
                        if (a.mySubmission.grade !== undefined && a.mySubmission.grade !== null) {
                            const grade = Number(a.mySubmission.grade);
                            sum += grade;
                            count++;
                            
                            let color = "#00C851";
                            if (grade < 10) color = "#ff4444";
                            else if (grade < 14) color = "#ffbb33";
                            
                            gradeHtml = `<span class="badge" style="background:${color}20; color:${color}; border:1px solid ${color}40;">${grade}/20</span>`;
                        } else {
                            gradeHtml = `<span class="badge" style="background:rgba(0,242,255,0.1); color:#00f2ff;">En attente</span>`;
                        }
                        
                        if (a.mySubmission.feedback) {
                            feedbackHtml = `<div style="font-size:0.8rem; color:#aaa; font-style:italic; margin-top:4px;">"${a.mySubmission.feedback}"</div>`;
                        }
                    }

                    return `
                        <div style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                <span style="font-weight:500; color:white;">${a.title}</span>
                                ${gradeHtml}
                            </div>
                            ${feedbackHtml}
                        </div>
                    `;
                }).join("");

                const average = count > 0 ? (sum / count).toFixed(1) : "-";
                let avgColor = "#ccc";
                if (average !== "-") {
                    const val = parseFloat(average);
                    if (val < 10) avgColor = "#ff4444";
                    else if (val < 14) avgColor = "#ffbb33";
                    else avgColor = "#00C851";
                }

                const card = document.createElement("div");
                card.className = "glass-panel";
                card.style.padding = "20px";
                card.style.display = "flex";
                card.style.flexDirection = "column";
                
                card.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; padding-bottom:10px; border-bottom:1px solid rgba(255,255,255,0.1);">
                        <h3 style="margin:0; font-size:1.1rem; color:var(--feed-accent);">${courseData.title}</h3>
                        <div style="text-align:right;">
                            <span style="display:block; font-size:0.7rem; color:#aaa;">Moyenne</span>
                            <span style="font-weight:bold; font-size:1.2rem; color:${avgColor};">${average}${average !== "-" ? '<small style="font-size:0.8rem; color:#aaa;">/20</small>' : ''}</span>
                        </div>
                    </div>
                    <div style="flex:1;">
                        ${assignmentRows}
                    </div>
                `;
                
                grid.appendChild(card);
            });

        } else {
            grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: #ff4444;">Erreur de chargement.</div>`;
        }
    } catch (e) {
        console.error(e);
        grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: #ff4444;">Erreur réseau.</div>`;
    }
}

async function loadFeed() {
    const stream = document.getElementById("post-list");
    if (!stream) return;

    if (!token) {
        stream.innerHTML = `<p style="text-align:center;color:#ff3366;">Non connecté.</p>`;
        return;
    }

    try {
        // Ne plus forcer ?scope=GLOBAL, laisser le backend décider
        const res = await fetch(`${API_URL}/api/feed`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        
        if (res.ok) {
            const posts = await res.json();
            renderPosts(posts);
        } else {
            stream.innerHTML = `<p style="text-align:center;color:#ff3366;">Erreur chargement feed.</p>`;
        }
    } catch (err) {
        console.error(err);
        stream.innerHTML = `<p style="text-align:center;color:#ff3366;">Erreur réseau.</p>`;
    }
}

function renderPosts(posts) {
    const stream = document.getElementById("post-list");
    if (!stream) return;
    stream.innerHTML = "";

    if (posts.length === 0) {
        stream.innerHTML = `<p style="text-align:center; opacity:0.6;">Aucun post pour le moment.</p>`;
        return;
    }

    posts.forEach(post => {
        const card = document.createElement("div");
        card.className = "post-card glass-panel";
        
        const authorName = post.author ? (post.author.username || post.author.email) : "Inconnu";
        const authorRole = post.author ? post.author.role : "?";
        const avatarHtml = createAvatarHtml(post.author || {}, "36px");
        const time = new Date(post.createdAt).toLocaleString('fr-FR', { 
            day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' 
        });

        const typeLabel = {
            "STATUS": "Discussion",
            "ANNOUNCEMENT": "Annonce",
            "COURSE": "Cours"
        }[post.type] || post.type;

        const scopeLabel = {
            "GLOBAL": "Campus",
            "BTS 1": "BTS 1",
            "BTS 2": "BTS 2",
            "B1": "B1",
            "B2": "B2",
            "B3": "B3",
            "M1": "M1",
            "M2": "M2",
            "CLASS_A": "Classe A",
            "CLASS_B": "Classe B"
        }[post.scope] || post.scope;

        const typeClass = {
            "STATUS": "badge-status",
            "ANNOUNCEMENT": "badge-announcement",
            "COURSE": "badge-course"
        }[post.type] || "badge-default";

        let attachmentHtml = "";
        if (post.attachment && post.attachment.url) {
            attachmentHtml = `
                <a href="${API_URL}${post.attachment.url}" target="_blank" class="attachment-link">
                    <i class="fa-solid fa-file-arrow-down"></i>
                    <span>${post.attachment.originalName || "Télécharger la pièce jointe"}</span>
                </a>
            `;
        }

        // Delete button logic
        let deleteBtnHtml = "";
        const currentUserId = currentUser.id || currentUser._id;
        const postAuthorId = post.author ? (post.author._id || post.author) : null;

        if (currentUserId && postAuthorId && (postAuthorId === currentUserId || currentUser.role === "ADMIN")) {
            deleteBtnHtml = `
                <button class="btn-delete-post" data-id="${post._id}" style="background:none; border:none; color:#ff4444; cursor:pointer; margin-left:10px; font-size:1rem;" title="Supprimer">
                    <i class="fas fa-trash"></i>
                </button>
            `;
        }

        card.innerHTML = `
            <div class="post-header">
                <div class="post-author-info">
                    <div class="post-avatar">${avatarHtml}</div>
                    <div class="author-details">
                        <div class="author-name-row">
                            <span class="author-name">${authorName}</span>
                            <span class="author-role">${authorRole}</span>
                        </div>
                        <span class="post-time">${time}</span>
                    </div>
                </div>
                <div class="post-badges">
                    <span class="badge ${typeClass}">${typeLabel}</span>
                    <span class="badge badge-scope">${scopeLabel}</span>
                    ${deleteBtnHtml}
                </div>
            </div>
            
            <div class="post-body">
                ${post.content ? post.content.replace(/\n/g, "<br>") : ""}
            </div>
            
            ${attachmentHtml}
        `;
        stream.appendChild(card);
    });

    // Attach event listeners for delete
    document.querySelectorAll(".btn-delete-post").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const id = e.currentTarget.dataset.id;
            deletePost(id);
        });
    });
}

async function deletePost(id) {
    if (!confirm("Voulez-vous vraiment supprimer ce post ?")) return;

    try {
        const res = await fetch(`${API_URL}/api/feed/${id}`, {
            method: "DELETE",
            headers: { "Authorization": `Bearer ${token}` }
        });

        if (res.ok) {
            loadFeed();
        } else {
            const err = await res.json();
            alert(err.message || "Erreur lors de la suppression");
        }
    } catch (e) {
        console.error(e);
        alert("Erreur réseau");
    }
}

async function createPost() {
    console.log("createPost called");
    const contentInput = document.getElementById("feed-input");
    const content = contentInput.value;
    const fileInput = document.getElementById("feed-file");
    const file = fileInput && fileInput.files[0];
    
    const type = document.getElementById("feed-type").value;
    const scope = document.getElementById("feed-scope").value;

    console.log("Post data:", { content, hasFile: !!file, type, scope });

    if (!content.trim() && !file) {
        alert("Écris quelque chose ou ajoute un fichier !");
        return;
    }

    if (!token) {
        alert("Vous n'êtes pas connecté.");
        return;
    }

    const btn = document.getElementById("feed-send-btn");
    btn.disabled = true;
    const originalText = btn.innerHTML;
    btn.textContent = "Envoi...";

    try {
        let res;
        if (file) {
            const formData = new FormData();
            formData.append("content", content);
            formData.append("file", file);
            formData.append("scope", scope);
            formData.append("type", type);

            res = await fetch(`${API_URL}/api/feed/upload`, {
                method: "POST",
                headers: { "Authorization": `Bearer ${token}` },
                body: formData
            });
        } else {
            res = await fetch(`${API_URL}/api/feed`, {
                method: "POST",
                headers: { 
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}` 
                },
                body: JSON.stringify({ content, scope, type })
            });
        }

        if (res.ok) {
            contentInput.value = "";
            if (fileInput) fileInput.value = "";
            document.getElementById("file-name").textContent = "";
            loadFeed(); // Refresh
        } else {
            const errData = await res.json().catch(() => ({}));
            console.error("Feed error:", errData);
            alert("Erreur lors de la publication : " + (errData.message || "Erreur inconnue"));
        }
    } catch (err) {
        console.error(err);
        alert("Erreur réseau.");
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}
