"""
camera_real.py - WBC SmartClass IA - V3

Modele YOLO V3 :
    0 = Looking_Forward
    1 = Raising_Hand
    2 = Reading
    3 = Sleeping
    4 = Turning_Around

Pipeline :
    Webcam
      -> YOLOv8 V3
      -> filtrage des detections
      -> aggregation YOLO -> actions SmartClass
      -> calcul des indicateurs
      -> POST /api/smartclass/camera

La session SmartClass est fournie par le dashboard WBC
via le fichier .session_id.
"""

import os
import sys
import time
import signal
import statistics
from datetime import datetime, timezone

import requests

try:
    import cv2
except ImportError:
    print(
        "ERREUR: opencv-python n'est pas installe.",
        file=sys.stderr
    )
    sys.exit(1)

try:
    from ultralytics import YOLO
except ImportError:
    print(
        "ERREUR: ultralytics n'est pas installe.",
        file=sys.stderr
    )
    sys.exit(1)

from config import (
    API_BASE,
    headers_api_key,
    load_session_id
)


# ============================================================
# CONFIGURATION
# ============================================================

def _env(name, default=""):
    """
    Lit une variable d'environnement
    et supprime les espaces parasites.
    """
    return os.getenv(name, default).strip()


INTERVAL_S = float(
    _env("CAMERA_INTERVAL_S", "2")
)

CAMERA_INDEX = int(
    _env("CAMERA_INDEX", "0")
)

# Nouveau modele V3 fine-tune
MODEL_PATH = r"C:\Users\User\Documents\wessup auth - Copie\smartclass_ai\runs\detect\runs\detect\smartclass_v2_finetune7\weights\best.pt"

SHOW_PREVIEW = (
    _env("SHOW_PREVIEW", "0").lower()
    in ("1", "true", "yes", "on")
)

SOURCE_ID = _env(
    "CAMERA_SOURCE",
    "pc-webcam"
)

CONF_THRESHOLD = float(
    _env("CONF_THRESHOLD", "0.25")
)


# ============================================================
# MAPPING YOLO V3 -> ACTIONS SMARTCLASS
# ============================================================

SMARTCLASS_MODEL_TO_ACTION = {

    # Etudiant regardant devant lui
    # -> indicateur d'attention
    "looking_forward": "focused",

    # Main levee
    # -> participation / engagement
    "raising_hand": "hand_raising",

    # Lecture
    # -> activite pedagogique attentive
    "reading": "reading",

    # Sommeil / posture de sommeil
    # -> indicateur de fatigue
    "sleeping": "sleeping",

    # L'etudiant se tourne.
    # On ne considere PAS automatiquement
    # ce comportement comme de la distraction.
    "turning_around": "other",
}


# ============================================================
# ACTIONS STANDARDISEES ENVOYEES AU BACKEND
# ============================================================

ACTION_KEYS = [
    "focused",
    "reading",
    "writing",
    "hand_raising",
    "phone",
    "sleeping",
    "talking",
    "other",
]


# ============================================================
# ARRET PROPRE
# ============================================================

stop = False


def _on_sigint(*_):
    global stop
    stop = True


signal.signal(
    signal.SIGINT,
    _on_sigint
)


# ============================================================
# IoU
# ============================================================

def _iou(box1, box2):
    """
    Calcule l'Intersection over Union
    entre deux bounding boxes.
    """

    x1 = max(box1[0], box2[0])
    y1 = max(box1[1], box2[1])

    x2 = min(box1[2], box2[2])
    y2 = min(box1[3], box2[3])

    if x2 <= x1 or y2 <= y1:
        return 0.0

    intersection = (
        (x2 - x1)
        * (y2 - y1)
    )

    area1 = (
        (box1[2] - box1[0])
        * (box1[3] - box1[1])
    )

    area2 = (
        (box2[2] - box2[0])
        * (box2[3] - box2[1])
    )

    union = (
        area1
        + area2
        - intersection
    )

    if union <= 0:
        return 0.0

    return intersection / union


# ============================================================
# FILTRAGE DES DETECTIONS
# ============================================================

def filter_overlapping_detections(
    detections,
    iou_threshold=0.35
):
    """
    Cross-class NMS.

    Si plusieurs classes detectent pratiquement
    la meme personne, seule la detection avec
    la confiance la plus elevee est conservee.

    Cela evite par exemple qu'une meme personne soit
    comptee simultanement comme Looking_Forward
    et Sleeping.
    """

    if len(detections) <= 1:
        return list(detections)

    sorted_detections = sorted(
        detections,
        key=lambda detection: -float(detection[4])
    )

    kept = []

    for detection in sorted_detections:

        box = detection[:4]

        overlapping = False

        for existing in kept:

            if _iou(
                box,
                existing[:4]
            ) > iou_threshold:

                overlapping = True
                break

        if not overlapping:
            kept.append(detection)

    return kept


# ============================================================
# AGREGATION YOLO -> SMARTCLASS
# ============================================================

def aggregate_detections(
    detections,
    names
):
    """
    Convertit les detections YOLO V3 :

        Looking_Forward
        Raising_Hand
        Reading
        Sleeping
        Turning_Around

    en actions standardisees SmartClass.
    """

    actions = {
        key: 0
        for key in ACTION_KEYS
    }

    confidences = []

    people = 0

    detections = filter_overlapping_detections(
        detections,
        iou_threshold=0.35
    )

    for detection in detections:

        class_id = int(
            detection[5]
        )

        confidence = float(
            detection[4]
        )

        if confidence < CONF_THRESHOLD:
            continue

        class_name = names.get(
            class_id,
            ""
        )

        # Normalisation importante :
        # Looking_Forward -> looking_forward
        class_name = str(
            class_name
        ).strip().lower()

        action = SMARTCLASS_MODEL_TO_ACTION.get(
            class_name
        )

        if action is None:

            print(
                "[camera_real] classe inconnue ignoree : "
                + class_name
            )

            continue

        actions[action] += 1

        people += 1

        confidences.append(
            confidence
        )

    if confidences:

        avg_confidence = round(
            statistics.mean(confidences),
            3
        )

    else:

        avg_confidence = 0.0

    return (
        people,
        actions,
        avg_confidence
    )


# ============================================================
# INDICATEURS SMARTCLASS
# ============================================================

def derive_percents(
    actions,
    people
):
    """
    Calcule les indicateurs experimentaux SmartClass.

    Attention :
        Looking_Forward
        Reading
        Raising_Hand

    Fatigue :
        Sleeping

    Distraction :
        phone + talking

    Turning_Around reste classe dans "other".
    Il n'est pas considere automatiquement
    comme de la distraction.
    """

    if people <= 0:

        return (
            0.0,
            0.0,
            0.0
        )

    # --------------------------------------------------------
    # ATTENTION / ENGAGEMENT
    # --------------------------------------------------------

    attention_count = (
        actions["focused"]
        + actions["reading"]
        + actions["hand_raising"]
    )

    attention = (
        attention_count
        / people
        * 100
    )

    # --------------------------------------------------------
    # DISTRACTION
    # --------------------------------------------------------
    #
    # Le modele V3 ne detecte actuellement
    # ni phone ni talking.
    #
    # On garde toutefois ces champs pour rester
    # compatible avec le backend SmartClass.
    # --------------------------------------------------------

    distraction_count = (
        actions["phone"]
        + actions["talking"]
    )

    distraction = (
        distraction_count
        / people
        * 100
    )

    # --------------------------------------------------------
    # FATIGUE
    # --------------------------------------------------------

    fatigue = (
        actions["sleeping"]
        / people
        * 100
    )

    return (
        round(attention, 1),
        round(distraction, 1),
        round(fatigue, 1)
    )


# ============================================================
# OVERLAY VIDEO
# ============================================================

def draw_demo_overlay(
    frame,
    actions,
    people,
    attention,
    distraction,
    fatigue,
    model_path
):
    """
    Ajoute les informations SmartClass
    sur la fenetre de demonstration.
    """

    height, width = frame.shape[:2]

    # --------------------------------------------------------
    # BANDEAU HAUT
    # --------------------------------------------------------

    cv2.rectangle(
        frame,
        (0, 0),
        (width, 75),
        (0, 0, 0),
        -1
    )

    cv2.putText(
        frame,
        "WBC SmartClass IA",
        (12, 27),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.75,
        (255, 255, 255),
        2
    )

    cv2.putText(
        frame,
        "Modele V3 : 5 comportements",
        (12, 55),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.55,
        (200, 200, 200),
        1
    )

    # --------------------------------------------------------
    # BANDEAU BAS
    # --------------------------------------------------------

    cv2.rectangle(
        frame,
        (0, height - 125),
        (width, height),
        (0, 0, 0),
        -1
    )

    if people > 0:

        action_text_1 = (
            "Focused="
            + str(actions["focused"])
            + "  Reading="
            + str(actions["reading"])
            + "  Hand="
            + str(actions["hand_raising"])
        )

        cv2.putText(
            frame,
            action_text_1,
            (12, height - 92),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            (255, 255, 255),
            1
        )

        action_text_2 = (
            "Sleeping="
            + str(actions["sleeping"])
            + "  Other="
            + str(actions["other"])
        )

        cv2.putText(
            frame,
            action_text_2,
            (12, height - 67),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            (255, 255, 255),
            1
        )

        score_text = (
            "Attention "
            + str(int(attention))
            + "%  Distraction "
            + str(int(distraction))
            + "%  Fatigue "
            + str(int(fatigue))
            + "%"
        )

        cv2.putText(
            frame,
            score_text,
            (12, height - 38),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.62,
            (255, 255, 255),
            1
        )

        cv2.putText(
            frame,
            "Personnes detectees : "
            + str(people),
            (12, height - 12),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            (200, 200, 200),
            1
        )

    else:

        cv2.putText(
            frame,
            "Aucune personne detectee",
            (12, height - 42),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            (180, 180, 180),
            2
        )

    return frame


# ============================================================
# PROGRAMME PRINCIPAL
# ============================================================

def main():

    # --------------------------------------------------------
    # SESSION
    # --------------------------------------------------------

    try:

        session_id = load_session_id()

    except RuntimeError as error:

        print(
            "ERREUR: "
            + str(error),
            file=sys.stderr
        )

        sys.exit(1)

    # --------------------------------------------------------
    # BACKEND
    # --------------------------------------------------------

    url = (
        API_BASE
        + "/api/smartclass/camera"
    )

    print("")
    print("=" * 60)
    print(" WBC SMARTCLASS IA - V3")
    print("=" * 60)

    print(
        "[camera_real] session = "
        + session_id
    )

    print(
        "[camera_real] backend = "
        + url
    )

    print(
        "[camera_real] modele = "
        + MODEL_PATH
    )

    print(
        "[camera_real] intervalle = "
        + str(INTERVAL_S)
        + " s"
    )

    print(
        "[camera_real] confiance minimum = "
        + str(CONF_THRESHOLD)
    )

    print(
        "[camera_real] preview = "
        + str(SHOW_PREVIEW)
    )

    # --------------------------------------------------------
    # VERIFICATION DU FICHIER MODELE
    # --------------------------------------------------------

    if not os.path.exists(MODEL_PATH):

        print(
            "ERREUR: modele introuvable : "
            + MODEL_PATH,
            file=sys.stderr
        )

        sys.exit(1)

    # --------------------------------------------------------
    # CHARGEMENT YOLO
    # --------------------------------------------------------

    print("")
    print(
        "[camera_real] chargement du modele YOLO V3..."
    )

    try:

        model = YOLO(
            MODEL_PATH
        )

    except Exception as error:

        print(
            "ERREUR chargement modele : "
            + str(error),
            file=sys.stderr
        )

        sys.exit(1)

    print(
        "[camera_real] modele charge."
    )

    print(
        "[camera_real] classes = "
        + str(model.names)
    )

    # --------------------------------------------------------
    # VERIFICATION DES CLASSES V3
    # --------------------------------------------------------

    model_classes = {
        str(name).strip().lower()
        for name in model.names.values()
    }

    expected_classes = {
        "looking_forward",
        "raising_hand",
        "reading",
        "sleeping",
        "turning_around",
    }

    missing_classes = (
        expected_classes
        - model_classes
    )

    if missing_classes:

        print(
            "ATTENTION : classes attendues absentes : "
            + str(missing_classes)
        )

    else:

        print(
            "[camera_real] classes V3 verifiees : OK"
        )

    # --------------------------------------------------------
    # CAMERA
    # --------------------------------------------------------

    print("")
    print(
        "[camera_real] ouverture camera #"
        + str(CAMERA_INDEX)
        + "..."
    )

    if os.name == "nt":

        cap = cv2.VideoCapture(
            CAMERA_INDEX,
            cv2.CAP_DSHOW
        )

    else:

        cap = cv2.VideoCapture(
            CAMERA_INDEX
        )

    if not cap.isOpened():

        print(
            "ERREUR: impossible d'ouvrir la camera #"
            + str(CAMERA_INDEX),
            file=sys.stderr
        )

        sys.exit(1)

    cap.set(
        cv2.CAP_PROP_FRAME_WIDTH,
        1280
    )

    cap.set(
        cv2.CAP_PROP_FRAME_HEIGHT,
        720
    )

    print(
        "[camera_real] camera ouverte."
    )

    if SHOW_PREVIEW:

        print(
            "[camera_real] preview activee."
        )

        print(
            "[camera_real] appuie sur q pour quitter."
        )

    # --------------------------------------------------------
    # BOUCLE PRINCIPALE
    # --------------------------------------------------------

    last_post = 0

    window_name = (
        "WBC SmartClass IA V3 - q pour quitter"
    )

    while not stop:

        success, frame = cap.read()

        if (
            not success
            or frame is None
            or frame.size == 0
        ):

            time.sleep(0.1)
            continue

        # ----------------------------------------------------
        # INFERENCE YOLO V3
        # ----------------------------------------------------

        try:

            results = model(
                frame,
                verbose=False,
                conf=CONF_THRESHOLD
            )

        except Exception as error:

            print(
                "[camera_real] erreur inference : "
                + str(error)
            )

            time.sleep(0.5)

            continue

        # ----------------------------------------------------
        # EXTRACTION DES DETECTIONS
        # ----------------------------------------------------

        boxes = results[0].boxes

        if (
            boxes is not None
            and len(boxes) > 0
        ):

            detections = (
                boxes.data
                .cpu()
                .numpy()
            )

        else:

            detections = []

        # ----------------------------------------------------
        # AGREGATION
        # ----------------------------------------------------

        (
            people,
            actions,
            avg_confidence
        ) = aggregate_detections(
            detections,
            results[0].names
        )

        (
            attention,
            distraction,
            fatigue
        ) = derive_percents(
            actions,
            people
        )

        # ----------------------------------------------------
        # PREVIEW
        # ----------------------------------------------------

        if SHOW_PREVIEW:

            try:

                annotated = (
                    results[0].plot()
                )

                annotated = draw_demo_overlay(
                    annotated,
                    actions,
                    people,
                    attention,
                    distraction,
                    fatigue,
                    MODEL_PATH
                )

                if (
                    annotated is not None
                    and annotated.size > 0
                ):

                    cv2.imshow(
                        window_name,
                        annotated
                    )

            except Exception as error:

                print(
                    "[camera_real] erreur preview : "
                    + str(error)
                )

            if (
                cv2.waitKey(1)
                & 0xFF
                == ord("q")
            ):

                break

        # ----------------------------------------------------
        # INTERVALLE API
        # ----------------------------------------------------

        now = time.time()

        if (
            now - last_post
            < INTERVAL_S
        ):

            continue

        # ----------------------------------------------------
        # PAYLOAD BACKEND
        # ----------------------------------------------------

        payload = {

            "sessionId":
                session_id,

            "timestamp":
                datetime.now(
                    timezone.utc
                ).isoformat(),

            "peopleCount":
                people,

            "actions":
                actions,

            "attentionPct":
                attention,

            "distractionPct":
                distraction,

            "fatiguePct":
                fatigue,

            "avgConfidence":
                avg_confidence,

            "source":
                SOURCE_ID,
        }

        # ----------------------------------------------------
        # ENVOI API
        # ----------------------------------------------------

        try:

            response = requests.post(
                url,
                json=payload,
                headers=headers_api_key(),
                timeout=5
            )

            if response.ok:

                status = "OK"

            else:

                status = (
                    "ERR "
                    + str(response.status_code)
                )

            print(
                "[camera] "
                + "people="
                + str(people)
                + " | focused="
                + str(actions["focused"])
                + " | reading="
                + str(actions["reading"])
                + " | hand="
                + str(actions["hand_raising"])
                + " | sleeping="
                + str(actions["sleeping"])
                + " | other="
                + str(actions["other"])
                + " | attention="
                + str(attention)
                + "%"
                + " | fatigue="
                + str(fatigue)
                + "%"
                + " | conf="
                + str(avg_confidence)
                + " -> "
                + status
            )

            if not response.ok:

                print(
                    "         "
                    + response.text[:300]
                )

        except requests.RequestException as error:

            print(
                "[camera] requete backend echouee : "
                + str(error)
            )

        last_post = now

    # ========================================================
    # ARRET
    # ========================================================

    print("")
    print(
        "[camera_real] arret propre."
    )

    cap.release()

    if SHOW_PREVIEW:

        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()