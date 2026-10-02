# smartclass_ai/train.py
# Entraînement YOLOv8n — SmartClass
#
# Usage :
#   python train.py
#   python train.py --epochs 50 --batch 16
#   python train.py --resume

import argparse
import sys
import time
import yaml as _yaml
from pathlib import Path

# ─── Chemins ──────────────────────────────────────────────────────────────────

DATASET_DIR  = Path("student behavior.v15i.yolov8")
DATASET_YAML = DATASET_DIR / "data.yaml"
RUNS_DIR     = Path("runs/detect/smartclass")

# ─── OBLIGATOIRE sur Windows : tout dans if __name__ == '__main__' ────────────

if __name__ == '__main__':

    # ── Arguments CLI ─────────────────────────────────────────────────────────
    parser = argparse.ArgumentParser(description="Entraînement YOLOv8n — SmartClass")
    parser.add_argument("--epochs",   type=int, default=50)
    parser.add_argument("--batch",    type=int, default=16)
    parser.add_argument("--imgsz",    type=int, default=640)
    parser.add_argument("--patience", type=int, default=15)
    parser.add_argument("--resume",   action="store_true")
    args = parser.parse_args()

    print("=" * 60)
    print("  SmartClass — Entraînement YOLOv8n")
    print("=" * 60)

    # ── Vérifier dataset ──────────────────────────────────────────────────────
    if not DATASET_YAML.exists():
        print(f"\n❌ Dataset introuvable : {DATASET_YAML}")
        sys.exit(1)

    print(f"\n✅ Dataset trouvé : {DATASET_YAML}")
    print(f"   Classe 0 : bow     → fatiguePct")
    print(f"   Classe 1 : down    → distractionPct")
    print(f"   Classe 2 : lookup  → attentionPct")
    print(f"   Classe 3 : sit     → attentionPct")

    # ── Vérifier PyTorch + CUDA ───────────────────────────────────────────────
    try:
        import torch
        cuda_ok    = torch.cuda.is_available()
        device_str = torch.cuda.get_device_name(0) if cuda_ok else "CPU"
        print(f"\n{'✅' if cuda_ok else '⚠️ '} PyTorch {torch.__version__}")
        print(f"   Device : {'CUDA — ' + device_str if cuda_ok else 'CPU'}")

        if cuda_ok:
            vram_gb = torch.cuda.get_device_properties(0).total_memory / 1e9
            print(f"   VRAM   : {vram_gb:.1f} GB")
            if vram_gb < 4:
                args.batch = 8
                print(f"   ⚠️  VRAM faible → batch réduit à 8")
        else:
            ans = input("\n   Pas de GPU CUDA. Continuer sur CPU ? (o/N) : ").strip().lower()
            if ans != "o":
                sys.exit(0)

    except ImportError:
        print("❌ PyTorch non installé.")
        sys.exit(1)

    # ── Vérifier Ultralytics ──────────────────────────────────────────────────
    try:
        from ultralytics import YOLO
        import ultralytics
        print(f"✅ Ultralytics {ultralytics.__version__}")
    except ImportError:
        print("❌ Ultralytics non installé. Lance : pip install ultralytics")
        sys.exit(1)

    # ── Générer data.yaml avec chemins absolus ────────────────────────────────
    ABS_DATASET_DIR  = DATASET_DIR.resolve()
    ABS_DATASET_YAML = ABS_DATASET_DIR / "data.yaml"

    yaml_content = {
        "path":  str(ABS_DATASET_DIR),
        "train": str(ABS_DATASET_DIR / "train" / "images"),
        "val":   str(ABS_DATASET_DIR / "valid" / "images"),
        "nc":    4,
        "names": ["bow", "down", "lookup", "sit"],
    }
    with open(ABS_DATASET_YAML, "w") as f:
        _yaml.dump(yaml_content, f, default_flow_style=False, allow_unicode=True)

    print(f"\n✅ data.yaml avec chemins absolus prêt.")

    # ── Résumé ────────────────────────────────────────────────────────────────
    print(f"\n{'─' * 60}")
    print(f"  Modèle de base : YOLOv8n (nano)")
    print(f"  Époques        : {args.epochs}")
    print(f"  Batch size     : {args.batch}")
    print(f"  Image size     : {args.imgsz}×{args.imgsz}")
    print(f"  Early stopping : {args.patience} époques")
    print(f"  Workers        : 0  (Windows — multiprocessing désactivé)")
    print(f"  Modèle final   : {RUNS_DIR}/weights/best.pt")
    print(f"{'─' * 60}")

    ans = input("\nLancer l'entraînement ? (O/n) : ").strip().lower()
    if ans == "n":
        sys.exit(0)

    print(f"\n🚀 Démarrage...\n")
    start_time = time.time()

    try:
        if args.resume and (RUNS_DIR / "weights" / "last.pt").exists():
            print(f"▶️  Reprise depuis last.pt\n")
            model = YOLO(str(RUNS_DIR / "weights" / "last.pt"))
            results = model.train(resume=True)
        else:
            model = YOLO("yolov8n.pt")
            results = model.train(
                data         = str(ABS_DATASET_YAML),
                epochs       = args.epochs,
                batch        = args.batch,
                imgsz        = args.imgsz,
                patience     = args.patience,
                device       = 0 if cuda_ok else "cpu",
                workers      = 0,        # ← CRITIQUE sur Windows : évite le bug multiprocessing
                project      = "runs/detect",
                name         = "smartclass",
                exist_ok     = True,
                pretrained   = True,
                optimizer    = "AdamW",
                lr0          = 0.001,
                lrf          = 0.01,
                momentum     = 0.937,
                weight_decay = 0.0005,
                warmup_epochs    = 3,
                warmup_momentum  = 0.8,
                box          = 7.5,
                cls          = 1.0,     # augmenté (0.5→1.0) pour mieux traiter lookup sous-représentée
                hsv_h        = 0.015,
                hsv_s        = 0.7,
                hsv_v        = 0.4,
                degrees      = 5.0,
                translate    = 0.1,
                scale        = 0.5,
                flipud       = 0.0,
                fliplr       = 0.5,
                mosaic       = 1.0,
                amp          = False,   # désactive AMP (fixes nan sur GTX 1650)
                verbose      = True,
            )

        elapsed = time.time() - start_time
        print(f"\n{'=' * 60}")
        print(f"  ✅ Terminé en {int(elapsed//60)}m {int(elapsed%60)}s")
        print(f"{'=' * 60}")

        # ── Validation ────────────────────────────────────────────────────────
        best_pt = RUNS_DIR / "weights" / "best.pt"
        if best_pt.exists():
            size_mb = best_pt.stat().st_size / 1e6
            print(f"\n📦 Modèle : {best_pt}  ({size_mb:.1f} MB)")

            print(f"\n🔍 Validation...")
            val_model = YOLO(str(best_pt))
            metrics = val_model.val(
                data    = str(ABS_DATASET_YAML),
                workers = 0,
                verbose = False,
            )

            map50 = metrics.box.map50
            print(f"\n📊 Métriques :")
            print(f"   mAP50     : {map50:.3f}   (objectif > 0.70)")
            print(f"   mAP50-95  : {metrics.box.map:.3f}")
            print(f"   Précision : {metrics.box.mp:.3f}")
            print(f"   Rappel    : {metrics.box.mr:.3f}")

            if map50 >= 0.70:
                print(f"\n   🎉 Excellent ! Modèle prêt pour SmartClass.")
            elif map50 >= 0.50:
                print(f"\n   👍 Bon. Pour améliorer : python train.py --epochs 100")
            else:
                print(f"\n   ⚠️  mAP faible. Essaie : python train.py --epochs 100")

            # Mettre à jour MODEL_PATH dans .env
            env_path = Path(".env")
            if env_path.exists():
                lines = env_path.read_text().splitlines()
                new_lines = [
                    f"MODEL_PATH={best_pt}" if l.startswith("MODEL_PATH=") else l
                    for l in lines
                ]
                env_path.write_text("\n".join(new_lines))
                print(f"\n✅ MODEL_PATH mis à jour dans .env")

            print(f"\n🚀 Lance maintenant : python smartclass_camera.py")

    except KeyboardInterrupt:
        print(f"\n⏹️  Interrompu. Pour reprendre : python train.py --resume")
        sys.exit(0)

    except Exception as e:
        print(f"\n❌ Erreur : {e}")
        print(f"\n   Solutions :")
        print(f"   - Mémoire GPU    → python train.py --batch 8")
        print(f"   - workers error  → déjà à 0, vérifier l'installation")
        raise
