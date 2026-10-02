# smartclass_ai/download_dataset.py
# Télécharge et prépare le SCB-Dataset3 pour l'entraînement YOLOv8n
#
# Usage :
#   conda activate smartclass
#   python download_dataset.py
#
# Ce script :
#   1. Télécharge le ZIP depuis GitHub (Whiffe/SCB-dataset)
#   2. Extrait et organise les fichiers en structure YOLO
#   3. Fait un split train (80%) / val (20%)
#   4. Génère dataset.yaml prêt pour train.py
#   5. Affiche un résumé par classe

import os
import sys
import zipfile
import shutil
import random
import urllib.request
from pathlib import Path
from tqdm import tqdm
import yaml

# ─── Configuration ────────────────────────────────────────────────────────────

DATASET_URL = "https://github.com/Whiffe/SCB-dataset/archive/refs/heads/main.zip"
ZIP_PATH    = Path("scb_dataset_raw.zip")
RAW_DIR     = Path("scb_dataset_raw")
DATASET_DIR = Path("dataset")

# Classes du dataset SCB — mapping vers les champs SmartClass
# attentionPct    ← focused + reading + writing
# distractionPct  ← phone + looking_around
# fatiguePct      ← bow_head + lean_over + sleeping
# handsRaisedCount← hand_raising
CLASS_NAMES = [
    "hand_raising",   # 0
    "sleeping",       # 1
    "bow_head",       # 2
    "looking_around", # 3
    "phone",          # 4
    "focused",        # 5 — peut aussi s'appeler "writing" ou "reading" selon version
]

TRAIN_RATIO = 0.8  # 80% train, 20% val
RANDOM_SEED = 42

# ─── Utilitaires ──────────────────────────────────────────────────────────────

class DownloadProgress(tqdm):
    """Barre de progression pour urllib.request."""
    def update_to(self, b=1, bsize=1, tsize=None):
        if tsize is not None:
            self.total = tsize
        self.update(b * bsize - self.n)


def download_zip():
    if ZIP_PATH.exists():
        print(f"✅ ZIP déjà présent : {ZIP_PATH} — téléchargement ignoré.")
        return
    print(f"⬇️  Téléchargement du dataset SCB depuis GitHub...")
    print(f"   URL : {DATASET_URL}")
    with DownloadProgress(unit="B", unit_scale=True, miniters=1, desc="SCB-Dataset") as t:
        urllib.request.urlretrieve(DATASET_URL, ZIP_PATH, reporthook=t.update_to)
    print(f"✅ Téléchargement terminé : {ZIP_PATH}")


def extract_zip():
    if RAW_DIR.exists():
        print(f"✅ Dossier brut déjà extrait : {RAW_DIR} — extraction ignorée.")
        return
    print(f"📦 Extraction du ZIP...")
    with zipfile.ZipFile(ZIP_PATH, "r") as z:
        z.extractall(RAW_DIR)
    print(f"✅ Extraction terminée dans : {RAW_DIR}")


def find_dataset_root():
    """Trouve le dossier racine du dataset dans l'archive extraite."""
    # L'archive GitHub crée un sous-dossier SCB-dataset-main/
    candidates = list(RAW_DIR.rglob("*.yaml")) + list(RAW_DIR.rglob("*.yml"))
    if candidates:
        for c in candidates:
            if "dataset" in c.name.lower() or "data" in c.name.lower():
                return c.parent

    # Fallback : chercher un dossier images/
    img_dirs = [d for d in RAW_DIR.rglob("images") if d.is_dir()]
    if img_dirs:
        return img_dirs[0].parent

    # Dernier recours : premier sous-dossier de RAW_DIR
    subdirs = [d for d in RAW_DIR.iterdir() if d.is_dir()]
    if subdirs:
        return subdirs[0]

    return RAW_DIR


def detect_classes_from_structure(root: Path):
    """
    Détecte automatiquement les classes disponibles dans le dataset.
    Supporte deux structures :
      - Structure par dossiers : images/class_name/*.jpg
      - Structure YOLO standard : images/train/*.jpg + labels/train/*.txt
    """
    # Structure 1 : dossiers par classe
    image_extensions = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
    class_dirs = {}

    images_root = root / "images"
    if images_root.exists():
        for d in sorted(images_root.iterdir()):
            if d.is_dir():
                imgs = [f for f in d.iterdir() if f.suffix.lower() in image_extensions]
                if imgs:
                    class_dirs[d.name] = imgs

    if class_dirs:
        print(f"\n📂 Structure détectée : dossiers par classe")
        return "by_class", class_dirs

    # Structure 2 : YOLO standard (train/val déjà splitté)
    train_images = root / "images" / "train"
    if train_images.exists():
        print(f"\n📂 Structure détectée : YOLO standard (train/val existants)")
        return "yolo_standard", {}

    # Structure 3 : toutes images dans un dossier plat avec labels txt
    all_images = []
    for ext in image_extensions:
        all_images.extend(root.rglob(f"*{ext}"))
    if all_images:
        print(f"\n📂 Structure détectée : images plates ({len(all_images)} fichiers)")
        return "flat", all_images

    return "unknown", {}


def build_yolo_structure_from_classes(class_dirs: dict):
    """Construit la structure YOLO depuis un dataset organisé par dossiers de classes."""
    class_names = sorted(class_dirs.keys())
    class_to_id = {name: idx for idx, name in enumerate(class_names)}

    print(f"\n🏷️  Classes trouvées ({len(class_names)}) :")
    for idx, name in enumerate(class_names):
        count = len(class_dirs[name])
        print(f"   [{idx}] {name:20s} — {count} images")

    # Créer les dossiers YOLO
    for split in ["train", "val"]:
        (DATASET_DIR / "images" / split).mkdir(parents=True, exist_ok=True)
        (DATASET_DIR / "labels" / split).mkdir(parents=True, exist_ok=True)

    random.seed(RANDOM_SEED)
    stats = {"train": 0, "val": 0}

    print(f"\n🔀 Split train/val ({int(TRAIN_RATIO*100)}% / {int((1-TRAIN_RATIO)*100)}%)...")

    for class_name, images in class_dirs.items():
        class_id = class_to_id[class_name]
        random.shuffle(images)
        split_idx = int(len(images) * TRAIN_RATIO)
        splits = {"train": images[:split_idx], "val": images[split_idx:]}

        for split, split_images in splits.items():
            for img_path in split_images:
                # Copier l'image
                dst_img = DATASET_DIR / "images" / split / img_path.name
                shutil.copy2(img_path, dst_img)

                # Créer un label YOLO minimal (bbox pleine image = 0.5 0.5 1.0 1.0)
                # Si des .txt existent déjà, les copier à la place
                src_label = img_path.with_suffix(".txt")
                dst_label = DATASET_DIR / "labels" / split / img_path.with_suffix(".txt").name

                if src_label.exists():
                    shutil.copy2(src_label, dst_label)
                else:
                    # Label par défaut : objet centré, pleine image
                    dst_label.write_text(f"{class_id} 0.5 0.5 1.0 1.0\n")

                stats[split] += 1

    print(f"   ✅ Train : {stats['train']} images")
    print(f"   ✅ Val   : {stats['val']} images")
    return class_names


def build_yolo_structure_flat(all_images: list, root: Path):
    """Construit la structure YOLO depuis un dataset plat avec fichiers labels .txt."""
    # Essayer de déduire les classes depuis les labels
    class_ids = set()
    for img in all_images:
        label = img.with_suffix(".txt")
        if label.exists():
            for line in label.read_text().strip().splitlines():
                parts = line.strip().split()
                if parts:
                    try:
                        class_ids.add(int(parts[0]))
                    except ValueError:
                        pass

    if not class_ids:
        print("⚠️  Aucun label trouvé. Utilisation des noms de classes par défaut.")
        class_names = CLASS_NAMES
    else:
        max_id = max(class_ids)
        class_names = CLASS_NAMES[:max_id + 1] if max_id < len(CLASS_NAMES) else [str(i) for i in range(max_id + 1)]

    for split in ["train", "val"]:
        (DATASET_DIR / "images" / split).mkdir(parents=True, exist_ok=True)
        (DATASET_DIR / "labels" / split).mkdir(parents=True, exist_ok=True)

    random.seed(RANDOM_SEED)
    random.shuffle(all_images)
    split_idx = int(len(all_images) * TRAIN_RATIO)
    splits = {"train": all_images[:split_idx], "val": all_images[split_idx:]}
    stats = {"train": 0, "val": 0}

    print(f"\n🔀 Split train/val ({int(TRAIN_RATIO*100)}% / {int((1-TRAIN_RATIO)*100)}%)...")
    for split, imgs in splits.items():
        for img_path in imgs:
            dst_img = DATASET_DIR / "images" / split / img_path.name
            shutil.copy2(img_path, dst_img)
            label = img_path.with_suffix(".txt")
            if label.exists():
                shutil.copy2(label, DATASET_DIR / "labels" / split / label.name)
            stats[split] += 1

    print(f"   ✅ Train : {stats['train']} images")
    print(f"   ✅ Val   : {stats['val']} images")
    return class_names


def generate_yaml(class_names: list):
    """Génère le fichier dataset.yaml pour YOLOv8."""
    yaml_content = {
        "path": str(DATASET_DIR.resolve()),
        "train": "images/train",
        "val":   "images/val",
        "nc":    len(class_names),
        "names": class_names,
    }

    yaml_path = DATASET_DIR / "dataset.yaml"
    with open(yaml_path, "w", encoding="utf-8") as f:
        yaml.dump(yaml_content, f, default_flow_style=False, allow_unicode=True)

    print(f"\n📄 dataset.yaml généré : {yaml_path}")
    print(f"   Classes : {class_names}")
    return yaml_path


def print_summary(class_names: list):
    """Affiche le mapping classes → champs SmartClass."""
    print("\n" + "═" * 60)
    print("  MAPPING CLASSES → CHAMPS SMARTCLASS")
    print("═" * 60)

    attention_classes    = [c for c in class_names if c in ("focused", "reading", "writing")]
    distraction_classes  = [c for c in class_names if c in ("phone", "looking_around")]
    fatigue_classes      = [c for c in class_names if c in ("bow_head", "lean_over", "sleeping")]
    hands_classes        = [c for c in class_names if c in ("hand_raising",)]

    print(f"  attentionPct    ← {attention_classes or '⚠️  aucune classe attention trouvée'}")
    print(f"  distractionPct  ← {distraction_classes or '⚠️  aucune classe distraction trouvée'}")
    print(f"  fatiguePct      ← {fatigue_classes or '⚠️  aucune classe fatigue trouvée'}")
    print(f"  handsRaisedCount← {hands_classes or '⚠️  aucune classe main levée trouvée'}")
    print("═" * 60)

    unmapped = [c for c in class_names
                if c not in attention_classes + distraction_classes + fatigue_classes + hands_classes]
    if unmapped:
        print(f"\n  ℹ️  Classes non mappées (ignorées lors du calcul) : {unmapped}")

    # Sauvegarder le mapping dans un fichier pour train.py et smartclass_camera.py
    mapping = {
        "class_names":       class_names,
        "attention_classes": attention_classes,
        "distraction_classes": distraction_classes,
        "fatigue_classes":   fatigue_classes,
        "hands_classes":     hands_classes,
    }
    mapping_path = DATASET_DIR / "class_mapping.yaml"
    with open(mapping_path, "w", encoding="utf-8") as f:
        yaml.dump(mapping, f, default_flow_style=False, allow_unicode=True)
    print(f"\n  💾 Mapping sauvegardé : {mapping_path}")


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("  SmartClass — Préparation du dataset SCB")
    print("=" * 60)

    # Étape 1 : Téléchargement
    download_zip()

    # Étape 2 : Extraction
    extract_zip()

    # Étape 3 : Détecter la racine du dataset
    root = find_dataset_root()
    print(f"\n📁 Racine du dataset détectée : {root}")

    # Vérifier si le dataset cible existe déjà
    if DATASET_DIR.exists() and (DATASET_DIR / "dataset.yaml").exists():
        print(f"\n✅ Dataset déjà préparé dans : {DATASET_DIR}")
        answer = input("   Reconstruire quand même ? (o/N) : ").strip().lower()
        if answer != "o":
            print("   Abandon. Utilisez train.py pour lancer l'entraînement.")
            sys.exit(0)
        shutil.rmtree(DATASET_DIR)

    # Étape 4 : Détecter la structure et construire le dataset YOLO
    structure_type, data = detect_classes_from_structure(root)

    if structure_type == "by_class":
        class_names = build_yolo_structure_from_classes(data)
    elif structure_type == "yolo_standard":
        # Dataset déjà en format YOLO — juste copier
        print("   Copie de la structure YOLO existante...")
        shutil.copytree(root, DATASET_DIR, dirs_exist_ok=True)
        # Lire les classes depuis le yaml existant
        existing_yaml = next(root.glob("*.yaml"), None)
        if existing_yaml:
            with open(existing_yaml) as f:
                cfg = yaml.safe_load(f)
            class_names = cfg.get("names", CLASS_NAMES)
        else:
            class_names = CLASS_NAMES
    elif structure_type == "flat":
        class_names = build_yolo_structure_flat(data, root)
    else:
        print("❌ Structure du dataset non reconnue. Vérifiez le contenu de :", root)
        sys.exit(1)

    # Étape 5 : Générer dataset.yaml
    generate_yaml(class_names)

    # Étape 6 : Résumé et mapping SmartClass
    print_summary(class_names)

    print("\n✅ Dataset prêt ! Lance maintenant :")
    print("   python train.py")


if __name__ == "__main__":
    main()
