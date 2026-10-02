import os
from pathlib import Path

from dotenv import load_dotenv


# ============================================================
# DOSSIER SMARTCLASS
# ============================================================

BASE_DIR = Path(__file__).resolve().parent


# ============================================================
# VARIABLES D'ENVIRONNEMENT
# ============================================================

load_dotenv(BASE_DIR / ".env")


# ============================================================
# BACKEND WBC
# ============================================================

API_BASE = os.getenv(
    "WBC_API_BASE",
    "http://localhost:4000"
).rstrip("/")


# ============================================================
# CLÉ API SMARTCLASS
#
# Utilisée par camera_real.py / camera_sim.py pour communiquer
# avec le backend WBC.
#
# IMPORTANT :
# La valeur réelle doit être définie dans :
# smartclass_ai/.env
# ============================================================

SMARTCLASS_API_KEY = os.getenv(
    "SMARTCLASS_API_KEY",
    "change_me_to_a_long_random_string"
)


# ============================================================
# SESSION SMARTCLASS
#
# Le service smartclass-detector-service.py reçoit le
# sessionId depuis le dashboard professeur puis l'enregistre
# dans ce fichier.
# ============================================================

SESSION_FILE = BASE_DIR / ".session_id"


def load_session_id() -> str:
    """
    Retourne l'identifiant de la session SmartClass active.
    """

    if not SESSION_FILE.exists():
        raise RuntimeError(
            "Aucune session SmartClass active : "
            "le fichier .session_id est introuvable."
        )

    session_id = SESSION_FILE.read_text(
        encoding="utf-8"
    ).strip()

    if not session_id:
        raise RuntimeError(
            "Le fichier .session_id est vide."
        )

    return session_id


def save_session_id(session_id: str) -> None:
    """
    Enregistre l'identifiant d'une session SmartClass.
    """

    if not session_id:
        raise ValueError(
            "session_id ne peut pas être vide."
        )

    SESSION_FILE.write_text(
        str(session_id).strip(),
        encoding="utf-8"
    )


def clear_session_id() -> None:
    """
    Supprime le fichier de session locale.
    """

    if SESSION_FILE.exists():
        SESSION_FILE.unlink()


# ============================================================
# HEADERS API SMARTCLASS
# ============================================================

def headers_api_key() -> dict:
    """
    Headers utilisés par les caméras SmartClass
    pour envoyer les données au backend.
    """

    return {
        "Content-Type": "application/json",
        "x-api-key": SMARTCLASS_API_KEY
    }