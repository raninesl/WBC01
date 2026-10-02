from pathlib import Path
import random
import re
import shutil
from collections import Counter, defaultdict

SRC = Path("smartclass_v2/student_behavior_v2_raw")
DST = Path("smartclass_v2/student_behavior_v2_clean")

NAMES = [
    "Looking_Forward",
    "Raising_Hand",
    "Reading",
    "Sleeping",
    "Turning_Around",
]

random.seed(42)

# --------------------------------------------------
# 1. Récupérer toutes les images des anciens splits
# --------------------------------------------------

items = []

for old_split in ["train", "valid", "test"]:

    image_dir = SRC / old_split / "images"
    label_dir = SRC / old_split / "labels"

    for image in image_dir.glob("*"):

        # Retire la partie Roboflow :
        # xxx_png.rf.123456.jpg -> xxx_png
        base = image.name.split(".rf.")[0]

        # Retire _frameXXX_png
        sequence = re.sub(
            r"_frame\d+_png$",
            "",
            base
        )

        label = label_dir / f"{image.stem}.txt"

        if not label.exists():
            print("Label manquant :", image)
            continue

        lines = [
            x.strip()
            for x in label.read_text(encoding="utf-8").splitlines()
            if x.strip()
        ]

        if not lines:
            print("Label vide :", image)
            continue

        class_id = int(lines[0].split()[0])

        items.append({
            "image": image,
            "label": label,
            "sequence": sequence,
            "class_id": class_id,
        })


# --------------------------------------------------
# 2. Regrouper les images par séquence
# --------------------------------------------------

groups = defaultdict(list)

for item in items:
    groups[item["sequence"]].append(item)


print("Images totales :", len(items))
print("Séquences uniques :", len(groups))


# --------------------------------------------------
# 3. Séparer les séquences classe par classe
# --------------------------------------------------

groups_by_class = defaultdict(list)

for sequence, group in groups.items():

    classes = [x["class_id"] for x in group]
    dominant_class = Counter(classes).most_common(1)[0][0]

    groups_by_class[dominant_class].append(sequence)


assignments = {}

for class_id, sequences in groups_by_class.items():

    random.shuffle(sequences)

    n = len(sequences)

    n_train = int(n * 0.70)
    n_valid = int(n * 0.15)

    for seq in sequences[:n_train]:
        assignments[seq] = "train"

    for seq in sequences[n_train:n_train + n_valid]:
        assignments[seq] = "valid"

    for seq in sequences[n_train + n_valid:]:
        assignments[seq] = "test"


# --------------------------------------------------
# 4. Recréer le dataset
# --------------------------------------------------

if DST.exists():
    shutil.rmtree(DST)

for split in ["train", "valid", "test"]:

    (DST / split / "images").mkdir(parents=True)
    (DST / split / "labels").mkdir(parents=True)


for item in items:

    split = assignments[item["sequence"]]

    shutil.copy2(
        item["image"],
        DST / split / "images" / item["image"].name
    )

    shutil.copy2(
        item["label"],
        DST / split / "labels" / item["label"].name
    )


# --------------------------------------------------
# 5. Créer data.yaml
# --------------------------------------------------

yaml_content = f"""path: {DST.resolve().as_posix()}

train: train/images
val: valid/images
test: test/images

nc: 5

names:
  0: Looking_Forward
  1: Raising_Hand
  2: Reading
  3: Sleeping
  4: Turning_Around
"""

(DST / "data.yaml").write_text(
    yaml_content,
    encoding="utf-8"
)


# --------------------------------------------------
# 6. Rapport
# --------------------------------------------------

print("\n===== NOUVEAU SPLIT =====")

for split in ["train", "valid", "test"]:

    images = list((DST / split / "images").glob("*"))

    counts = Counter()

    for image in images:

        label = DST / split / "labels" / f"{image.stem}.txt"

        for line in label.read_text().splitlines():

            if line.strip():
                counts[int(line.split()[0])] += 1

    print(f"\n{split}")
    print("images :", len(images))

    for class_id, name in enumerate(NAMES):
        print(f"  {name}: {counts[class_id]}")


# --------------------------------------------------
# 7. Vérification anti-fuite
# --------------------------------------------------

split_sequences = defaultdict(set)

for sequence, split in assignments.items():
    split_sequences[split].add(sequence)

print("\n===== VERIFICATION =====")

print(
    "train / valid :",
    len(split_sequences["train"] & split_sequences["valid"])
)

print(
    "train / test :",
    len(split_sequences["train"] & split_sequences["test"])
)

print(
    "valid / test :",
    len(split_sequences["valid"] & split_sequences["test"])
)

print("\nDataset créé :", DST)