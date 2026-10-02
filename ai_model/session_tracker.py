"""
SmartClass — Session Tracker
============================
Stocke les données de chaque étudiant par action
et calcule les pourcentages d'engagement corrects.

Wessup / Wess Business City — PFE 2026
"""

import csv
import json
import os
from datetime import datetime
from collections import defaultdict, deque


class SessionTracker:
    """
    Suit les actions de chaque étudiant pendant une séance
    et calcule les pourcentages corrects.
    """

    def __init__(self, room_id="salle-101", session_id=None, save_csv=True):
        self.room_id    = room_id
        self.session_id = session_id or datetime.now().strftime("%Y%m%d_%H%M%S")
        self.save_csv   = save_csv
        self.start_time = datetime.now()

        # ── Données par étudiant ──────────────────────────────────────────
        # student_id → { action → nombre de frames }
        self.student_frames: dict = defaultdict(lambda: defaultdict(int))

        # Historique temporel (pour graphes)
        # student_id → liste de { timestamp, label, score }
        self.student_timeline: dict = defaultdict(list)

        # Snapshots globaux toutes les N secondes
        self.global_snapshots: list = []

        # Dossier de sauvegarde
        self.output_dir = os.path.join(
            os.path.dirname(__file__), "sessions"
        )
        os.makedirs(self.output_dir, exist_ok=True)

        print(f"[TRACKER] Session démarrée : {self.session_id} | Salle : {self.room_id}")

    # ─── Enregistrer une frame ────────────────────────────────────────────
    def record_frame(self, student_id: int, label: str, score: float):
        """Appeler à chaque frame pour chaque étudiant détecté"""
        self.student_frames[student_id][label] += 1
        self.student_frames[student_id]["_total"] += 1

        self.student_timeline[student_id].append({
            "timestamp": datetime.now().isoformat(),
            "label":     label,
            "score":     round(score, 1),
        })

    # ─── Calculer les pourcentages d'un étudiant ─────────────────────────
    def get_student_percentages(self, student_id: int) -> dict:
        """
        Retourne les pourcentages corrects pour un étudiant.

        Exemple :
        {
            "student_id": 1,
            "total_frames": 300,
            "attentif_pct": 65.0,
            "distrait_pct": 20.0,
            "fatigué_pct":  10.0,
            "baillement_pct": 5.0,
            "engagement_score": 72.5,
            "verdict": "Modérément engagé"
        }
        """
        frames = self.student_frames[student_id]
        total  = frames.get("_total", 0)

        if total == 0:
            return {"student_id": student_id, "error": "Aucune donnée"}

        actions = [
            "très engagé", "engagé", "engagé mais confus",
            "distrait", "fatigué", "tête posée",
            "téléphone", "main levée", "non visible"
        ]

        result = {"student_id": student_id, "total_frames": total}

        # Pourcentage par action
        for action in actions:
            count = frames.get(action, 0)
            pct   = round(count / total * 100, 1)
            key   = action.replace(" ", "_").replace("é", "e").replace("è", "e")
            result[f"{key}_pct"] = pct

        # ── Score d'engagement global ──
        # Formule pondérée :
        # Attentif (très engagé + engagé) × 1.0
        # Confus × 0.5
        # Distrait × 0.0
        # Fatigué × 0.1
        # Main levée × 1.2 (bonus participation)
        # Téléphone × -0.2 (malus)

        attentif_frames  = frames.get("très engagé", 0) + frames.get("engagé", 0)
        confus_frames    = frames.get("engagé mais confus", 0)
        distrait_frames  = frames.get("distrait", 0)
        fatigue_frames   = frames.get("fatigué", 0) + frames.get("tête posée", 0)
        main_frames      = frames.get("main levée", 0)
        phone_frames     = frames.get("téléphone", 0)
        visible_frames   = total - frames.get("non visible", 0)

        if visible_frames > 0:
            score = (
                attentif_frames * 1.0 +
                confus_frames   * 0.5 +
                main_frames     * 1.2 +
                fatigue_frames  * 0.1 +
                phone_frames    * (-0.2)
            ) / visible_frames * 100
            score = max(0, min(100, round(score, 1)))
        else:
            score = 0

        result["engagement_score"] = score

        # Verdict
        if score >= 80:
            verdict = "Très engagé"
        elif score >= 60:
            verdict = "Modérément engagé"
        elif score >= 40:
            verdict = "Peu engagé"
        elif score >= 20:
            verdict = "Distrait"
        else:
            verdict = "Très distrait / absent"

        result["verdict"] = verdict

        # Pourcentages regroupés
        result["attentif_pct"]  = round(attentif_frames / total * 100, 1)
        result["distrait_pct"]  = round(distrait_frames / total * 100, 1)
        result["fatigue_pct"]   = round(fatigue_frames  / total * 100, 1)
        result["phone_pct"]     = round(phone_frames    / total * 100, 1)
        result["main_pct"]      = round(main_frames     / total * 100, 1)

        return result

    # ─── Rapport complet de la séance ────────────────────────────────────
    def get_session_report(self) -> dict:
        """Rapport final avec tous les étudiants + métriques globales"""
        duration = (datetime.now() - self.start_time).seconds

        students_data = []
        all_scores    = []

        for sid in self.student_frames:
            pct = self.get_student_percentages(sid)
            students_data.append(pct)
            all_scores.append(pct.get("engagement_score", 0))

        # Métriques globales
        if all_scores:
            avg_score     = round(sum(all_scores) / len(all_scores), 1)
            attentif_avg  = round(sum(s.get("attentif_pct", 0) for s in students_data) / len(students_data), 1)
            distrait_avg  = round(sum(s.get("distrait_pct", 0) for s in students_data) / len(students_data), 1)
            fatigue_avg   = round(sum(s.get("fatigue_pct", 0)  for s in students_data) / len(students_data), 1)
        else:
            avg_score = attentif_avg = distrait_avg = fatigue_avg = 0

        # Profil de séance
        if avg_score >= 75:
            profile = "Énergique et participative"
        elif avg_score >= 55:
            profile = "Active et attentive"
        elif avg_score >= 40:
            profile = "Calme mais peu participative"
        elif distrait_avg > 40:
            profile = "Distraite — intervention recommandée"
        elif fatigue_avg > 30:
            profile = "Fatiguée — pause recommandée"
        else:
            profile = "Engagement modéré"

        report = {
            "session_id":       self.session_id,
            "room_id":          self.room_id,
            "start_time":       self.start_time.isoformat(),
            "end_time":         datetime.now().isoformat(),
            "duration_seconds": duration,
            "student_count":    len(students_data),
            # ── Résultat unique : score global classe ──
            "global": {
                "engagement_score": avg_score,
                "attentif_pct":     attentif_avg,
                "distrait_pct":     distrait_avg,
                "fatigue_pct":      fatigue_avg,
                "session_profile":  profile,
            },
            "snapshots": self.global_snapshots[-20:],
        }

        return report

    # ─── Enregistrer un snapshot global (toutes les N secondes) ──────────
    def record_global_snapshot(self, metrics: dict):
        """Sauvegarde un état global de la classe à un instant T"""
        self.global_snapshots.append({
            "timestamp":        datetime.now().isoformat(),
            "engagement_score": metrics.get("engagement_score"),
            "student_count":    metrics.get("student_count"),
            "distracted_pct":   metrics.get("distracted_pct"),
            "fatigued_pct":     metrics.get("fatigued_pct"),
        })

    # ─── Sauvegarder en CSV ───────────────────────────────────────────────
    def save_to_csv(self):
        """Sauvegarde le résultat global de la classe dans un CSV"""
        filename = os.path.join(
            self.output_dir,
            f"session_{self.session_id}.csv"
        )

        report = self.get_session_report()
        g      = report["global"]

        row = {
            "session_id":       self.session_id,
            "room_id":          self.room_id,
            "start_time":       report["start_time"],
            "end_time":         report["end_time"],
            "duration_seconds": report["duration_seconds"],
            "student_count":    report["student_count"],
            "engagement_score": g["engagement_score"],
            "attentif_pct":     g["attentif_pct"],
            "distrait_pct":     g["distrait_pct"],
            "fatigue_pct":      g["fatigue_pct"],
            "session_profile":  g["session_profile"],
        }

        with open(filename, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=row.keys())
            writer.writeheader()
            writer.writerow(row)

        print(f"[TRACKER] CSV sauvegardé → {filename}")
        return filename

    # ─── Sauvegarder le rapport JSON ──────────────────────────────────────
    def save_report(self):
        """Sauvegarde le rapport complet en JSON"""
        report   = self.get_session_report()
        filename = os.path.join(
            self.output_dir,
            f"rapport_{self.session_id}.json"
        )
        with open(filename, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)

        print(f"[TRACKER] Rapport JSON → {filename}")
        return filename

    # ─── Afficher le résumé dans le terminal ─────────────────────────────
    def print_summary(self):
        """Affiche uniquement le résultat global de la classe"""
        report = self.get_session_report()
        g      = report["global"]

        print("\n" + "="*60)
        print(f"  RÉSULTAT SÉANCE — {self.session_id}")
        print(f"  Salle : {self.room_id} | Durée : {report['duration_seconds']}s")
        print(f"  Nombre d'étudiants détectés : {report['student_count']}")
        print("="*60)
        print(f"  🎯 SCORE ENGAGEMENT CLASSE : {g['engagement_score']}%")
        print(f"  📊 Profil de séance        : {g['session_profile']}")
        print("-"*60)
        print(f"  ✅ Attentifs  : {g['attentif_pct']}%")
        print(f"  ⚠️  Distraits  : {g['distrait_pct']}%")
        print(f"  😴 Fatigués   : {g['fatigue_pct']}%")
        print("="*60 + "\n")

    # ─── Fin de séance ────────────────────────────────────────────────────
    def end_session(self):
        """Appeler à la fin pour tout sauvegarder"""
        self.print_summary()
        if self.save_csv:
            self.save_to_csv()
        return self.save_report()
