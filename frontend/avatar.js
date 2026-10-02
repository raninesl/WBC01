// frontend/avatar.js
document.addEventListener("DOMContentLoaded", () => {
  const API_URL = window.API_URL || "http://localhost:4000";
  const token = localStorage.getItem("wbc_token");
  const currentUser = JSON.parse(localStorage.getItem("wbc_user") || "null");

  // Redirect admins and teachers away!
  const userRole = String(currentUser?.role || "").toUpperCase();
  if (userRole === "ADMIN" || userRole === "TEACHER") {
    window.location.replace("hall.html");
    return;
  }

  function goTo(url, isBack = false) {
    if (typeof window.transitionTo === "function") {
      window.transitionTo(url, isBack);
      return;
    }
    window.location.href = url;
  }

  function buildAuthHeaders() {
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  // --- DOM Elements ---
  const modelViewer = document.getElementById("avatar-3d-view");
  const openAvaturnBtn = document.getElementById("open-avaturn-btn");
  const validerEntrerBtn = document.getElementById("valider-entrer-btn");
  const creatorModal = document.getElementById("creator-modal-overlay");
  const closeCustomizerBtn = document.getElementById("close-customizer-btn");
  const saveStatus = document.getElementById("avatar-save-status");
  const placeholder = document.getElementById("avatar-placeholder");
  const loginBanner = document.getElementById("login-banner");
  const loginBtn = document.getElementById("btn-login");
  const importUrlMain = document.getElementById("avatar-import-url-main");
  const importBtnMain = document.getElementById("avatar-import-btn-main");
  const stepsEl = document.getElementById("avatar-steps");

  // --- Initialization ---
  loadSavedConfig();

  let avatar3DUrl = "";
  let avatarCreatorUrl = "";
  let isBusy = false;

  function setBusy(next) {
    isBusy = Boolean(next);
    if (openAvaturnBtn) openAvaturnBtn.disabled = isBusy || !token;
    if (importBtnMain) importBtnMain.disabled = isBusy || !token;
    const modalImportBtn = document.getElementById("avatar-import-btn");
    if (modalImportBtn) modalImportBtn.disabled = isBusy || !token;
    if (validerEntrerBtn) validerEntrerBtn.disabled = isBusy || !avatar3DUrl;
  }

  if (loginBtn) {
    loginBtn.addEventListener("click", () => {
      goTo("index.html", true);
    });
  }

  async function loadPublicConfig() {
    try {
      const res = await fetch(`${API_URL}/api/config/public`);
      if (!res.ok) return;
      const data = await res.json();
      avatarCreatorUrl = String(data?.avatarCreatorUrl || "").trim();
    } catch {
    }
  }

  loadPublicConfig();

  async function loadSavedConfig() {
    try {
      if (!token) {
        updatePreview();
        return;
      }
      const res = await fetch(`${API_URL}/api/me/avatar`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data) {
          if (data.avatar3DUrl) avatar3DUrl = data.avatar3DUrl;
        }
      }
      updatePreview();
    } catch (err) {
      console.error("Load error:", err);
    }
  }

  function resolveBackendUrl(pathOrUrl) {
    const u = String(pathOrUrl || "").trim();
    if (!u) return "";
    if (/^https?:\/\//i.test(u)) return u;
    if (u.startsWith("/")) return `${API_URL}${u}`;
    return u;
  }

  function apply3DViewer() {
    if (!modelViewer) return;
    
    const targetUrl = String(avatar3DUrl || "").trim();
    if (!targetUrl) {
      modelViewer.removeAttribute("src");
      modelViewer.style.display = "none";
      return;
    }

    const resolved = resolveBackendUrl(targetUrl);
    const isExternal = /^https?:\/\//i.test(resolved) && !resolved.startsWith(API_URL);
    const finalUrl = isExternal
      ? `${API_URL}/api/avatar-proxy?url=${encodeURIComponent(resolved)}`
      : resolved;
    
    modelViewer.src = finalUrl;
    modelViewer.style.display = "block";
  }

  function updatePreview() {
    apply3DViewer();
    if (placeholder) placeholder.style.display = avatar3DUrl ? "none" : "flex";
    if (modelViewer) modelViewer.style.display = avatar3DUrl ? "block" : "none";
    if (validerEntrerBtn) validerEntrerBtn.disabled = !avatar3DUrl || isBusy;
    if (loginBanner) loginBanner.style.display = token ? "none" : "flex";
    if (openAvaturnBtn) openAvaturnBtn.disabled = !token || isBusy;
    if (importBtnMain) importBtnMain.disabled = !token || isBusy;

    if (stepsEl) {
      const s1 = stepsEl.querySelector('[data-step="1"]');
      const s2 = stepsEl.querySelector('[data-step="2"]');
      const s3 = stepsEl.querySelector('[data-step="3"]');
      [s1, s2, s3].forEach((el) => {
        if (!el) return;
        el.classList.remove("is-active", "is-done", "is-locked");
      });

      if (!token) {
        s1?.classList.add("is-locked");
        s2?.classList.add("is-locked");
        s3?.classList.add("is-locked");
      } else if (!avatar3DUrl) {
        s1?.classList.add("is-active");
        s2?.classList.add("is-locked");
        s3?.classList.add("is-locked");
      } else {
        s1?.classList.add("is-done");
        s2?.classList.add("is-done");
        s3?.classList.add("is-active");
      }
    }

    if (!avatar3DUrl) {
      setStatus(token ? "Étape 1 : créez votre avatar (Avaturn), puis importez-le." : "Connectez-vous pour créer et importer votre avatar.", "info");
      return;
    }
    setStatus("Avatar prêt ✅ Vous pouvez valider et entrer.", "success");
  }

  function setStatus(msg = "", type = "info") {
    if (!saveStatus) return;
    saveStatus.textContent = msg;
    saveStatus.style.color = type === "success" ? "#00ff88" : (type === "error" ? "#ff3366" : "var(--accent-cyan)");
  }

  // --- Avaturn Logic ---
  let avaturnSdk = null;

  async function importAvatarFromUrl(inputUrl, { autoEnter = false } = {}) {
    if (!token) {
      setStatus("Connectez-vous pour importer un avatar 3D.", "error");
      return null;
    }
    const url = String(inputUrl || "").trim();
    if (!url) {
      setStatus("Collez une URL d'export (.glb/.gltf/.vrm).", "error");
      return null;
    }

    setBusy(true);
    setStatus("Import en cours...", "info");
    const res = await fetch(`${API_URL}/api/me/avatar/import`, {
      method: "POST",
      headers: buildAuthHeaders(),
      body: JSON.stringify({ url }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setStatus(data?.message || "Erreur import", "error");
      setBusy(false);
      return null;
    }

    avatar3DUrl = data.avatar3DUrl || "";
    updatePreview();
    setStatus("Import terminé ✅", "success");
    if (autoEnter) {
      if (creatorModal) creatorModal.style.display = "none";
      setTimeout(() => {
        goTo("hall.html");
      }, 250);
    }
    setBusy(false);
    return data;
  }

  async function openAvaturn() {
    if (!creatorModal) return;
    
    creatorModal.style.display = "flex";
    if (stepsEl) {
      const s1 = stepsEl.querySelector('[data-step="1"]');
      const s2 = stepsEl.querySelector('[data-step="2"]');
      const s3 = stepsEl.querySelector('[data-step="3"]');
      [s1, s2, s3].forEach((el) => el?.classList.remove("is-active"));
      s1?.classList.add("is-active");
    }
    const container = document.getElementById("avaturn-container");
    if (container) container.innerHTML = "";
    
    const url = avatarCreatorUrl || "https://demo.avaturn.dev";

    if (!window.AvaturnSDK) {
        setStatus("Erreur: SDK Avaturn non chargé.", "error");
        return;
    }

    try {
        avaturnSdk = new window.AvaturnSDK();
        await avaturnSdk.init(container, { url });
        
        avaturnSdk.on("export", async (data) => {
            const glbUrl = data.url;
            const importInput = document.getElementById("avatar-import-url");
            if (importInput) importInput.value = glbUrl;
            if (importUrlMain) importUrlMain.value = glbUrl;
            const imported = await importAvatarFromUrl(glbUrl, { autoEnter: true });
            if (!imported) {
              avatar3DUrl = glbUrl;
              apply3DViewer();
              setStatus("Export Avaturn reçu. Import serveur requis pour le déploiement.", "error");
            }
        });
    } catch (err) {
        console.error("Avaturn Init Error:", err);
        setStatus("Impossible d'initialiser Avaturn.", "error");
    }
  }

  // --- Events ---
  if (openAvaturnBtn) {
    openAvaturnBtn.addEventListener("click", openAvaturn);
  }

  if (closeCustomizerBtn) {
    closeCustomizerBtn.addEventListener("click", () => {
      creatorModal.style.display = "none";
    });
  }

  async function saveAvatarUrl(url) {
    if (!token) throw new Error("Not authenticated");
    const body = {};
    if (url) body.avatar3DUrl = url;

    const res = await fetch(`${API_URL}/api/me/avatar`, {
      method: "PUT",
      headers: buildAuthHeaders(),
      body: JSON.stringify(body),
    });
    
    if (!res.ok) throw new Error("Erreur sauvegarde");
    return res.json();
  }

  if (validerEntrerBtn) {
    validerEntrerBtn.addEventListener("click", async () => {
      try {
        if (!avatar3DUrl) {
          setStatus("Créez d'abord votre avatar via Avaturn.", "error");
          return;
        }
        if (token) {
          setStatus("Sauvegarde...", "info");
          await saveAvatarUrl(avatar3DUrl);
        }
        goTo("hall.html");
      } catch (err) {
        setStatus("❌ Erreur de sauvegarde", "error");
      }
    });
  }

  const avatarImportBtn = document.getElementById("avatar-import-btn");
  if (avatarImportBtn) {
    avatarImportBtn.addEventListener("click", async () => {
      const input = document.getElementById("avatar-import-url");
      await importAvatarFromUrl(input ? input.value : "", { autoEnter: true });
    });
  }

  if (importBtnMain) {
    importBtnMain.addEventListener("click", async () => {
      await importAvatarFromUrl(importUrlMain ? importUrlMain.value : "", { autoEnter: true });
    });
  }

  if (importUrlMain) {
    importUrlMain.addEventListener("keydown", async (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        await importAvatarFromUrl(importUrlMain.value, { autoEnter: true });
      }
    });
  }

  updatePreview();
});
