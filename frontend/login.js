// login.js

const API_URL = "http://localhost:4000";

const loginForm = document.getElementById("login-form");
const usernameInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const errorBox = document.getElementById("login-error");

if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (errorBox) errorBox.textContent = "";

    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();

    if (!username || !password) {
      if (errorBox)
        errorBox.textContent = "Veuillez saisir un identifiant et un mot de passe.";
      return;
    }

    try {
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (errorBox) {
          errorBox.textContent =
            data.message || "Identifiants invalides. Veuillez réessayer.";
        }
        return;
      }

      const data = await res.json();

      // 1) on stocke le token + user
      localStorage.setItem("wbc_token", data.token);
      localStorage.setItem("wbc_user", JSON.stringify(data.user));

      // 2) redirection selon le rôle
      if (data.user.role === "ADMIN") {
        window.transitionTo("admin-dashboard.html");
      } else if (data.user.role === "TEACHER") {
        window.transitionTo("teacher-dashboard.html");
      } else {
        // STUDENT → on l’envoie vers la personnalisation d’avatar
        window.transitionTo("avatar-setup.html");
      }
    } catch (err) {
      console.error("Erreur login:", err);
      if (errorBox) {
        errorBox.textContent = "Erreur de connexion au serveur. Vérifie que l'API tourne.";
      }
    }
  });
}
