"""
⚠️ LEGACY — OBSOLÈTE (WBC 2026). NE PLUS UTILISER.
=====================================================
Remplacé par :
  1. Le dashboard professeur WBC (teacher-dashboard.html)
     - Bouton "Nouvelle séance SmartClass" → POST /api/smartclass/sessions/start
     - Bouton ▶ Démarrer la détection → POST http://localhost:5001/start
     - Bouton ⏹ Arrêter → POST http://localhost:5001/stop
  2. smartclass-detector-service.py (Flask :5001) → pilote camera_real.py

Pourquoi obsolète / Q6 (sécurité) :
  Ce script nécessitait TEACHER_EMAIL + TEACHER_PASSWORD dans config.py
  (ce qui violerait Q6 — "pas d'email/password professeur dans Python").
  Ces variables n'existent plus dans config.py : le script est donc
  naturellement cassé et ne peut pas être utilisé tel quel.
  L'authentification professeur est 100% gérée par WBC/JWT côté frontend.

Ancienne doc (historique uniquement) :
-------------------------------------
start_session.py — Login prof + démarrage d'une séance SmartClass.

Écrit l'ID de la séance créée dans `.session_id` pour que les
autres simulateurs (sensor / camera / student) le récupèrent.

Variables d'env :
  TEACHER_EMAIL / TEACHER_PASSWORD : identifiants du prof   ❌ RETIRÉS
  COURSE_ID                        : ObjectId du cours WBC pour la séance
  SESSION_ROOM                     : libellé salle (défaut "Salle A")
  SESSION_TYPE                     : lecture / td / tp / exam / other

Lance : python start_session.py
"""
import os
import sys
import requests

from config import (
    API_BASE,
    TEACHER_EMAIL,
    TEACHER_PASSWORD,
    COURSE_ID,
    save_session_id,
    headers_jwt,
)


def login(email: str, password: str) -> str:
    """Login via /api/auth/login. Le backend accepte {email, password}."""
    url = f"{API_BASE}/api/auth/login"
    r = requests.post(url, json={"email": email, "password": password}, timeout=10)
    if not r.ok:
        raise RuntimeError(f"Login échoué : {r.status_code} {r.text[:200]}")
    data = r.json()
    token = data.get("token") or data.get("accessToken") or data.get("jwt")
    if not token:
        raise RuntimeError(f"Pas de token dans la réponse : {data}")
    return token


def pick_course(token: str) -> str:
    """Si COURSE_ID est vide, propose la liste des cours du prof."""
    url = f"{API_BASE}/api/courses/my-courses"
    r = requests.get(url, headers=headers_jwt(token), timeout=10)
    if not r.ok:
        raise RuntimeError(f"Impossible de lister les cours : {r.status_code} {r.text[:200]}")
    courses = r.json()
    if not courses:
        raise RuntimeError("Le prof n'a aucun cours dans la base. Crée-en un d'abord côté admin.")

    print("\nCours disponibles :")
    for i, c in enumerate(courses):
        print(f"  [{i}] {c.get('title')}  (id={c.get('_id')})")

    raw = input("\nIndex du cours pour la séance : ").strip()
    try:
        idx = int(raw)
        return courses[idx]["_id"]
    except (ValueError, IndexError):
        raise RuntimeError("Index invalide.")


def main():
    print(f"[start_session] login {TEACHER_EMAIL} sur {API_BASE} ...")
    try:
        token = login(TEACHER_EMAIL, TEACHER_PASSWORD)
    except RuntimeError as e:
        print(f"ERREUR : {e}", file=sys.stderr)
        sys.exit(1)
    print("  ✓ login prof OK")

    course_id = COURSE_ID
    if not course_id:
        try:
            course_id = pick_course(token)
        except RuntimeError as e:
            print(f"ERREUR : {e}", file=sys.stderr)
            sys.exit(1)

    body = {
        "courseId":    course_id,
        "room":        os.getenv("SESSION_ROOM", "Salle A"),
        "sessionType": os.getenv("SESSION_TYPE", "lecture"),
    }
    url = f"{API_BASE}/api/smartclass/session/start"
    r = requests.post(url, json=body, headers=headers_jwt(token), timeout=10)

    if r.status_code == 409:
        # Séance déjà active : on récupère son id
        sid = r.json().get("sessionId")
        if sid:
            print(f"  ⚠ Une séance est déjà active : {sid}. On la réutilise.")
            save_session_id(sid)
            print(f"\n[start_session] sessionId écrit dans .session_id")
            return
        print(f"ERREUR 409 sans sessionId : {r.text[:200]}", file=sys.stderr)
        sys.exit(1)

    if not r.ok:
        print(f"ERREUR : {r.status_code} {r.text[:200]}", file=sys.stderr)
        sys.exit(1)

    session = r.json()
    sid = session.get("_id")
    if not sid:
        print(f"ERREUR : pas d'_id dans la réponse : {session}", file=sys.stderr)
        sys.exit(1)

    save_session_id(sid)
    print(f"\n[start_session] ✓ Séance démarrée : {sid}")
    print(f"[start_session] sessionId écrit dans .session_id")
    print("\nTu peux maintenant lancer :")
    print("   python sensor_sim.py")
    print("   python camera_sim.py")
    print("   python student_sim.py")
    print("ou tout en parallèle :")
    print("   python run_all.py")


if __name__ == "__main__":
    main()
