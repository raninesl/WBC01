// frontend/ai-assistant.js
document.addEventListener("DOMContentLoaded", () => {
  const API_URL = "http://localhost:4000";

  const token = localStorage.getItem("wbc_token");
  const user = JSON.parse(localStorage.getItem("wbc_user") || "null");

  if (!token || !user) {
    window.location.href = "index.html";
    return;
  }

  const chatBox = document.getElementById("chat-messages");
  const inputEl = document.getElementById("chat-input");
  const sendBtn = document.getElementById("chat-send");
  const statusEl = document.getElementById("assistant-status");
  const userInfoEl = document.getElementById("assistant-user-info");
  const userAvatarEl = document.getElementById("assistant-user-avatar");
  const typingIndicator = document.getElementById("typing-indicator"); // New
  // Update selector to include dynamic buttons if needed, or re-query
  let promptBtns = document.querySelectorAll(".assistant-btn[data-prompt]"); 
  const refreshBtn = document.getElementById("chat-refresh");
  const chatBackBtn = document.getElementById("chat-back-btn");
  const newChatBtn = document.getElementById("new-chat-btn");
  const deleteChatBtn = document.getElementById("delete-chat-btn");
  const openHistoryBtn = document.getElementById("open-history-btn");
  const closeHistoryBtn = document.getElementById("close-history-btn");
  const historyModal = document.getElementById("history-modal-backdrop");
  const historyList = document.getElementById("history-list");

  if (historyModal) historyModal.hidden = true;
  if (historyList) historyList.innerHTML = "";

  let currentConversationId = localStorage.getItem("wbc_current_conv_id") || `conv_${Date.now()}`;
  let currentConversationTitle = localStorage.getItem("wbc_current_conv_title") || "Nouvelle conversation";

  function updateConversationMeta(id, title) {
    currentConversationId = id;
    currentConversationTitle = title;
    localStorage.setItem("wbc_current_conv_id", id);
    localStorage.setItem("wbc_current_conv_title", title);
  }

  // Re-attach listeners to prompt buttons since we might have new ones
  function attachPromptListeners() {
      promptBtns = document.querySelectorAll(".assistant-btn[data-prompt]");
      promptBtns.forEach(btn => {
          btn.onclick = () => {
              const txt = btn.getAttribute("data-prompt");
              sendMessage(txt);
          };
      });
  }
  attachPromptListeners();

  if (userInfoEl) userInfoEl.textContent = `${user.username || user.email}`;

  if (userAvatarEl && typeof window.createAvatarHtml === 'function') {
      const avatarHtml = window.createAvatarHtml(user, "32px");
      const temp = document.createElement('div');
      temp.innerHTML = avatarHtml;
      const newEl = temp.firstElementChild;
      if (newEl) {
          newEl.id = "assistant-user-avatar";
          newEl.style.border = "1px solid rgba(255,255,255,0.2)"; // Keep border style
          userAvatarEl.replaceWith(newEl);
      }
  }

  function parseInlineFormatting(t) {
    // Bold **text**
    t = t.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    // Italic *text*
    t = t.replace(/\*(?!\s)(.*?)(?<!\s)\*/g, "<em>$1</em>");
    // Code `text`
    t = t.replace(/`(.*?)`/g, "<code>$1</code>");
    return t;
  }

  function isTableSeparatorLine(line) {
    return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
  }

  function splitTableRow(line) {
    let s = line.trim();
    if (s.startsWith("|")) s = s.slice(1);
    if (s.endsWith("|")) s = s.slice(0, -1);
    return s.split("|").map(c => c.trim());
  }

  function parseMarkdown(text) {
    const rawLines = String(text || "").split(/\r?\n/);
    const escapedLines = rawLines.map(l =>
      l.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    );

    const out = [];
    let i = 0;
    while (i < escapedLines.length) {
      const line = escapedLines[i];
      const trimmed = line.trim();

      if (!trimmed) {
        out.push("<br><br>");
        i++;
        continue;
      }

      // Titres
      if (/^#{1,3}\s+/.test(trimmed)) {
        const m = trimmed.match(/^(#{1,3})\s+(.*)$/);
        if (m) {
          const level = m[1].length;
          const tag = `h${level}`;
          out.push(`<${tag} style="margin:8px 0 6px 0;color:#fff;font-weight:700;">${parseInlineFormatting(m[2])}</${tag}>`);
          i++;
          continue;
        }
      }

      // Détection tableau : ligne contenant | + ligne suivante = séparateur |:--- |...
      if (trimmed.includes("|") && i + 1 < escapedLines.length) {
        const nextLine = escapedLines[i + 1];
        if (isTableSeparatorLine(nextLine)) {
          const headerCells = splitTableRow(escapedLines[i]);
          i += 2;
          const bodyRows = [];
          while (i < escapedLines.length && escapedLines[i].trim().includes("|")) {
            const l = escapedLines[i].trim();
            if (isTableSeparatorLine(l)) { i++; continue; }
            bodyRows.push(splitTableRow(l));
            i++;
          }
          let html = '<div style="overflow-x:auto;margin:8px 0;">';
          html += '<table style="border-collapse:collapse;width:100%;font-size:13px;background:rgba(15,15,35,0.6);border:1px solid rgba(120,100,255,0.3);border-radius:8px;overflow:hidden;">';
          html += "<thead><tr style=\"background:rgba(90,60,220,0.4);\">";
          headerCells.forEach(c => {
            html += `<th style="border:1px solid rgba(120,100,255,0.35);padding:8px 10px;text-align:left;color:#e9e0ff;font-weight:700;">${parseInlineFormatting(c)}</th>`;
          });
          html += "</tr></thead><tbody>";
          bodyRows.forEach((row, ri) => {
            html += `<tr style="background:${ri % 2 === 0 ? "rgba(255,255,255,0.02)" : "rgba(90,60,220,0.08)"};">`;
            row.forEach(c => {
              html += `<td style="border:1px solid rgba(120,100,255,0.25);padding:7px 10px;vertical-align:top;color:#eaeaff;">${parseInlineFormatting(c)}</td>`;
            });
            html += "</tr>";
          });
          html += "</tbody></table></div>";
          out.push(html);
          continue;
        }
      }

      // Liste à puces
      if (/^\s*[-*]\s+/.test(trimmed)) {
        const items = [];
        while (i < escapedLines.length && /^\s*[-*]\s+/.test(escapedLines[i].trim())) {
          items.push(escapedLines[i].trim().replace(/^\s*[-*]\s+/, ""));
          i++;
        }
        let html = '<ul style="margin:6px 0 6px 20px;padding:0;line-height:1.55;">';
        items.forEach(it => {
          html += `<li style="margin:2px 0;">${parseInlineFormatting(it)}</li>`;
        });
        html += "</ul>";
        out.push(html);
        continue;
      }

      // Ligne normale
      out.push(parseInlineFormatting(line));
      out.push("<br>");
      i++;
    }

    return out.join("");
  }

  function addMessage(text, sender) {
    const msgRow = document.createElement("div");
    msgRow.className = `msg-row ${sender}`;

    // Avatar
    let avatar = document.createElement("div");
    avatar.className = "msg-avatar";
    
    if (sender === "user") {
        if (typeof window.createAvatarHtml === 'function') {
            const avatarHtml = window.createAvatarHtml(user, "36px");
            const temp = document.createElement("div");
            temp.innerHTML = avatarHtml;
            // Use the generated avatar element
            avatar = temp.firstChild;
            avatar.className = "msg-avatar"; // Ensure class is preserved
            avatar.style.width = "36px";
            avatar.style.height = "36px";
            avatar.style.borderRadius = "50%";
            avatar.style.border = "1px solid rgba(255, 255, 255, 0.2)";
            avatar.style.marginRight = "10px";
            avatar.style.flexShrink = "0";
        } else {
             // Fallback Initials
            avatar.style.backgroundColor = "#bd00ff";
            avatar.textContent = (user.username || user.email || "U")[0].toUpperCase();
            avatar.style.display = "flex";
            avatar.style.alignItems = "center";
            avatar.style.justifyContent = "center";
            avatar.style.color = "white";
            avatar.style.fontWeight = "bold";
            avatar.style.fontSize = "1.2rem";
        }
    } else {
        // Bot Avatar
        avatar.style.backgroundImage = "url('logo wess.png')";
    }

    // Bubble
    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";
    bubble.innerHTML = parseMarkdown(text);

    // Append in correct order
    msgRow.appendChild(avatar);
    msgRow.appendChild(bubble);

    chatBox.appendChild(msgRow);
    chatBox.scrollTop = chatBox.scrollHeight;

    if (sender === "bot") {
      addSuggestions(bubble, text);
    }
    return msgRow;
  }

  function addSuggestions(msgEl, rawText) {
    const t = String(rawText || "");
    const hasFormationPrompt =
      t.includes("Pour t’aider au mieux, dis-moi d’abord ta formation") ||
      t.includes("Pour t'aider au mieux, dis-moi d'abord ta formation") ||
      t.includes("dis-moi d’abord ta formation") ||
      t.includes("dis moi d’abord ta formation");
    const hasTrackPrompt =
      t.includes("Choisis maintenant ta filière") || t.includes("Précise ta filière");
    const hasHelpPrompt =
      t.includes("Je t’accompagne sur ta formation") &&
      t.includes("Tu peux me demander :");

    if (!hasFormationPrompt && !hasTrackPrompt && !hasHelpPrompt) return;

    const lines = t.split(/\r?\n/);
    const baseLines = [];
    const optionLines = [];

    lines.forEach((l) => {
      const trimmed = l.trim();
      if (trimmed.startsWith("- ")) {
        optionLines.push(trimmed);
      } else {
        baseLines.push(l);
      }
    });

    const labels = optionLines
      .map((l) => l.slice(2).trim())
      .filter(Boolean);

    if (!labels.length) return;

    // Update the message content to remove the list (since we make buttons)
    msgEl.innerHTML = parseMarkdown(baseLines.join("\n"));

    const container = document.createElement("div");
    container.className = "chat-suggestions";

    labels.forEach((label) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chat-suggestion-btn";
      btn.textContent = label;
      btn.addEventListener("click", () => {
        sendMessage(label);
      });
      container.appendChild(btn);
    });

    msgEl.appendChild(container);
  }

  function clearChatUI() {
    chatBox.innerHTML = "";
  }

  function setStatus(msg = "", ok = true) {
    if (!statusEl) return;
    statusEl.textContent = msg || "En ligne";
    statusEl.style.color = ok ? "#00f2ff" : "#fb7185";
  }

  function setUiBusy(busy) {
    sendBtn.disabled = busy;
    inputEl.disabled = busy;
    promptBtns.forEach((b) => (b.disabled = busy));
    if (refreshBtn) refreshBtn.disabled = busy;
    
    // Show/Hide Typing Indicator
    if (typingIndicator) {
        typingIndicator.style.display = busy ? "flex" : "none";
        if (busy) {
            chatBox.scrollTop = chatBox.scrollHeight;
        }
    }
  }

  async function loadHistory(convId = null) {
    try {
      const url = convId ? `${API_URL}/api/chatbot/history/${convId}` : `${API_URL}/api/chatbot/history/${currentConversationId}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;

      const msgs = await res.json();
      if (!Array.isArray(msgs) || msgs.length === 0) return;

      clearChatUI();
      msgs.forEach((m) => addMessage(m.content, m.role === "user" ? "user" : "bot"));
    } catch (e) {
      console.warn("History load error:", e);
    }
  }

  let inFlight = false;

  async function sendMessage(message) {
    message = String(message || "").trim();
    if (!message || inFlight) return;

    inFlight = true;
    setUiBusy(true);

    addMessage(message, "user");
    inputEl.value = "";

    setStatus("Écrit...", true);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 300000); // Augmenté à 5 minutes

    // On définit le titre de la conversation si c'est le premier message
    if (chatBox.children.length === 1) { // Juste l'avatar de bienvenue + le message user
        currentConversationTitle = message.slice(0, 30) + (message.length > 30 ? "..." : "");
        updateConversationMeta(currentConversationId, currentConversationTitle);
    }

    try {
      const res = await fetch(`${API_URL}/api/chatbot`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ 
          message,
          conversationId: currentConversationId,
          conversationTitle: currentConversationTitle
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        let errMsg = `HTTP ${res.status}`;
        try {
          const errData = await res.json();
          errMsg = errData?.message || errData?.error || errMsg;
        } catch {}
        throw new Error(errMsg);
      }

      const data = await res.json();
      const answer =
        (data && typeof data.answer === "string" && data.answer.trim()) ||
        "Je n’ai pas pu générer une réponse pour le moment.";
      
      addMessage(answer, "bot");
      setStatus("En ligne");
    } catch (err) {
      console.error("Chatbot error:", err);

      if (err.name === "AbortError") {
         addMessage("⚠️ Le serveur met trop de temps à répondre.", "bot");
      } else {
         addMessage(`⚠️ Erreur: ${err.message}`, "bot");
      }
      setStatus("Erreur", false);
    } finally {
      clearTimeout(timeout);
      inFlight = false;
      setUiBusy(false);
      inputEl.focus();
    }
  }

  // Events
  sendBtn.addEventListener("click", () => sendMessage(inputEl.value));
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendMessage(inputEl.value);
    }
  });

  chatBackBtn?.addEventListener("click", () => {
    try {
      if (window.history.length > 1) {
        window.history.back();
        return;
      }
    } catch {}

    const role = String(user?.role || "").toUpperCase();
    const target =
      role === "ADMIN"
        ? "admin-dashboard.html"
        : role === "TEACHER"
          ? "teacher-dashboard.html"
          : "hall.html";

    if (typeof window.transitionTo === "function") window.transitionTo(target);
    else window.location.href = target;
  });

  // promptBtns listeners are handled by attachPromptListeners()

  // ✅ Refresh = vide conversation (UI) + reload, sans supprimer la DB
  refreshBtn?.addEventListener("click", () => {
    window.location.reload();
  });

  // ✅ Nouveau Chat = Simplement vider l'UI (visuel)
  newChatBtn?.addEventListener("click", () => {
    if (confirm("Démarrer une nouvelle conversation ?")) {
        clearChatUI();
        updateConversationMeta(`conv_${Date.now()}`, "Nouvelle conversation");
        addMessage(
            "✅ Nouvelle conversation démarrée. Pose ta question sur SmartClass.",
            "bot"
        );
    }
  });

  // ✅ Supprimer Chat = Supprimer de la DB + vider l'UI
  deleteChatBtn?.addEventListener("click", async () => {
    if (confirm("⚠️ Voulez-vous vraiment supprimer l'historique de cette conversation ? Cette action est irréversible.")) {
        setUiBusy(true);
        try {
            const res = await fetch(`${API_URL}/api/chatbot/history/${encodeURIComponent(currentConversationId)}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
                clearChatUI();
                addMessage("👋 Historique supprimé. Comment puis-je t'aider aujourd'hui ?", "bot");
            } else {
                alert("Erreur lors de la suppression de l'historique");
            }
        } catch (e) {
            console.error("Delete history error:", e);
            alert("Erreur réseau");
        } finally {
            setUiBusy(false);
        }
    }
  });

  // ✅ Visualiser l'historique des CONVERSATIONS
  openHistoryBtn?.addEventListener("click", async () => {
    if (historyModal) historyModal.hidden = false;
    if (!historyList) return;

    historyList.innerHTML = '<div style="text-align: center; opacity: 0.5; padding: 20px;">Chargement...</div>';

    try {
        console.log("[History] Fetching from:", `${API_URL}/api/chatbot/conversations`);
        const res = await fetch(`${API_URL}/api/chatbot/conversations`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.message || `Erreur HTTP ${res.status}`);
        }

        const convs = await res.json();
        console.log("[History] Received:", convs);
        if (!Array.isArray(convs) || convs.length === 0) {
            historyList.innerHTML = '<div style="text-align: center; opacity: 0.5; padding: 20px;">Aucune conversation passée.</div>';
            return;
        }

        historyList.innerHTML = "";
        convs.forEach(c => {
            const item = document.createElement("div");
            item.className = "history-item";

            const date = new Date(c.updatedAt).toLocaleDateString('fr-FR', {
                day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
            });

            item.innerHTML = `
                <button type="button" class="history-delete-btn" title="Supprimer cette conversation">
                    <i class="fa-solid fa-trash"></i>
                </button>
                <div class="title">${c.title || "Sans titre"}</div>
                <div class="preview">${c.lastMessage || "..." }</div>
                <div class="date">${date}</div>
            `;

            const deleteBtn = item.querySelector(".history-delete-btn");
            deleteBtn?.addEventListener("click", async (ev) => {
                ev.stopPropagation();
                const ok = confirm("Supprimer cette conversation de l'historique ?");
                if (!ok) return;
                try {
                    const resDel = await fetch(`${API_URL}/api/chatbot/history/${encodeURIComponent(c._id)}`, {
                        method: "DELETE",
                        headers: { Authorization: `Bearer ${token}` },
                    });
                    if (!resDel.ok) {
                        const errData = await resDel.json().catch(() => ({}));
                        throw new Error(errData.message || `Erreur HTTP ${resDel.status}`);
                    }
                    item.remove();
                    if (historyList && historyList.children.length === 0) {
                        historyList.innerHTML = '<div style="text-align: center; opacity: 0.5; padding: 20px;">Aucune conversation passée.</div>';
                    }
                } catch (err) {
                    alert(`Erreur suppression: ${err.message}`);
                }
            });

            item.onclick = () => {
                updateConversationMeta(c._id, c.title);
                loadHistory(c._id);
                if (historyModal) historyModal.hidden = true;
            };

            historyList.appendChild(item);
        });
    } catch (e) {
        historyList.innerHTML = `<div style="text-align: center; color: #ff4444; padding: 20px;">Erreur: ${e.message}</div>`;
    }
  });

  closeHistoryBtn?.addEventListener("click", () => {
    if (historyModal) historyModal.hidden = true;
  });

  // Fermer la modale en cliquant à l'extérieur
  historyModal?.addEventListener("click", (e) => {
    if (e.target === historyModal) historyModal.hidden = true;
  });

  // ✅ INIT
  // On ne charge plus l'historique automatiquement au démarrage.
  // On commence directement par un message de bienvenue.
  clearChatUI();
  updateConversationMeta(`conv_${Date.now()}`, "Nouvelle conversation");
  addMessage(
    "👋 Bonjour ! Je suis l’assistant IA du campus. Comment puis-je t'aider aujourd'hui ?",
    "bot"
  );
});
