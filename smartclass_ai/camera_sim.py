"""
camera_sim.py — Simulateur Raspberry Pi 5 + YOLOv8 (analyse caméra).

POSTe vers /api/smartclass/camera toutes les ~2s (configurable) avec des
comptages d'actions classe réalistes. Reproduit 4 phases pédagogiques :
  - intro       : 70% focused, peu de distraction
  - cours       : 60% focused, montée fatigue lente
  - quiz        : pic de hand_raising + distraction baisse
  - decrochage  : fatigue + phone + sleeping montent (fin de cours)

Le cycle des phases dure environ 5-7 min chacune et boucle. Tu peux
forcer une phase via FORCE_PHASE=quiz par exemple.

Lance : python camera_sim.py
"""
import os
import sys
import time
import random
import signal
import math
from datetime import datetime, timezone

import requests

from config import API_BASE, headers_api_key, load_session_id

# ---- Paramètres ----
INTERVAL_S    = float(os.getenv("CAMERA_INTERVAL_S", "2"))
PEOPLE_COUNT  = int(os.getenv("CAMERA_PEOPLE", "15"))
SOURCE_ID     = os.getenv("CAMERA_SOURCE", "rpi5-sim-1")
FORCE_PHASE   = os.getenv("FORCE_PHASE", "").strip().lower() or None
PHASE_LEN_S   = float(os.getenv("PHASE_LEN_S", "300"))  # 5 min par phase

# Distribution par phase : pourcentages d'étudiants par action
PHASES = {
    "intro": {
        "focused": 0.65, "reading": 0.10, "writing": 0.05,
        "hand_raising": 0.05, "phone": 0.05, "talking": 0.05,
        "sleeping": 0.00, "other": 0.05,
    },
    "cours": {
        "focused": 0.55, "reading": 0.15, "writing": 0.15,
        "hand_raising": 0.02, "phone": 0.05, "talking": 0.03,
        "sleeping": 0.02, "other": 0.03,
    },
    "quiz": {
        "focused": 0.40, "reading": 0.05, "writing": 0.20,
        "hand_raising": 0.20, "phone": 0.02, "talking": 0.08,
        "sleeping": 0.00, "other": 0.05,
    },
    "decrochage": {
        "focused": 0.25, "reading": 0.05, "writing": 0.05,
        "hand_raising": 0.02, "phone": 0.25, "talking": 0.18,
        "sleeping": 0.12, "other": 0.08,
    },
}
PHASE_ORDER = ["intro", "cours", "quiz", "cours", "decrochage"]

stop = False
def _on_sigint(*_):
    global stop
    stop = True
signal.signal(signal.SIGINT, _on_sigint)


def current_phase(t0: float) -> str:
    """Renvoie la phase pédagogique en cours selon l'horloge de la séance."""
    if FORCE_PHASE and FORCE_PHASE in PHASES:
        return FORCE_PHASE
    elapsed = time.time() - t0
    idx = int(elapsed // PHASE_LEN_S) % len(PHASE_ORDER)
    return PHASE_ORDER[idx]


def sample_actions(phase: str, people: int) -> dict:
    """
    Distribue `people` étudiants sur les classes d'actions selon les ratios
    de la phase, en ajoutant un peu de bruit gaussien pour la réalisme.
    Les comptages sont entiers et somment à exactement `people`.
    """
    ratios = PHASES[phase]
    noisy = {k: max(0.0, v + random.gauss(0, 0.03)) for k, v in ratios.items()}
    total = sum(noisy.values()) or 1.0
    floats = {k: v / total * people for k, v in noisy.items()}

    # Arrondi en gardant la somme = people (Largest Remainder Method)
    ints = {k: int(v) for k, v in floats.items()}
    remainder = people - sum(ints.values())
    # Distribue le reste aux plus grandes fractions
    fracs = sorted(floats.items(), key=lambda kv: kv[1] - int(kv[1]), reverse=True)
    for k, _ in fracs[:remainder]:
        ints[k] += 1

    return ints


def derive_percents(actions: dict, people: int) -> tuple:
    """attention / distraction / fatigue en pourcentage (0..100)."""
    if people <= 0:
        return 0.0, 0.0, 0.0
    attention   = (actions["focused"] + actions["reading"] + actions["writing"]) / people * 100
    distraction = (actions["phone"]   + actions["talking"]) / people * 100
    fatigue     = (actions["sleeping"]) / people * 100
    return round(attention, 1), round(distraction, 1), round(fatigue, 1)


def main():
    try:
        session_id = load_session_id()
    except RuntimeError as e:
        print(f"ERREUR : {e}", file=sys.stderr)
        sys.exit(1)

    url = f"{API_BASE}/api/smartclass/camera"
    print(f"[camera_sim] session={session_id}  interval={INTERVAL_S}s  people={PEOPLE_COUNT}")
    print(f"[camera_sim] POST {url}")
    if FORCE_PHASE:
        print(f"[camera_sim] phase forcée : {FORCE_PHASE}")

    t0 = time.time()
    last_phase = None

    while not stop:
        phase = current_phase(t0)
        if phase != last_phase:
            print(f"\n[camera_sim] >>> phase : {phase}")
            last_phase = phase

        # Petite variation du nombre d'étudiants présents (±2)
        people = max(1, PEOPLE_COUNT + random.choice([-1, 0, 0, 0, 1]))

        actions = sample_actions(phase, people)
        attention, distraction, fatigue = derive_percents(actions, people)

        # Confiance YOLO simulée : élevée mais variable
        confidence = round(random.uniform(0.78, 0.93), 3)

        payload = {
            "sessionId":     session_id,
            "timestamp":     datetime.now(timezone.utc).isoformat(),
            "peopleCount":   people,
            "actions":       actions,
            "attentionPct":  attention,
            "distractionPct": distraction,
            "fatiguePct":    fatigue,
            "avgConfidence": confidence,
            "source":        SOURCE_ID,
        }

        try:
            r = requests.post(url, json=payload, headers=headers_api_key(), timeout=5)
            tag = "OK" if r.ok else f"ERR {r.status_code}"
            print(
                f"[camera] {phase:<10} att={attention:>5.1f}%  "
                f"distr={distraction:>5.1f}%  fat={fatigue:>4.1f}%  "
                f"({people} pers, conf {confidence}) → {tag}"
            )
            if not r.ok:
                print("        ", r.text[:200])
        except requests.RequestException as e:
            print(f"[camera] requête échouée : {e}")

        slept = 0.0
        while slept < INTERVAL_S and not stop:
            time.sleep(min(0.5, INTERVAL_S - slept))
            slept += 0.5

    print("\n[camera_sim] arrêt propre.")


if __name__ == "__main__":
    main()
