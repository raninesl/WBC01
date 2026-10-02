"""
evaluate_model.py — Évaluation complète du modèle YOLOv8 SmartClass
=====================================================================
Ce script évalue le modèle entraîné sur le jeu de validation et produit :
  - mAP50, mAP50-95, Précision, Rappel, F1-score par classe
  - Matrice de confusion
  - Temps d'inférence (latence CPU)
  - Rapport JSON complet → evaluation_report.json

Usage :
  python evaluate_model.py                        # modèle par défaut yolov8n.pt
  python evaluate_model.py --model ml_model/best.pt
  python evaluate_model.py --model yolov8n.pt --data dataset/data.yaml

Wessup / Wess Business City — PFE 2026
"""

import argparse
import json
import time
import os
import sys
from datetime import datetime
from pathlib import Path

# ── Vérification des dépendances ─────────────────────────────────────────────
try:
    from ultralytics import YOLO
    import numpy as np
except ImportError:
    print("[ERREUR] Dépendances manquantes. Installez-les avec :")
    print("  pip install ultralytics numpy")
    sys.exit(1)


# ══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ══════════════════════════════════════════════════════════════════════════════
DEFAULT_MODEL    = "yolov8n.pt"
DEFAULT_DATA     = "dataset/data.yaml"
RESULTS_FILE     = "evaluation_report.json"
IMAGE_SIZE       = 640
CONF_THRESHOLD   = 0.45
IOU_THRESHOLD    = 0.50

# Classes SmartClass (ordre doit correspondre au data.yaml)
CLASS_NAMES = {
    0: "focused",
    1: "hand_raising",
    2: "reading",
    3: "writing",
    4: "phone",
    5: "sleeping",
    6: "bow_head",
    7: "lean_over",
    8: "looking_around",
}


# ══════════════════════════════════════════════════════════════════════════════
# MESURE DU TEMPS D'INFÉRENCE
# ══════════════════════════════════════════════════════════════════════════════
def measure_inference_time(model, n_warmup=5, n_runs=50):
    """
    Mesure la latence d'inférence sur une image aléatoire.
    
    - Chauffe le modèle (n_warmup runs ignorés) pour éviter les biais JIT.
    - Mesure sur n_runs itérations et retourne moyenne, min, max.
    
    Returns:
        dict: { mean_ms, min_ms, max_ms, fps }
    """
    import numpy as np

    # Image synthétique 720p (simulant une webcam 1280×720)
    dummy_img = np.random.randint(0, 255, (720, 1280, 3), dtype=np.uint8)

    # Chauffe
    print(f"[INFO] Chauffe du modèle ({n_warmup} runs)...")
    for _ in range(n_warmup):
        model.predict(dummy_img, imgsz=IMAGE_SIZE, conf=CONF_THRESHOLD, verbose=False)

    # Mesure
    print(f"[INFO] Mesure de latence ({n_runs} runs)...")
    latencies = []
    for _ in range(n_runs):
        t0 = time.perf_counter()
        model.predict(dummy_img, imgsz=IMAGE_SIZE, conf=CONF_THRESHOLD, verbose=False)
        latencies.append((time.perf_counter() - t0) * 1000)

    mean_ms = float(np.mean(latencies))
    min_ms  = float(np.min(latencies))
    max_ms  = float(np.max(latencies))

    return {
        "mean_ms":  round(mean_ms, 1),
        "min_ms":   round(min_ms, 1),
        "max_ms":   round(max_ms, 1),
        "fps":      round(1000 / mean_ms, 1),
    }


# ══════════════════════════════════════════════════════════════════════════════
# ÉVALUATION PRINCIPALE
# ══════════════════════════════════════════════════════════════════════════════
def evaluate(model_path: str, data_path: str) -> dict:
    """
    Lance l'évaluation complète du modèle YOLOv8 et retourne les métriques.
    """
    print("\n" + "=" * 65)
    print("  SmartClass AI — Évaluation du Modèle YOLOv8")
    print("  Wessup / Wess Business City — PFE 2026")
    print("=" * 65)
    print(f"  Modèle : {model_path}")
    print(f"  Dataset: {data_path}")
    print("=" * 65 + "\n")

    # Charger le modèle
    print("[INIT] Chargement du modèle...")
    model = YOLO(model_path)

    # ── 1. Métriques de validation ────────────────────────────────────────────
    data_exists = Path(data_path).exists()
    metrics_data = None

    if data_exists:
        print(f"[EVAL] Évaluation sur le dataset de validation ({data_path})...")
        results = model.val(
            data=data_path,
            imgsz=IMAGE_SIZE,
            conf=CONF_THRESHOLD,
            iou=IOU_THRESHOLD,
            verbose=True,
            plots=True,   # Génère confusion matrix, courbes P/R, etc.
        )

        # Extraction des métriques
        try:
            maps    = results.box
            map50   = float(maps.map50)   if hasattr(maps, "map50")   else 0.0
            map5095 = float(maps.map)     if hasattr(maps, "map")     else 0.0
            prec    = float(maps.mp)      if hasattr(maps, "mp")      else 0.0
            recall  = float(maps.mr)      if hasattr(maps, "mr")      else 0.0
            f1      = 2 * prec * recall / (prec + recall + 1e-9)

            # Métriques par classe
            per_class = {}
            if hasattr(maps, "ap_class_index") and maps.ap_class_index is not None:
                for i, cls_idx in enumerate(maps.ap_class_index):
                    cls_name = CLASS_NAMES.get(int(cls_idx), f"class_{cls_idx}")
                    per_class[cls_name] = {
                        "ap50":      round(float(maps.ap50[i])  if hasattr(maps, "ap50")  else 0.0, 4),
                        "precision": round(float(maps.p[i])     if hasattr(maps, "p")     else 0.0, 4),
                        "recall":    round(float(maps.r[i])     if hasattr(maps, "r")     else 0.0, 4),
                    }

            metrics_data = {
                "mAP50":       round(map50   * 100, 2),
                "mAP50_95":    round(map5095 * 100, 2),
                "precision":   round(prec    * 100, 2),
                "recall":      round(recall  * 100, 2),
                "f1_score":    round(f1      * 100, 2),
                "per_class":   per_class,
            }

        except Exception as e:
            print(f"[WARN] Extraction métriques partielle : {e}")
            metrics_data = {"error": str(e)}

    else:
        print(f"[WARN] Dataset non trouvé : {data_path}")
        print("[WARN] Évaluation des métriques ignorée — seule la latence sera mesurée.")
        metrics_data = {
            "mAP50":     None,
            "mAP50_95":  None,
            "precision": None,
            "recall":    None,
            "f1_score":  None,
            "per_class": {},
            "note":      f"Dataset introuvable : {data_path}",
        }

    # ── 2. Temps d'inférence ──────────────────────────────────────────────────
    print("\n[PERF] Mesure du temps d'inférence...")
    inference = measure_inference_time(model)

    # ── 3. Infos modèle ───────────────────────────────────────────────────────
    model_info = {
        "path":        model_path,
        "size_mb":     round(Path(model_path).stat().st_size / 1_048_576, 2) if Path(model_path).exists() else None,
        "imgsz":       IMAGE_SIZE,
        "conf_thresh": CONF_THRESHOLD,
        "iou_thresh":  IOU_THRESHOLD,
    }

    # ── 4. Rapport final ──────────────────────────────────────────────────────
    report = {
        "generated_at":  datetime.now().isoformat(),
        "model":         model_info,
        "dataset":       data_path,
        "metrics":       metrics_data,
        "inference":     inference,
        "device":        "CPU",
        "recommendations": _build_recommendations(metrics_data, inference),
    }

    return report


# ══════════════════════════════════════════════════════════════════════════════
# RECOMMANDATIONS AUTOMATIQUES
# ══════════════════════════════════════════════════════════════════════════════
def _build_recommendations(metrics: dict, inference: dict) -> list:
    """
    Génère des recommandations basées sur les métriques obtenues.
    Utile pour le rapport PFE.
    """
    recs = []

    if metrics.get("mAP50") is not None:
        if metrics["mAP50"] < 60:
            recs.append("⚠ mAP50 < 60% : le modèle nécessite plus de données d'entraînement ou un fine-tuning plus long.")
        elif metrics["mAP50"] < 75:
            recs.append("→ mAP50 entre 60-75% : acceptable pour un prototype. Augmenter le dataset ou les epochs pour dépasser 75%.")
        else:
            recs.append("✓ mAP50 ≥ 75% : performances satisfaisantes pour un déploiement en salle de classe.")

        if metrics.get("per_class"):
            worst = min(metrics["per_class"].items(), key=lambda x: x[1].get("ap50", 1))
            recs.append(f"→ Classe la plus difficile : '{worst[0]}' (AP50={worst[1].get('ap50',0)*100:.1f}%). Augmenter les exemples pour cette classe.")

    if inference["fps"] < 10:
        recs.append("⚠ FPS < 10 sur CPU : envisager l'export ONNX ou un GPU pour le déploiement en production.")
    elif inference["fps"] < 20:
        recs.append("→ FPS entre 10-20 : utilisable en production avec snapshots toutes les 30s (pas de flux continu requis).")
    else:
        recs.append(f"✓ FPS {inference['fps']} : performances temps réel acceptables sur CPU.")

    return recs


# ══════════════════════════════════════════════════════════════════════════════
# AFFICHAGE DU RAPPORT
# ══════════════════════════════════════════════════════════════════════════════
def print_report(report: dict):
    m = report.get("metrics", {})
    i = report.get("inference", {})

    print("\n" + "=" * 65)
    print("  RAPPORT D'ÉVALUATION — SmartClass YOLOv8")
    print("=" * 65)

    # Métriques globales
    print("\n📊 MÉTRIQUES GLOBALES")
    print(f"  mAP50       : {m.get('mAP50', 'N/A')}%")
    print(f"  mAP50-95    : {m.get('mAP50_95', 'N/A')}%")
    print(f"  Précision   : {m.get('precision', 'N/A')}%")
    print(f"  Rappel      : {m.get('recall', 'N/A')}%")
    print(f"  F1-Score    : {m.get('f1_score', 'N/A')}%")

    # Métriques par classe
    if m.get("per_class"):
        print("\n📋 MÉTRIQUES PAR CLASSE")
        print(f"  {'Classe':<20} {'AP50':>8} {'Précision':>10} {'Rappel':>8}")
        print("  " + "-" * 50)
        for cls, vals in sorted(m["per_class"].items()):
            print(
                f"  {cls:<20} "
                f"{vals.get('ap50',0)*100:>7.1f}% "
                f"{vals.get('precision',0)*100:>9.1f}% "
                f"{vals.get('recall',0)*100:>7.1f}%"
            )

    # Performances
    print("\n⚡ PERFORMANCES")
    print(f"  Latence moyenne : {i.get('mean_ms', 'N/A')} ms")
    print(f"  Latence min/max : {i.get('min_ms', 'N/A')} / {i.get('max_ms', 'N/A')} ms")
    print(f"  FPS estimé      : {i.get('fps', 'N/A')} fps")

    # Recommandations
    recs = report.get("recommendations", [])
    if recs:
        print("\n💡 RECOMMANDATIONS")
        for r in recs:
            print(f"  {r}")

    print("\n" + "=" * 65)
    print(f"  Rapport sauvegardé : {RESULTS_FILE}")
    print("=" * 65 + "\n")


# ══════════════════════════════════════════════════════════════════════════════
# ENTRÉE PRINCIPALE
# ══════════════════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Évaluation du modèle YOLOv8 SmartClass"
    )
    parser.add_argument(
        "--model", default=DEFAULT_MODEL,
        help=f"Chemin vers le modèle .pt (défaut: {DEFAULT_MODEL})"
    )
    parser.add_argument(
        "--data", default=DEFAULT_DATA,
        help=f"Chemin vers data.yaml du dataset (défaut: {DEFAULT_DATA})"
    )
    parser.add_argument(
        "--output", default=RESULTS_FILE,
        help=f"Fichier de sortie JSON (défaut: {RESULTS_FILE})"
    )
    args = parser.parse_args()

    # Vérifier que le modèle existe
    if not Path(args.model).exists():
        print(f"[ERREUR] Modèle introuvable : {args.model}")
        print("  Vérifiez le chemin ou entraînez d'abord avec : python train.py")
        sys.exit(1)

    # Lancer l'évaluation
    report = evaluate(args.model, args.data)

    # Afficher
    print_report(report)

    # Sauvegarder JSON
    output_path = args.output
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)

    print(f"[OK] Rapport complet sauvegardé dans : {output_path}")
    print("     → Copiez les métriques dans votre rapport PFE !")
