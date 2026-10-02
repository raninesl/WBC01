from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parent

# Dataset clean actuel
CLEAN = ROOT / "smartclass_v2" / "student_behavior_v2_clean"

# Nouvelles images annotées avec Roboflow
NEW = ROOT / "wbc_finetune_v2"

# Nouveau dataset qui sera créé
OUT = ROOT / "smartclass_v2" / "student_behavior_v2_finetune"

# Ordre EXACT des classes
CLASSES = [
    "Looking_Forward",
    "Raising_Hand",
    "Reading",
    "Sleeping",
    "Turning_Around",
]


def copy_split(source, split, prefix):
    src_images = source / split / "images"
    src_labels = source / split / "labels"

    dst_images = OUT / split / "images"
    dst_labels = OUT / split / "labels"

    if not src_images.exists():
        raise FileNotFoundError(f"Dossier introuvable : {src_images}")

    if not src_labels.exists():
        raise FileNotFoundError(f"Dossier introuvable : {src_labels}")

    images_copied = 0
    labels_copied = 0

    for image in src_images.iterdir():
        if image.is_file():
            new_name = f"{prefix}_{image.name}"
            shutil.copy2(image, dst_images / new_name)
            images_copied += 1

    for label in src_labels.glob("*.txt"):
        new_name = f"{prefix}_{label.name}"
        shutil.copy2(label, dst_labels / new_name)
        labels_copied += 1

    return images_copied, labels_copied


# Recréer le dossier de sortie proprement
if OUT.exists():
    shutil.rmtree(OUT)

for split in ["train", "valid"]:
    (OUT / split / "images").mkdir(parents=True, exist_ok=True)
    (OUT / split / "labels").mkdir(parents=True, exist_ok=True)

print("Fusion du dataset clean + dataset webcam...\n")

for split in ["train", "valid"]:

    clean_images, clean_labels = copy_split(
        CLEAN,
        split,
        "clean"
    )

    webcam_images, webcam_labels = copy_split(
        NEW,
        split,
        "webcam"
    )

    print(f"{split.upper()}")
    print(f"  Clean   : {clean_images} images / {clean_labels} labels")
    print(f"  Webcam  : {webcam_images} images / {webcam_labels} labels")
    print(
        f"  TOTAL   : {clean_images + webcam_images} images / "
        f"{clean_labels + webcam_labels} labels\n"
    )


# Création du data.yaml
yaml_content = f"""path: {OUT.as_posix()}
train: train/images
val: valid/images

names:
  0: Looking_Forward
  1: Raising_Hand
  2: Reading
  3: Sleeping
  4: Turning_Around
"""

(OUT / "data.yaml").write_text(
    yaml_content,
    encoding="utf-8"
)

print("Dataset de fine-tuning créé :")
print(OUT)
print("\ndata.yaml créé.")
print("webcam_test n'a pas été modifié.")