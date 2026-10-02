# smartclass_ai/demo_mode.py
# Mode démonstration SmartClass — simulation sans webcam ni modèle
#
# Usage :
#   python demo_mode.py
#   python demo_mode.py --scenario cours_normal
#   python demo_mode.py --scenario fin_cours
#   python demo_mode.py --scenario exam
#   python demo_mode.py --dry-run          (affiche sans envoyer à l'API)
#
# Scénarios disponibles :
#   cours_normal  → Attention élevée, faible distraction (début de cours)
#   fin_cours     → Attention qui baisse, fatigue qui monte
#   exam          → Très haute attention, distraction quasi nulle
#   libre         → Variations aléatoires réalistes (défaut)
#
# Ce script est conçu pour la soutenance / démo sans matériel.

import argparse
import random
import time
import math
import json
import os
import sys
from datetime import datetime
from pathlib import Path

import requests
from dotenv import load_dotenv

# ─── Configuration ────────────────────────────────────────────────────────────

load_dotenv()

API_URL           = os.getenv("WBC_API_URL",        "http://localhost:4000")
API_KEY           = os.getenv("SMARTCLASS_API_KEY",  "sc_key_change_me_before_deploy")
ROOM_ID           = os.getenv("ROOM_ID",             "classA")
SNAPSHOT_INTERVAL = int(os.getenv("SNAPSHOT_INTERVAL", "30"))

HEADERS = {
    "Content-Type": "application/json",
    "x-api-key":    API_KEY,
}

# ─── Scénarios de simulation ──────────────────────────────────────────────────

SCENARIOS = {
    "cours_normal": {
        "description": "Début de cours — attention élevée",
        "attention_base":    78,
        "distraction_base":  15,
        "fatigue_base":       7,
        "noise":              8,          # amplitude de variation
        "trend": None,
    },
    "fin_cours": {
        "description": "Fin de cours — fatigue croissante",
        "attention_base":    60,
        "distraction_base":  25,
        "fatigue_base":      15,
        "noise":             10,
        "trend": "fatigue_up",            # attention baisse, fatigue monte
    },
    "exam": {
        "description": "Examen — concentration maximale",
        "attention_base":    90,
        "distraction_base":   5,
        "fatigue_base":       5,
        "noise":               5,
        "trend": None,
    },
    "libre": {
        "description": "Variations aléatoires réalistes",
        "attention_base":    65,
        "distraction_base":  22,
        "fatigue_base":      13,
        "noise":             15,
        "trend": "random_walk",
    },
}

# ─── Arguments CLI ────────────────────────────────────────────────────────────

parser = argparse.ArgumentParser(
    description="SmartClass — Mode démonstration (simulation sans webcam)"
)
parser.add_argument(
    "--scenario",
    choices=list(SCENARIOS.keys()),
    default="libre",
    help="Scénario de simulation (défaut: libre)"
)
parser.add_argument(
    "--session",
    type=str,
    default=None,
    help="ID de session SmartClass (optionnel)"
)
parser.add_argument(
    "--interval",
    type=int,
    default=SNAPSHOT_INTERVAL,
    help=f"Intervalle entre snapshots en secondes (défaut: {SNAPSHOT_INTERVAL})"
)
parser.add_argument(
    "--students",
    type=int,
    default=25,
    help="Nombre d'étudiants simulés (défaut: 25)"
)
parser.add_argument(
    "--dry-run",
    action="store_true",
    help="Afficher les données sans les envoyer à l'API"
)
args = parser.parse_args()

# ─── Utilitaires ──────────────────────────────────────────────────────────────

def clamp(value: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, value))


def normalize_triple(a: float, d: float, f: float):
    """S'assure que les trois pourcentages somment à ~100%."""
    total = a + d + f
    if total == 0:
        return 50.0, 30.0, 20.0
    return (a / total * 100, d / total * 100, f / total * 100)


class ScenarioEngine:
    """Génère des valeurs réalistes selon le scénario choisi."""

    def __init__(self, scenario_name: str, n_students: int):
        self.cfg         = SCENARIOS[scenario_name]
        self.n_students  = n_students
        self.step        = 0
        # État courant (random walk)
        self.attention   = float(self.cfg["attention_base"])
        self.distraction = float(self.cfg["distraction_base"])
        self.fatigue     = float(self.cfg["fatigue_base"])

    def next(self) -> dict:
        self.step += 1
        noise = self.cfg["noise"]
        trend = self.cfg["trend"]

        # Bruit gaussien de base
        da = random.gauss(0, noise * 0.4)
        dd = random.gauss(0, noise * 0.3)
        df = random.gauss(0, noise * 0.2)

        # Tendances
        if trend == "fatigue_up":
            # Attention baisse de ~0.5%/snapshot, fatigue monte de ~0.4%
            da -= 0.5
            df += 0.4
        elif trend == "random_walk":
            # Léger retour vers la moyenne (mean-reversion)
            da += (self.cfg["attention_base"]    - self.attention)   * 0.08
            dd += (self.cfg["distraction_base"]  - self.distraction) * 0.08
            df += (self.cfg["fatigue_base"]      - self.fatigue)     * 0.08

        self.attention   = clamp(self.attention   + da, 5, 98)
        self.distraction = clamp(self.distraction + dd, 2, 80)
        self.fatigue     = clamp(self.fatigue     + df, 1, 60)

        att, dis, fat = normalize_triple(self.attention, self.distraction, self.fatigue)

        # Nombre de personnes détectées (±15% autour du total)
        detected = max(1, int(self.n_students * random.uniform(0.85, 1.0)))

        return {
            "attentionPct":    round(att, 1),
            "distractionPct":  round(dis, 1),
            "fatiguePct":      round(fat, 1),
            "detectedCount":   detected,
        }


def send_snapshot(session_id: str, stats: dict, dry_run: bool) -> bool:
    """Envoie (ou simule l'envoi de) un snapshot à l'API."""
    payload = {
        "sessionId":        session_id,
        "roomId":           ROOM_ID,
        "attentionPct":     stats["attentionPct"],
        "distractionPct":   stats["distractionPct"],
        "fatiguePct":       stats["fatiguePct"],
        "handsRaisedCount": 0,
        "detectedCount":    stats["detectedCount"],
    }

    if dry_run:
        print(f"  [DRY-RUN] Payload qui serait envoyé :")
        print(f"  {json.dumps(payload, ensure_ascii=False, indent=4)}")
        return True

    try:
        resp = requests.post(
            f"{API_URL}/api/smartclass/camera",
            json=payload,
            headers=HEADERS,
            timeout=5,
        )
        if resp.status_code == 201:
            return True
        else:
            print(f"  ⚠️  API réponse {resp.status_code} : {resp.text[:120]}")
            return False
    except requests.exceptions.ConnectionError:
        print(f"  ❌ API non joignable ({API_URL})")
        print(f"     → Démarre le backend : node server.js")
        return False
    except Exception as e:
        print(f"  ❌ Erreur envoi : {e}")
        return False


def get_or_create_session(dry_run: bool) -> str:
    if args.session:
        print(f"  ✅ Session fournie : {args.session}")
        return args.session

    if dry_run:
        fake_id = f"demo_{int(time.time())}"
        print(f"  [DRY-RUN] Session simulée : {fake_id}")
        return fake_id

    try:
        resp = requests.get(
            f"{API_URL}/api/smartclass/sessions?roomId={ROOM_ID}&limit=1",
            headers=HEADERS,
            timeout=5,
        )
        if resp.status_code == 200:
            sessions = resp.json().get("sessions", [])
            active = [s for s in sessions if s.get("status") == "active"]
            if active:
                sid = active[0]["_id"]
                print(f"  ✅ Session active trouvée : {sid}")
                return sid
        print(f"  ⚠️  Aucune session active → mode standalone")
        return "standalone"
    except Exception:
        print(f"  ⚠️  API non joignable → mode standalone")
        return "standalone"


def bar(pct: float, width: int = 20) -> str:
    """Barre de progression ASCII."""
    filled = int(pct / 100 * width)
    return "█" * filled + "░" * (width - filled)


def print_snapshot(stats: dict, step: int, sent_ok: bool, elapsed_total: float):
    now    = datetime.now().strftime("%H:%M:%S")
    status = "✅ envoyé" if sent_ok else "❌ non envoyé"
    att    = stats["attentionPct"]
    dis    = stats["distractionPct"]
    fat    = stats["fatiguePct"]

    print(f"\n[{now}]  Snapshot #{step:03d}  —  {status}")
    print(f"  Attention    {bar(att)}  {att:5.1f}%")
    print(f"  Distraction  {bar(dis)}  {dis:5.1f}%")
    print(f"  Fatigue      {bar(fat)}  {fat:5.1f}%")
    print(f"  Étudiants détectés : {stats['detectedCount']}")
    print(f"  Temps écoulé       : {int(elapsed_total//60)}m{int(elapsed_total%60):02d}s")


# ─── Main ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":

    scenario_cfg = SCENARIOS[args.scenario]

    print("=" * 62)
    print("  SmartClass — Mode Démonstration  🎓")
    print("=" * 62)
    print(f"\n  Scénario   : {args.scenario}  ({scenario_cfg['description']})")
    print(f"  Salle      : {ROOM_ID}")
    print(f"  API        : {API_URL}  {'[DRY-RUN — pas d'envoi]' if args.dry_run else ''}")
    print(f"  Étudiants  : {args.students}")
    print(f"  Intervalle : {args.interval}s")
    print(f"\n  {'─'*56}")
    print(f"  Classes simulées :")
    print(f"    lookup + sit → attentionPct   (attention)")
    print(f"    down         → distractionPct (distraction)")
    print(f"    bow          → fatiguePct     (fatigue)")
    print(f"  {'─'*56}\n")

    # Récupérer/simuler session
    print(f"🔍 Recherche session active pour {ROOM_ID}...")
    session_id = get_or_create_session(args.dry_run)

    print(f"\n{'─'*62}")
    print(f"  🎬 Démarrage simulation...  Ctrl+C pour arrêter")
    print(f"{'─'*62}\n")

    engine         = ScenarioEngine(args.scenario, args.students)
    start_time     = time.time()
    total_snapshots = 0
    total_sent      = 0

    try:
        while True:
            # Countdown visuel avant le prochain snapshot
            for remaining in range(args.interval, 0, -1):
                print(
                    f"\r  ⏱  Prochain snapshot dans {remaining:2d}s ...  "
                    f"[snapshot #{total_snapshots + 1:03d}]",
                    end="", flush=True
                )
                time.sleep(1)

            print("\r" + " " * 60 + "\r", end="", flush=True)  # effacer la ligne

            # Générer et envoyer snapshot
            stats    = engine.next()
            sent_ok  = send_snapshot(session_id, stats, args.dry_run)
            elapsed  = time.time() - start_time
            total_snapshots += 1
            if sent_ok:
                total_sent += 1

            print_snapshot(stats, total_snapshots, sent_ok, elapsed)

    except KeyboardInterrupt:
        print(f"\n\n⏹️  Simulation arrêtée (Ctrl+C)")

    finally:
        elapsed = time.time() - start_time
        print(f"\n{'=' * 62}")
        print(f"  Résumé de la simulation")
        print(f"{'=' * 62}")
        print(f"  Scénario          : {args.scenario}")
        print(f"  Session           : {session_id}")
        print(f"  Snapshots générés : {total_snapshots}")
        print(f"  Snapshots envoyés : {total_sent}")
        print(f"  Durée totale      : {int(elapsed//60)}m{int(elapsed%60):02d}s")
        print(f"{'=' * 62}")
