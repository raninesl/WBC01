// app.js

// 1) Créer un admin par défaut s'il n'existe aucun user
if (!localStorage.getItem("users")) {
  const defaultUsers = [
    {
      id: 1,
      name: "Admin Principal",
      email: "admin@wessup.com",
      username: "admin",      // identifiant
      password: "admin123",   // mot de passe
      role: "admin",
      status: "actif",
    },
  ];
  localStorage.setItem("users", JSON.stringify(defaultUsers));
}

// 2) Sélection des éléments du formulaire
const form = document.getElementById("admin-login-form");
const errorBox = document.getElementById("auth-error");
const yearSpan = document.getElementById("year");
if (yearSpan) yearSpan.textContent = new Date().getFullYear();

// 3) Connexion
form.addEventListener("submit", (e) => {
  e.preventDefault();

  const identifier = document.getElementById("admin-username").value.trim();
  const password = document.getElementById("admin-password").value.trim();

  // On lit la liste des utilisateurs à chaque connexion
  const usersData = JSON.parse(localStorage.getItem("users")) || [];

  // On cherche un utilisateur dont l'identifiant OU l'email correspond
  const user = usersData.find(
    (u) =>
      (u.username === identifier || u.email === identifier) &&
      u.password === password
  );

  if (!user) {
    errorBox.hidden = false;
    return;
  }

  // On sauvegarde l'utilisateur connecté
  localStorage.setItem("connectedUser", JSON.stringify(user));

  // Redirection selon le rôle
  if (user.role === "admin") {
    window.location.href = "admin-dashboard.html";
  } else {
    // 👉 prof ET étudiant vont sur la page d'avatar
    window.location.href = "avatar-setup.html";
  }
});
