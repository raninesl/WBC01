// API_URL is defined in utils.js
// const API_URL = "http://localhost:4000"; 

const params = new URLSearchParams(window.location.search);
const inviteToken = params.get("token") || "";

const form = document.getElementById("teacher-complete-form");
const emailInput = document.getElementById("teacher-email");
const fullNameInput = document.getElementById("teacher-fullname");
const passwordInput = document.getElementById("teacher-password");
const passwordConfirmInput = document.getElementById("teacher-password-confirm");
const errorBox = document.getElementById("teacher-complete-error");
const successBox = document.getElementById("teacher-complete-success");
const subtitle = document.getElementById("invite-subtitle");
const submitButton = form ? form.querySelector("button[type='submit']") : null;

function setFormDisabled(disabled) {
  if (emailInput) emailInput.disabled = true;
  if (fullNameInput) fullNameInput.disabled = disabled;
  if (passwordInput) passwordInput.disabled = disabled;
  if (passwordConfirmInput) passwordConfirmInput.disabled = disabled;
  if (submitButton) submitButton.disabled = disabled;
}

async function loadInviteInfo() {
  if (!inviteToken) {
    if (errorBox) errorBox.textContent = "Lien d’activation invalide.";
    setFormDisabled(true);
    return;
  }

  try {
    const res = await fetch(
      `${API_URL}/api/auth/teacher/invite-info?token=${encodeURIComponent(inviteToken)}`
    );
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      if (errorBox) {
        errorBox.textContent = data.message || "Lien d’activation invalide ou expiré.";
      }
      setFormDisabled(true);
      return;
    }

    if (emailInput) emailInput.value = data.email || "";
    if (fullNameInput && data.fullName) fullNameInput.value = data.fullName;
    if (subtitle) {
      subtitle.textContent = `Compte associé à ${data.email}. Choisis ton mot de passe pour terminer l’activation.`;
    }
  } catch (e) {
    if (errorBox) errorBox.textContent = "Erreur de chargement de l’invitation.";
  }
}

if (form) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (errorBox) errorBox.textContent = "";
    if (successBox) successBox.textContent = "";

    const password = passwordInput ? passwordInput.value.trim() : "";
    const passwordConfirm = passwordConfirmInput ? passwordConfirmInput.value.trim() : "";
    const fullName = fullNameInput ? fullNameInput.value.trim() : "";

    if (!password || !passwordConfirm) {
      if (errorBox) errorBox.textContent = "Merci de saisir un mot de passe et une confirmation.";
      return;
    }

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Validation en cours...";
    }

    try {
      const res = await fetch(`${API_URL}/api/auth/teacher/complete-invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: inviteToken,
          password,
          passwordConfirm,
          fullName,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (errorBox) errorBox.textContent = data.message || "Erreur lors de l’activation.";
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = "Valider mon compte";
        }
        return;
      }

      if (successBox) {
        successBox.innerHTML = `
          <p>${data.message || "Compte professeur complété. En attente de validation par l’administrateur."}</p>
          <br/>
          <a href="index.html" class="btn-primary" style="display:inline-block; text-decoration:none; text-align:center;">Retour à la connexion</a>
        `;
      }
      setFormDisabled(true);
      // Hide submit button to avoid confusion
      if (submitButton) submitButton.style.display = 'none';
    } catch (err) {
      if (errorBox) errorBox.textContent = "Erreur réseau lors de l’activation.";
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = "Valider mon compte";
      }
    }
  });
}

loadInviteInfo();
