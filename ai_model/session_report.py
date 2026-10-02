"""
session_report.py — Générateur de rapport de séance SmartClass
===============================================================
Ce script lit les données JSON sauvegardées par SessionTracker
et génère un rapport de séance structuré et lisible.

Usage :
  python session_report.py                          # dernière session
  python session_report.py --file sessions/ma_session.json
  python session_report.py --all                    # toutes les sessions

Sortie :
  - Affichage console formaté
  - Fichier rapport_session_<date>.txt exportable

Wessup / Wess Business City — PFE 2026
"""

import json
import os
import sys
import argparse
from datetime import datetime, timezone
from pathlib import Path
from glob import glob


# ══════════════════════════════════════════════════════════════════════════════
# CHARGEMENT DES DONNÉES
# ══════════════════════════════════════════════════════════════════════════════

def load_latest_session(sessions_dir: str = "sessions") -> dict:
    """Charge la session la plus récente dans le dossier sessions/."""
    files = sorted(glob(f"{sessions_dir}/*.json"), key=os.path.getmtime, reverse=True)
    if not files:
        print(f"[ERREUR] Aucun fichier session trouvé dans : {sessions_dir}/")
        sys.exit(1)
    print(f"[INFO] Session chargée : {files[0]}")
    with open(files[0], encoding="utf-8") as f:
        return json.load(f)


def load_session(filepath: str) -> dict:
    """Charge une session depuis un fichier JSON spécifique."""
    if not Path(filepath).exists():
        print(f"[ERREUR] Fichier introuvable : {filepath}")
        sys.exit(1)
    with open(filepath, encoding="utf-8") as f:
        return json.load(f)


# ══════════════════════════════════════════════════════════════════════════════
# CALCUL DES STATISTIQUES
# ══════════════════════════════════════════════════════════════════════════════

def compute_stats(session: dict) -> dict:
    """Calcule les statistiques complètes d'une session."""

    frames    = session.get("frames", [])
    snapshots = session.get("global_snapshots", [])
    metadata  = session.get("metadata", {})

    # ── Scores d'engagement ────────────────────────────────────────────────
    scores = [s.get("engagement_score", 0) for s in snapshots if "engagement_score" in s]
    hybrid_scores = [
        s.get("hybrid", {}).get("fused_score", s.get("engagement_score", 0))
        for s in snapshots
    ]
    yolo_scores = [s.get("hybrid", {}).get("yolo_score", 0) for s in snapshots if s.get("hybrid")]
    mp_scores   = [s.get("hybrid", {}).get("mediapipe_score", 0) for s in snapshots if s.get("hybrid")]

    def safe_avg(lst):
        return round(sum(lst) / len(lst), 1) if lst else 0.0
    def safe_min(lst):
        return round(min(lst), 1) if lst else 0.0
    def safe_max(lst):
        return round(max(lst), 1) if lst else 0.0

    # ── Répartition des labels (comportements) ────────────────────────────
    labels = [f.get("label", "") for f in frames]
    label_counts = {}
    for l in labels:
        label_counts[l] = label_counts.get(l, 0) + 1
    total_frames = len(frames) or 1
    label_pct = {k: round(v / total_frames * 100, 1) for k, v in label_counts.items()}

    # ── Catégories agrégées ────────────────────────────────────────────────
    attentif_pct  = sum(label_pct.get(k, 0) for k in ["tres engage", "engage", "moderement"])
    distrait_pct  = sum(label_pct.get(k, 0) for k in ["distrait", "desengage"])
    fatigue_pct   = sum(label_pct.get(k, 0) for k in ["fatigue", "endormi"])
    phone_pct     = label_pct.get("telephone", 0)
    hand_pct      = label_pct.get("main levee", 0)

    # ── Alertes ────────────────────────────────────────────────────────────
    alerts = session.get("alerts", [])

    # ── Tendance (première vs dernière moitié de session) ─────────────────
    mid = len(hybrid_scores) // 2
    first_half_avg  = safe_avg(hybrid_scores[:mid])  if mid > 0 else 0
    second_half_avg = safe_avg(hybrid_scores[mid:])  if mid > 0 else 0
    trend_diff = round(second_half_avg - first_half_avg, 1)
    if   trend_diff >  5: trend = f"↗ En hausse (+{trend_diff}%)"
    elif trend_diff < -5: trend = f"↘ En baisse ({trend_diff}%)"
    else:                  trend = f"→ Stable ({trend_diff:+.1f}%)"

    # ── Profil de séance ───────────────────────────────────────────────────
    avg_score = safe_avg(hybrid_scores)
    if   avg_score >= 80: profile = "★★★ Très engagée et participative"
    elif avg_score >= 65: profile = "★★☆ Active et attentive"
    elif avg_score >= 50: profile = "★☆☆ Modérément engagée"
    elif distrait_pct > 40: profile = "⚠ Distraite — intervention recommandée"
    elif fatigue_pct  > 30: profile = "😴 Fatiguée — pause conseillée"
    else:                   profile = "⬇ Faiblement engagée"

    # ── Durée ──────────────────────────────────────────────────────────────
    start = metadata.get("start_time") or session.get("start_time")
    end   = metadata.get("end_time")   or session.get("end_time")
    if start and end:
        try:
            t0 = datetime.fromisoformat(start)
            t1 = datetime.fromisoformat(end)
            duration_s = int((t1 - t0).total_seconds())
        except Exception:
            duration_s = len(snapshots) * 5  # estimation : 1 snapshot/5s
    else:
        duration_s = len(snapshots) * 5

    duration_min = duration_s // 60
    duration_sec = duration_s  % 60

    return {
        "metadata":        metadata,
        "room_id":         session.get("room_id", metadata.get("room_id", "N/A")),
        "start_time":      start,
        "end_time":        end,
        "duration_s":      duration_s,
        "duration_str":    f"{duration_min}min {duration_sec}s",
        "n_snapshots":     len(snapshots),
        "n_frames":        total_frames,
        # Scores
        "score_avg":       safe_avg(hybrid_scores),
        "score_min":       safe_min(hybrid_scores),
        "score_max":       safe_max(hybrid_scores),
        "yolo_avg":        safe_avg(yolo_scores),
        "mediapipe_avg":   safe_avg(mp_scores),
        "first_half_avg":  first_half_avg,
        "second_half_avg": second_half_avg,
        # Comportements
        "attentif_pct":   attentif_pct,
        "distrait_pct":   distrait_pct,
        "fatigue_pct":    fatigue_pct,
        "phone_pct":      phone_pct,
        "hand_pct":       hand_pct,
        "label_pct":      label_pct,
        # Synthèse
        "trend":          trend,
        "profile":        profile,
        "alerts":         alerts,
        "n_alerts":       len(alerts),
    }


# ══════════════════════════════════════════════════════════════════════════════
# RECOMMANDATIONS AUTOMATIQUES
# ══════════════════════════════════════════════════════════════════════════════

def build_recommendations(stats: dict) -> list:
    """Génère des recommandations pédagogiques basées sur les statistiques."""
    recs = []
    score = stats["score_avg"]
    trend = stats["trend"]

    if score >= 75:
        recs.append("✅ Excellent niveau d'engagement — continuer sur cette dynamique.")
    elif score >= 55:
        recs.append("✔ Engagement satisfaisant — quelques ajustements peuvent optimiser l'attention.")
    else:
        recs.append("⚠ Engagement insuffisant — revoir le rythme et les activités interactives.")

    if stats["distrait_pct"] > 30:
        recs.append(f"→ {stats['distrait_pct']}% de distraction détectée — intégrer un quiz interactif ou une pause active.")

    if stats["fatigue_pct"] > 25:
        recs.append(f"→ {stats['fatigue_pct']}% de fatigue détectée — prévoir une courte pause de 5 min.")

    if stats["phone_pct"] > 10:
        recs.append(f"→ {stats['phone_pct']}% d'utilisation téléphone — rappeler les règles d'usage en début de cours.")

    if stats["hand_pct"] > 15:
        recs.append(f"✅ {stats['hand_pct']}% de participations levée-de-main — classe très participative.")

    if "baisse" in trend.lower():
        recs.append("→ Tendance baissière en fin de séance — envisager une activité de clôture dynamique.")
    elif "hausse" in trend.lower():
        recs.append("✅ Engagement croissant au cours de la séance — bonne progression pédagogique.")

    if stats["n_alerts"] > 0:
        recs.append(f"⚠ {stats['n_alerts']} alerte(s) déclenchée(s) — analyser les moments de décrochage.")

    return recs


# ══════════════════════════════════════════════════════════════════════════════
# FORMATAGE DU RAPPORT
# ══════════════════════════════════════════════════════════════════════════════

def format_report(stats: dict) -> str:
    """Formate le rapport complet en texte structuré."""
    sep  = "═" * 65
    sep2 = "─" * 65
    lines = []

    lines.append(sep)
    lines.append("  RAPPORT DE SÉANCE — SmartClass AI")
    lines.append("  Wessup / Wess Business City — PFE 2026")
    lines.append(sep)

    # ── En-tête ────────────────────────────────────────────────────────────
    lines.append(f"\n  Salle        : {stats['room_id']}")
    lines.append(f"  Début        : {stats['start_time'] or 'N/A'}")
    lines.append(f"  Fin          : {stats['end_time'] or 'N/A'}")
    lines.append(f"  Durée        : {stats['duration_str']}")
    lines.append(f"  Snapshots    : {stats['n_snapshots']} mesures")

    # ── Score d'engagement ─────────────────────────────────────────────────
    lines.append(f"\n{sep2}")
    lines.append("  SCORE D'ENGAGEMENT (Architecture Hybride)")
    lines.append(sep2)
    lines.append(f"  Score final  (fusionné)  : {stats['score_avg']}%")
    lines.append(f"  └─ YOLO     (couche 1)   : {stats['yolo_avg']}%   [macro comportementale]")
    lines.append(f"  └─ MediaPipe (couche 2)  : {stats['mediapipe_avg']}%   [biométrie fine]")
    lines.append(f"  Minimum / Maximum        : {stats['score_min']}% / {stats['score_max']}%")
    lines.append(f"  1ère moitié de séance    : {stats['first_half_avg']}%")
    lines.append(f"  2ème moitié de séance    : {stats['second_half_avg']}%")
    lines.append(f"  Tendance                 : {stats['trend']}")
    lines.append(f"  Profil de séance         : {stats['profile']}")

    # ── Répartition comportements ──────────────────────────────────────────
    lines.append(f"\n{sep2}")
    lines.append("  COMPORTEMENTS DÉTECTÉS")
    lines.append(sep2)

    def bar(pct, width=30):
        filled = int(pct / 100 * width)
        return f"[{'█' * filled}{'░' * (width - filled)}] {pct:5.1f}%"

    lines.append(f"  Attentifs    {bar(stats['attentif_pct'])}")
    lines.append(f"  Distraits    {bar(stats['distrait_pct'])}")
    lines.append(f"  Fatigués     {bar(stats['fatigue_pct'])}")
    lines.append(f"  Téléphone    {bar(stats['phone_pct'])}")
    lines.append(f"  Mains levées {bar(stats['hand_pct'])}")

    # Détail labels
    if stats["label_pct"]:
        lines.append(f"\n  Détail par label :")
        for label, pct in sorted(stats["label_pct"].items(), key=lambda x: -x[1]):
            lines.append(f"    {label:<20} {pct:5.1f}%")

    # ── Alertes ────────────────────────────────────────────────────────────
    lines.append(f"\n{sep2}")
    lines.append(f"  ALERTES ({stats['n_alerts']} déclenchée(s))")
    lines.append(sep2)
    if stats["alerts"]:
        for a in stats["alerts"]:
            t   = a.get("time", "?")
            msg = a.get("msg", "")
            sc  = a.get("score", "?")
            lines.append(f"  [{t}] Score:{sc}% — {msg}")
    else:
        lines.append("  Aucune alerte — engagement maintenu au-dessus du seuil.")

    # ── Recommandations ────────────────────────────────────────────────────
    recs = build_recommendations(stats)
    lines.append(f"\n{sep2}")
    lines.append("  RECOMMANDATIONS PÉDAGOGIQUES")
    lines.append(sep2)
    for r in recs:
        lines.append(f"  {r}")

    # ── Pied de page ───────────────────────────────────────────────────────
    lines.append(f"\n{sep}")
    lines.append(f"  Généré le : {datetime.now().strftime('%d/%m/%Y à %H:%M:%S')}")
    lines.append(f"  Système   : SmartClass AI v4 — Architecture Hybride YOLOv8 + MediaPipe")
    lines.append(sep)

    return "\n".join(lines)


# ══════════════════════════════════════════════════════════════════════════════
# ENTRÉE PRINCIPALE
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Générateur de rapport de séance SmartClass")
    parser.add_argument("--file",    default=None,      help="Chemin vers un fichier session JSON")
    parser.add_argument("--dir",     default="sessions", help="Dossier sessions (défaut: sessions/)")
    parser.add_argument("--all",     action="store_true", help="Générer un rapport pour toutes les sessions")
    parser.add_argument("--output",  default=None,      help="Fichier de sortie (.txt)")
    args = parser.parse_args()

    sessions_to_process = []

    if args.all:
        files = sorted(glob(f"{args.dir}/*.json"), key=os.path.getmtime, reverse=True)
        if not files:
            print(f"[ERREUR] Aucune session dans : {args.dir}/")
            sys.exit(1)
        sessions_to_process = [(f, load_session(f)) for f in files]
    elif args.file:
        sessions_to_process = [(args.file, load_session(args.file))]
    else:
        f = sorted(glob(f"{args.dir}/*.json"), key=os.path.getmtime, reverse=True)
        if not f:
            print(f"[ERREUR] Aucune session dans : {args.dir}/")
            sys.exit(1)
        sessions_to_process = [(f[0], load_session(f[0]))]

    for filepath, session in sessions_to_process:
        stats  = compute_stats(session)
        report = format_report(stats)

        print(report)

        # Sauvegarde
        ts          = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_file = args.output or f"rapport_session_{ts}.txt"
        with open(output_file, "w", encoding="utf-8") as f_out:
            f_out.write(report)

        print(f"\n[OK] Rapport sauvegardé → {output_file}")
        print("     Copiez les statistiques dans votre rapport PFE !")
