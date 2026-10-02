# smartclass_ai/smartclass-detector-service.py
# ============================================================
# WBC / SmartClass
# Service local permettant au dashboard professeur
# de démarrer / arrêter camera_real.py
# ============================================================

from flask import Flask, request, jsonify
from flask_cors import CORS

import os
import signal
import subprocess
import sys

from pathlib import Path
from dotenv import load_dotenv


# ============================================================
# CONFIGURATION
# ============================================================

BASE_DIR = Path(__file__).resolve().parent

# Charger explicitement le .env situé dans smartclass_ai
load_dotenv(BASE_DIR / ".env")

app = Flask(__name__)

# Le service est local.
# Pour le développement WBC, on autorise le frontend local.
CORS(app)


# ============================================================
# FICHIERS SMARTCLASS
# ============================================================

DETECTOR_SCRIPT = BASE_DIR / "camera_real.py"
SESSION_FILE = BASE_DIR / ".session_id"


# ============================================================
# CLÉ API
# ============================================================

API_KEY = os.getenv(
    "SMARTCLASS_API_KEY",
    "change_me_to_a_long_random_string"
)


# ============================================================
# PROCESSUS DE DÉTECTION
# ============================================================

detector_process = None


def is_valid_api_key(key):
    """
    Vérifie la clé API envoyée par le dashboard.
    """

    if not key:
        return False

    return key == API_KEY


def detector_is_running():
    """
    Retourne True si camera_real.py est actuellement actif.
    """

    global detector_process

    return (
        detector_process is not None
        and detector_process.poll() is None
    )


def save_session_id(session_id):
    """
    Enregistre l'identifiant de session utilisé par
    camera_real.py et camera_sim.py.
    """

    SESSION_FILE.write_text(
        str(session_id).strip(),
        encoding="utf-8"
    )


def clear_session_id():
    """
    Supprime le fichier .session_id lorsque la détection
    est arrêtée.
    """

    try:
        if SESSION_FILE.exists():
            SESSION_FILE.unlink()
    except Exception as exc:
        print(
            "[SmartClass] Impossible de supprimer "
            f".session_id : {exc}"
        )


# ============================================================
# PING
# ============================================================

@app.route("/ping", methods=["GET"])
def ping():

    return jsonify({
        "success": True,
        "message": "Service SmartClass en cours d'écoute",
        "detectorScript": DETECTOR_SCRIPT.name
    })


# ============================================================
# START
# ============================================================

@app.route("/start", methods=["POST"])
def start_detector():

    global detector_process

    # --------------------------------------------------------
    # 1. Vérification API KEY
    # --------------------------------------------------------

    api_key = request.headers.get("X-SmartClass-API-Key")

    if not is_valid_api_key(api_key):

        return jsonify({
            "success": False,
            "message": "Clé API SmartClass invalide"
        }), 401


    # --------------------------------------------------------
    # 2. Vérifier si une détection tourne déjà
    # --------------------------------------------------------

    if detector_is_running():

        return jsonify({
            "success": False,
            "message": "Une détection SmartClass est déjà en cours",
            "pid": detector_process.pid
        }), 409


    # --------------------------------------------------------
    # 3. Vérifier camera_real.py
    # --------------------------------------------------------

    if not DETECTOR_SCRIPT.exists():

        return jsonify({
            "success": False,
            "message": (
                f"Fichier introuvable : "
                f"{DETECTOR_SCRIPT}"
            )
        }), 500


    if DETECTOR_SCRIPT.stat().st_size == 0:

        return jsonify({
            "success": False,
            "message": (
                "camera_real.py existe mais il est vide."
            )
        }), 500


    # --------------------------------------------------------
    # 4. Lire les données envoyées par le dashboard
    # --------------------------------------------------------

    data = request.get_json(silent=True) or {}

    session_id = data.get("sessionId")
    show_window = data.get("showWindow", True)


    # Le teacherId, courseId et roomId peuvent encore être
    # envoyés par l'ancien dashboard, mais ils ne sont plus
    # nécessaires ici.
    #
    # Le backend retrouve ces informations grâce au sessionId.


    if not session_id:

        return jsonify({
            "success": False,
            "message": "sessionId manquant"
        }), 400


    # --------------------------------------------------------
    # 5. Enregistrer la session
    # --------------------------------------------------------

    try:

        save_session_id(session_id)

        print(
            f"[SmartClass] Session active : {session_id}"
        )

    except Exception as exc:

        return jsonify({
            "success": False,
            "message": (
                "Impossible d'enregistrer le sessionId : "
                f"{exc}"
            )
        }), 500


    # --------------------------------------------------------
    # 6. Construire la commande Python
    # --------------------------------------------------------
    #
    # IMPORTANT :
    #
    # On utilise sys.executable au lieu de "python".
    #
    # Ainsi, si le service est lancé depuis ton .venv,
    # camera_real.py utilisera exactement le même Python.
    #
    # Exemple :
    #
    # C:\...\wessup auth - Copie\.venv\Scripts\python.exe
    #

    cmd = [
        sys.executable,
        str(DETECTOR_SCRIPT)
    ]


    # camera_real.py lit SHOW_PREVIEW depuis l'environnement.
    process_env = os.environ.copy()

    process_env["SHOW_PREVIEW"] = (
        "true" if show_window else "false"
    )


    # --------------------------------------------------------
    # 7. Lancer camera_real.py
    # --------------------------------------------------------

    try:

        print("[SmartClass] Lancement du détecteur...")
        print(
            "[SmartClass] Python :",
            sys.executable
        )
        print(
            "[SmartClass] Script :",
            DETECTOR_SCRIPT
        )


        if os.name == "nt":

            # Windows
            #
            # CREATE_NEW_PROCESS_GROUP facilite l'arrêt du
            # processus sans créer obligatoirement un nouveau
            # terminal indépendant.

            creationflags = subprocess.CREATE_NEW_PROCESS_GROUP

            detector_process = subprocess.Popen(
                cmd,
                cwd=str(BASE_DIR),
                env=process_env,
                creationflags=creationflags
            )

        else:

            # Linux / Raspberry Pi

            detector_process = subprocess.Popen(
                cmd,
                cwd=str(BASE_DIR),
                env=process_env,
                start_new_session=True
            )


        print(
            "[SmartClass] Détecteur lancé. PID :",
            detector_process.pid
        )


        return jsonify({
            "success": True,
            "message": "Détection SmartClass lancée",
            "pid": detector_process.pid,
            "sessionId": str(session_id)
        })


    except Exception as exc:

        detector_process = None
        clear_session_id()

        print(
            "[SmartClass] Erreur lancement :",
            exc
        )

        return jsonify({
            "success": False,
            "message": (
                "Erreur lors du lancement : "
                f"{exc}"
            )
        }), 500


# ============================================================
# STOP
# ============================================================

@app.route("/stop", methods=["POST"])
def stop_detector():

    global detector_process


    # --------------------------------------------------------
    # 1. Vérification API KEY
    # --------------------------------------------------------

    api_key = request.headers.get("X-SmartClass-API-Key")

    if not is_valid_api_key(api_key):

        return jsonify({
            "success": False,
            "message": "Clé API SmartClass invalide"
        }), 401


    # --------------------------------------------------------
    # 2. Vérifier si un processus tourne
    # --------------------------------------------------------

    if not detector_is_running():

        detector_process = None
        clear_session_id()

        return jsonify({
            "success": False,
            "message": "Aucune détection en cours"
        }), 400


    pid = detector_process.pid


    # --------------------------------------------------------
    # 3. Arrêter camera_real.py
    # --------------------------------------------------------

    try:

        if os.name == "nt":

            # Windows
            #
            # psutil permet de tuer également les éventuels
            # processus enfants créés par OpenCV / Python.

            try:

                import psutil

                parent = psutil.Process(pid)

                children = parent.children(
                    recursive=True
                )

                for child in children:

                    try:
                        child.terminate()
                    except Exception:
                        pass


                parent.terminate()


                # Attendre quelques secondes
                _, alive = psutil.wait_procs(
                    [parent] + children,
                    timeout=3
                )


                # Forcer l'arrêt si nécessaire
                for process in alive:

                    try:
                        process.kill()
                    except Exception:
                        pass


            except ImportError:

                # Solution de secours si psutil
                # n'est pas installé.

                detector_process.terminate()


        else:

            # Linux / Raspberry Pi

            os.killpg(
                os.getpgid(pid),
                signal.SIGTERM
            )


        try:

            detector_process.wait(
                timeout=5
            )

        except Exception:

            pass


        detector_process = None

        clear_session_id()


        print(
            f"[SmartClass] Détecteur arrêté. PID : {pid}"
        )


        return jsonify({
            "success": True,
            "message": "Détection SmartClass arrêtée"
        })


    except Exception as exc:

        print(
            "[SmartClass] Erreur arrêt :",
            exc
        )

        return jsonify({
            "success": False,
            "message": (
                "Erreur lors de l'arrêt : "
                f"{exc}"
            )
        }), 500


# ============================================================
# STATUS
# ============================================================

@app.route("/status", methods=["GET"])
def get_status():

    running = detector_is_running()

    return jsonify({
        "success": True,
        "isRunning": running,
        "pid": (
            detector_process.pid
            if running
            else None
        ),
        "sessionId": (
            SESSION_FILE.read_text(
                encoding="utf-8"
            ).strip()
            if SESSION_FILE.exists()
            else None
        )
    })


# ============================================================
# LANCEMENT SERVICE
# ============================================================

if __name__ == "__main__":

    print("=" * 60)
    print(" WBC - SmartClass Detector Service")
    print("=" * 60)

    print(
        f" Service : http://localhost:5001"
    )

    print(
        f" Détecteur : {DETECTOR_SCRIPT.name}"
    )

    print(
        f" Python : {sys.executable}"
    )

    print("=" * 60)


    app.run(
        host="localhost",
        port=5001,
        debug=False
    )