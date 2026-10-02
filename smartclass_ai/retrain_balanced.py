# smartclass_ai/retrain_balanced.py
# Réentraînement YOLOv8 avec correction du déséquilibre de classes

import argparse
import sys
import time
import yaml as _yaml
from pathlib import Path
from ultralytics import YOLO


DATASET_DIR = Path("student behavior.v15i.yolov8")
DATASET_YAML = DATASET_DIR / "data.yaml"

# Nouveau dossier de sortie
RUNS_DIR = Path("runs/detect/smartclass_v2")


if __name__ == "__main__":

    parser = argparse.ArgumentParser(description="Réentraînement YOLOv8 équilibré")

    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--patience", type=int, default=25)

    parser.add_argument(
        "--data",
        type=str,
        default=None,
        help="Chemin vers data.yaml"
    )

    parser.add_argument(
        "--checkpoint",
        type=str,
        default=None,
        help="Chemin vers un modèle déjà entraîné, ex: runs/detect/smartclass/weights/last.pt"
    )

    args = parser.parse_args()

    print("=" * 62)
    print("  SmartClass — Réentraînement YOLOv8 équilibré")
    print("=" * 62)

    # ── Vérifier PyTorch / GPU ───────────────────────────────────────────────
    try:
        import torch

        cuda_ok = torch.cuda.is_available()
        device_str = torch.cuda.get_device_name(0) if cuda_ok else "CPU"

        print(f"\n{'✅' if cuda_ok else '⚠️ '} Device : {'CUDA — ' + device_str if cuda_ok else 'CPU'}")

        if cuda_ok:
            vram_gb = torch.cuda.get_device_properties(0).total_memory / 1e9
            if vram_gb < 4:
                args.batch = 8
                print("   ⚠️ VRAM faible → batch réduit à 8")

    except ImportError:
        print("❌ PyTorch non installé.")
        sys.exit(1)

    # ── Choisir le dataset ───────────────────────────────────────────────────
    if args.data:
        ABS_YAML = Path(args.data).resolve()
        ABS_DIR = ABS_YAML.parent

    else:
        balanced = Path("student_behavior_balanced")
        original = Path("student behavior.v15i.yolov8")

        if (balanced / "data.yaml").exists():
            ABS_DIR = balanced.resolve()
            ABS_YAML = ABS_DIR / "data.yaml"
            print(f"\n✅ Dataset équilibré détecté : {ABS_DIR}")

        else:
            print("\n⚠️ Dataset équilibré non trouvé — utilisation du dataset original")
            print("   Tip : lance d'abord python prepare_dataset.py")

            ABS_DIR = original.resolve()
            ABS_YAML = ABS_DIR / "data.yaml"

            yaml_content = {
                "path": str(ABS_DIR),
                "train": "train/images",
                "val": "valid/images",
                "nc": 4,
                "names": ["bow", "down", "lookup", "sit"],
            }

            with open(ABS_YAML, "w", encoding="utf-8") as f:
                _yaml.dump(
                    yaml_content,
                    f,
                    default_flow_style=False,
                    allow_unicode=True
                )

    # ── Vérifier que le YAML existe ──────────────────────────────────────────
    if not ABS_YAML.exists():
        print(f"❌ Fichier YAML introuvable : {ABS_YAML}")
        sys.exit(1)

    # ── Compter les classes ──────────────────────────────────────────────────
    train_labels_dir = ABS_DIR / "train" / "labels"
    train_labels = list(train_labels_dir.glob("*.txt"))

    class_counts = {0: 0, 1: 0, 2: 0, 3: 0}

    for lf in train_labels:
        for line in lf.read_text(encoding="utf-8").splitlines():
            parts = line.strip().split()
            if parts:
                try:
                    cid = int(parts[0])
                    if cid in class_counts:
                        class_counts[cid] += 1
                except ValueError:
                    pass

    total_ann = sum(class_counts.values()) or 1

    print("\n📊 Distribution des classes (train) :")

    class_names_display = [
        "bow (fatigue)",
        "down (distraction)",
        "lookup (attention)",
        "sit (attention)"
    ]

    for cid, name in enumerate(class_names_display):
        n = class_counts[cid]
        pct = n / total_ann * 100
        bar = "█" * int(pct / 3)
        print(f"   {name:20s} : {n:5d}  ({pct:5.1f}%)  {bar}")

    # ── Définir le modèle de départ ──────────────────────────────────────────
    if args.checkpoint:
        checkpoint_path = Path(args.checkpoint).resolve()

        if not checkpoint_path.exists():
            print(f"\n❌ Checkpoint introuvable : {checkpoint_path}")
            print("💡 Vérifie le chemin du fichier last.pt ou best.pt.")
            sys.exit(1)

        model_start = checkpoint_path
        mode_text = "REPRISE D'ENTRAÎNEMENT"

    else:
        model_start = "yolov8s.pt"
        mode_text = "NOUVEL ENTRAÎNEMENT"

    # ── Résumé avant lancement ───────────────────────────────────────────────
    print(f"\n{'─' * 62}")
    print(f"  Mode : {mode_text}")
    print("  Corrections appliquées :")
    print("    cls = 3.0           → pénalise plus les erreurs de classe")
    print("    mixup = 0.15        → augmentation inter-classes")
    print("    copy_paste = 0.15   → diversifie les positions")
    print(f"    imgsz = {args.imgsz}           → plus de détails sur les postures")
    print(f"    epochs = {args.epochs}, patience = {args.patience}")
    print(f"  Modèle de départ : {model_start}")
    print(f"  Dataset : {ABS_YAML}")
    print(f"  Sortie  : {RUNS_DIR / 'weights' / 'last.pt'}")
    print(f"{'─' * 62}")

    ans = input("\nLancer le réentraînement ? (O/n) : ").strip().lower()

    if ans == "n":
        print("⏹️ Annulé.")
        sys.exit(0)

    print("\n🚀 Démarrage de l'entraînement...\n")
    start_time = time.time()

    try:
        # ── Charger le bon modèle ────────────────────────────────────────────
        if args.checkpoint:
            print(f"✅ Reprise depuis : {checkpoint_path}")
            model = YOLO(str(checkpoint_path))
        else:
            print("🚀 Entraînement depuis yolov8s.pt")
            model = YOLO("yolov8s.pt")

        # IMPORTANT :
        # On ne met PAS resume=True ici.
        # On charge les poids avec YOLO(last.pt), mais on force le bon YAML.
        model.train(
            data=str(ABS_YAML),
            epochs=args.epochs,
            batch=args.batch,
            imgsz=args.imgsz,
            patience=args.patience,

            device=0 if cuda_ok else "cpu",
            workers=0,

            project="runs/detect",
            name="smartclass_v2",
            exist_ok=True,

            optimizer="AdamW",
            lr0=0.0005,
            lrf=0.01,
            momentum=0.937,
            weight_decay=0.0005,

            warmup_epochs=5,
            warmup_momentum=0.8,

            box=7.5,
            cls=3.0,

            hsv_h=0.015,
            hsv_s=0.7,
            hsv_v=0.4,
            degrees=15.0,
            translate=0.2,
            scale=0.5,
            shear=3.0,
            perspective=0.001,

            flipud=0.0,
            fliplr=0.5,

            mosaic=1.0,
            mixup=0.15,
            copy_paste=0.15,

            amp=False,
            verbose=True,

            save=True,
            save_period=1
        )

        elapsed = time.time() - start_time

        print(f"\n{'=' * 62}")
        print(f"  ✅ Terminé en {int(elapsed // 60)}m {int(elapsed % 60)}s")

        # ── Validation finale ────────────────────────────────────────────────
        best_pt = RUNS_DIR / "weights" / "best.pt"

        if best_pt.exists():
            size_mb = best_pt.stat().st_size / 1e6

            print(f"\n📦 Meilleur modèle sauvegardé : {best_pt} ({size_mb:.1f} MB)")
            print("\n🔍 Validation complète...")

            val_model = YOLO(str(best_pt))
            metrics = val_model.val(
                data=str(ABS_YAML),
                workers=0,
                verbose=True
            )

            print("\n📊 Métriques finales :")
            print(f"   mAP50     : {metrics.box.map50:.3f}")
            print(f"   mAP50-95  : {metrics.box.map:.3f}")
            print(f"   Précision : {metrics.box.mp:.3f}")
            print(f"   Rappel    : {metrics.box.mr:.3f}")

            print("\n🚀 Pour utiliser ce modèle :")
            print(f"   python smartclass_camera.py --model {best_pt}")

        else:
            print("\n⚠️ Aucun best.pt trouvé après l'entraînement.")

    except KeyboardInterrupt:
        print("\n⏹️ Entraînement interrompu.")
        print("Pour continuer depuis le dernier modèle sauvegardé :")
        print('python retrain_balanced.py --checkpoint "runs\\detect\\smartclass_v2\\weights\\last.pt"')
        sys.exit(0)

    except Exception as e:
        print(f"\n❌ Erreur : {e}")
        raise