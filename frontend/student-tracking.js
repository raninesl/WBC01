
function renderStudentTracking(filterId = "all") {
    const container = document.getElementById("students-courses-container");
    const filterSelect = document.getElementById("tracking-course-filter");

    if (!container) return;
    container.innerHTML = "";

    if (!allCourses || allCourses.length === 0) {
        container.innerHTML = "<p style='padding:20px; text-align:center;'>Aucun cours actif trouvé.</p>";
        return;
    }

    // Populate filter if needed
    if (filterSelect && filterSelect.options.length <= 1) {
         allCourses.forEach(c => {
             // Avoid duplicates if re-running
             if (!filterSelect.querySelector(`option[value="${c._id}"]`)) {
                 const opt = document.createElement("option");
                 opt.value = c._id;
                 opt.textContent = c.title;
                 filterSelect.appendChild(opt);
             }
         });
         
         // Set change listener
         filterSelect.onchange = (e) => {
             renderStudentTracking(e.target.value);
         };
    }

    // Filter courses to display
    const coursesToRender = (filterId === "all") 
        ? allCourses 
        : allCourses.filter(c => c._id === filterId);

    if (coursesToRender.length === 0) {
        container.innerHTML = "<p style='padding:20px; text-align:center;'>Aucun cours ne correspond à ce filtre.</p>";
        return;
    }

    coursesToRender.forEach(course => {
        const courseId = course._id;
        
        // Filter assignments for this course
        const courseAssignments = allAssignments.filter(a => {
            const aCourseId = a.course && (a.course._id || a.course);
            return aCourseId === courseId;
        });

        // Get students in this course
        let studentsInCourse = [];
        if (course.students && course.students.length > 0) {
             studentsInCourse = course.students.map(s => {
                const sId = (s._id || s);
                return allStudents.find(st => st._id === sId) || { _id: sId, username: "Inconnu", studentClass: "?", fullName: "Étudiant Inconnu" };
             });
        }

        // Build HTML Section
        const section = document.createElement("div");
        section.className = "content-card glass-panel";
        section.style.marginBottom = "30px";
        
        let html = `
            <div class="card-header">
                <h3><i class="fas fa-book"></i> ${course.title} <small style="opacity:0.7; font-size:0.8em;">(${course.schedule || 'N/A'})</small></h3>
            </div>
            <div class="table-responsive">
                <table>
                    <thead>
                        <tr>
                            <th>Étudiant</th>
                            <th>Devoirs (Moy.)</th>
                            <th>Examens (Moy.)</th>
                            <th>C. Continu (Moy.)</th>
                            <th>Moyenne Générale</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        
        if (studentsInCourse.length === 0) {
            html += `<tr><td colspan="6" style="text-align:center; opacity:0.6; padding:20px;">Aucun étudiant inscrit à ce cours.</td></tr>`;
        } else {
            studentsInCourse.forEach(student => {
                // Calculate grades
                const grades = {
                    DEVOIR: { sum: 0, count: 0 },
                    EXAMEN: { sum: 0, count: 0 },
                    CONTROLE_CONTINU: { sum: 0, count: 0 }
                };
                
                courseAssignments.forEach(assign => {
                    const sub = assign.submissions ? assign.submissions.find(s => {
                        const sId = s.student._id || s.student;
                        return sId === student._id;
                    }) : null;

                    if (sub && sub.grade !== undefined && sub.grade !== null) {
                        const type = assign.type || "DEVOIR"; // Default to DEVOIR if missing
                        if (grades[type]) {
                            grades[type].sum += Number(sub.grade);
                            grades[type].count++;
                        }
                    }
                });
                
                const avgDevoir = grades.DEVOIR.count > 0 ? (grades.DEVOIR.sum / grades.DEVOIR.count).toFixed(1) : "-";
                const avgExamen = grades.EXAMEN.count > 0 ? (grades.EXAMEN.sum / grades.EXAMEN.count).toFixed(1) : "-";
                const avgCC = grades.CONTROLE_CONTINU.count > 0 ? (grades.CONTROLE_CONTINU.sum / grades.CONTROLE_CONTINU.count).toFixed(1) : "-";
                
                // Global Average
                let totalSum = grades.DEVOIR.sum + grades.EXAMEN.sum + grades.CONTROLE_CONTINU.sum;
                let totalCount = grades.DEVOIR.count + grades.EXAMEN.count + grades.CONTROLE_CONTINU.count;
                const globalAvg = totalCount > 0 ? (totalSum / totalCount).toFixed(1) : "-";
                
                // Color for average
                let avgColor = "var(--text-primary)";
                if (globalAvg !== "-") {
                    const val = parseFloat(globalAvg);
                    if (val < 10) avgColor = "#ff4444";
                    else if (val < 14) avgColor = "#ffbb33";
                    else avgColor = "#00C851";
                }

                // Emojis & Remarks Display
                let emojiDisplay = "";
                if (student.academicStatus) {
                    if (student.academicStatus.activeEmojis && student.academicStatus.activeEmojis.length > 0) {
                        emojiDisplay = `<div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:4px;">`;
                        emojiDisplay += student.academicStatus.activeEmojis.map(e => {
                            const teacherLabel = e.teacherName ? `<small style="font-size:0.65em; opacity:0.6; display:block; line-height:1;">${e.teacherName}</small>` : "";
                            const subjectLabel = e.subject ? `<small style="font-size:0.6em; color:var(--neon-blue); display:block; line-height:1;">${e.subject}</small>` : "";
                            const remarkText = e.remarks ? `<span style="font-size:0.75em; color:#e0e0e0; margin-left:4px; font-weight:normal; background:rgba(255,255,255,0.15); padding:2px 6px; border-radius:8px;">${e.remarks}</span>` : "";
                            
                            // Check if current user can edit this specific emoji
                            const myId = (typeof currentUser !== 'undefined' && currentUser) ? (currentUser.id || currentUser._id) : null;
                            const tId = e.teacherId && (e.teacherId._id || e.teacherId);
                            const canEditThis = (typeof currentUser !== 'undefined' && currentUser && currentUser.role === "ADMIN") || (String(tId) === String(myId));
                            const cursorStyle = canEditThis ? "cursor:pointer;" : "cursor:default;";
                            const onClickAttr = canEditThis ? `onclick="openEvaluationModal('${student._id}', '${(e.subject || "").replace(/'/g, "\\'")}')"` : "";
                            const titleAttr = canEditThis ? `title="Modifier cette évaluation"` : "";

                            return `
                                <div ${onClickAttr} ${titleAttr} style="background:rgba(0,0,0,0.2); padding:4px 8px; border-radius:10px; display:inline-flex; flex-direction:column; gap:2px; ${cursorStyle}">
                                    ${teacherLabel}
                                    ${subjectLabel}
                                    <div style="display:flex; align-items:center;">
                                        <span>${e.emoji || ""}</span>
                                        ${remarkText}
                                    </div>
                                </div>
                            `;
                        }).join("");
                        emojiDisplay += `</div>`;
                    } else if (student.academicStatus.statusEmoji) {
                        // Legacy
                        const legacyRemark = student.academicStatus.remarks ? `<span style="font-size:0.75em; color:#e0e0e0; margin-left:4px; font-weight:normal; background:rgba(255,255,255,0.15); padding:2px 6px; border-radius:8px;">${student.academicStatus.remarks}</span>` : "";
                        emojiDisplay = `<div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:4px;"><span style="white-space:nowrap; display:inline-flex; align-items:center; background:rgba(0,0,0,0.2); padding:2px 6px; border-radius:10px;">${student.academicStatus.statusEmoji}${legacyRemark}</span></div>`;
                    }
                }

                // Check if current user can evaluate in this course
                const myId = (typeof currentUser !== 'undefined' && currentUser) ? (currentUser.id || currentUser._id) : null;
                const isMyCourse = course.teacher && (String(course.teacher._id || course.teacher) === String(myId));
                const canEval = (typeof currentUser !== 'undefined' && currentUser && currentUser.role === "ADMIN") || isMyCourse;

                const evalButton = canEval 
                    ? `<button class="btn-icon eval-student-btn" onclick="openEvaluationModal('${student._id}', '${course.title.replace(/'/g, "\\'")}')" title="Évaluer"><i class="fas fa-star"></i></button>`
                    : `<button class="btn-icon eval-student-btn disabled" style="opacity:0.3; cursor:not-allowed;" title="Non autorisé dans cette matière" onclick="alert('Vous ne pouvez évaluer que dans vos propres matières.')"><i class="fas fa-star"></i></button>`;

                html += `
                    <tr>
                        <td>
                            <div style="display:flex; align-items:flex-start; gap:10px;">
                                <div style="margin-top:5px;">${typeof createAvatarHtml === 'function' ? createAvatarHtml(student, "30px") : '<div style="width:30px;height:30px;background:#333;border-radius:50%;"></div>'}</div>
                                <div>
                                    <div style="font-weight:bold;">
                                        ${student.fullName || student.username}
                                    </div>
                                    ${emojiDisplay}
                                    <div style="font-size:0.8em; opacity:0.7; margin-top:2px;">${student.studentClass || ""}</div>
                                </div>
                            </div>
                        </td>
                        <td>${avgDevoir !== "-" ? avgDevoir + "/20" : "-"}</td>
                        <td>${avgExamen !== "-" ? avgExamen + "/20" : "-"}</td>
                        <td>${avgCC !== "-" ? avgCC + "/20" : "-"}</td>
                        <td style="font-weight:bold; color:${avgColor}; font-size:1.1em;">${globalAvg !== "-" ? globalAvg + "/20" : "-"}</td>
                        <td>
                            <button class="btn-icon view-student-btn" data-id="${student._id}" title="Détails"><i class="fas fa-eye"></i></button>
                            <button class="btn-icon msg-student-btn" data-id="${student._id}" title="Message"><i class="fas fa-comment"></i></button>
                            ${evalButton}
                        </td>
                    </tr>
                `;
            });
        }
        
        html += `
                    </tbody>
                </table>
            </div>
        `;
        
        section.innerHTML = html;
        container.appendChild(section);
    });
}
