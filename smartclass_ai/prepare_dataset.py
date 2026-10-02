# smartclass_ai/prepare_dataset.py
# Nettoyage et équilibrage du dataset SmartClass
#
# Problème détecté :
#   sit    : 40.7%  ← trop dominant
#   down   : 38.1%  ← trop dominant
#   bow    : 11.9%  ← sous-représenté
#   lookup :  9.3%  ← le plus rare → modèle l'ignore
#
# Stratégie :
#   1. Classer chaque image par sa classe dominante
#   2. Supprimer (undersample) les images dominées sit/down
#   3. Dupliquer (oversample) les images dominées bow/lookup
#   4. Créer un nouveau dataset équilibré dans student_behavior_balanced/
#
# Usage :
#   python prepare_dataset.py
#   python prepare_dataset.py --dry-run   (simule sans copier)

import argparse
import shutil
import random
import yaml
from pathlib import Path
from collections import defaultdict

# ─── Config ───────────────────────────────────────────────────────────────────

DATASET_DIR     = Path("student behavior.v15i.yolov8")
OUTPUT_DIR      = Path("student_behavior_balanced")
CLASS_NAMES     = ["bow", "down", "lookup", "sit"]
SPLITS          = ["train", "valid"]

# Cible : ~25% par classe
# On garde TOUTES les images bow/lookup et on réduit sit/down
TARGET_RATIO    = 0.25   # 25% par classe idéalement

random.seed(42)

# ─── Arguments ────────────────────────────────────────────────────────────────

parser = argparse.ArgumentParser()
parser.add_argument("--dry-run", action="store_true", help="Simuler sans copier")
args = parser.parse_args()

# ─── Fonctions ────────────────────────────────────────────────────────────────

def get_image_path(image_dir: Path, stem: str) -> Path | None:
    for ext in [".jpg", ".jpeg", ".png"]:
        p = image_dir / f"{stem}{ext}"
        if p.exists():
            return p
    return None


def dominant_class(label_file: Path) -> int:
    """Retourne la classe la plus fréquente dans une image."""
    counts = defaultdict(int)
    for line in label_file.read_text().splitlines():
        parts = line.strip().split()
        if parts:
            counts[int(parts[0])] += 1
    return max(counts, key=counts.get) if counts else -1


def class_counts_in_file(label_file: Path) -> dict:
    counts = defaultdict(int)
    for line in label_file.read_text().splitlines():
        parts = line.strip().split()
        if parts:
            counts[int(parts[0])] += 1
    return dict(counts)


def copy_pair(src_label: Path, src_image: Path, dst_label_dir: Path,
              dst_image_dir: Path, suffix: str = ""):
    """Copie une paire image+label vers la destination."""
    stem     = src_label.stem + suffix
    ext      = src_image.suffix
    dst_label_dir.mkdir(parents=True, exist_ok=True)
    dst_image_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src_label, dst_label_dir / f"{stem}.txt")
    shutil.copy2(src_image, dst_image_dir / f"{stem}{ext}")


# ─── Analyse initiale ─────────────────────────────────────────────────────────

print("=" * 62)
print("  Préparation Dataset — Nettoyage & Équilibrage")
print("=" * 62)

# ─── Traitement par split ─────────────────────────────────────────────────────

for split in SPLITS:
    label_dir = DATASET_DIR / split / "labels"
    image_dir = DATASET_DIR / split / "images"
    if not label_dir.exists():
        print(f"\n⚠️  Split '{split}' introuvable, ignoré.")
        continue

    label_files = list(label_dir.glob("*.txt"))

    # ── Grouper les images par classe dominante ────────────────────────────────
    groups = defaultdict(list)   # {classe_id: [(label_path, image_path), ...]}
    skipped = 0

    for lf in label_files:
        img = get_image_path(image_dir, lf.stem)
        if img is None:
            skipped += 1
            continue
        dom = dominant_class(lf)
        if dom == -1:
            skipped += 1
            continue
        groups[dom].append((lf, img))

    # ── Grouper aussi par "contient la classe" (pas seulement dominante) ─────────
    # Pour chaque image, noter toutes les classes présentes (pas juste la dominante)
    contains = defaultdict(list)   # {classe_id: [(lf, img), ...]}
    all_pairs = []
    for lf in label_files:
        img = get_image_path(image_dir, lf.stem)
        if img is None:
            continue
        all_pairs.append((lf, img))
        classes_in_img = set()
        for line in lf.read_text().splitlines():
            parts = line.strip().split()
            if parts:
                classes_in_img.add(int(parts[0]))
        for cid in classes_in_img:
            if cid < 4:
                contains[cid].append((lf, img))

    print(f"\n{'─'*62}")
    print(f"  [{split.upper()}]  {len(label_files)} images  ({skipped} ignorées)")
    print(f"  Images contenant chaque classe :")
    for cid, name in enumerate(CLASS_NAMES):
        dom = len(groups[cid])
        cont = len(contains[cid])
        print(f"    {name:8s} : {dom:4d} dominantes  /  {cont:4d} contiennent la classe")

    is_train = (split == "train")

    # ── Stratégie ─────────────────────────────────────────────────────────────
    # TRAIN :
    #   - Garder TOUTES les images contenant bow ou lookup (classes rares)
    #   - Compléter avec des images sit/down pour atteindre l'équilibre
    #   - Dupliquer bow/lookup si encore insuffisant
    # VALID :
    #   - Minimum 20 images par classe (ou toutes si moins disponibles)
    #   - Priorité aux images contenant les classes rares
    #   - Pas de duplication

    VALID_MIN = 20   # minimum d'images par classe en validation

    selected_set = set()   # stems déjà sélectionnés (pour éviter doublons d'origine)
    selected     = []      # liste finale (peut contenir doublons pour oversample)

    if is_train:
        # 1. Garder toutes les images contenant bow ou lookup
        for cid in [0, 2]:   # bow, lookup
            for pair in contains[cid]:
                stem = pair[0].stem
                if stem not in selected_set:
                    selected_set.add(stem)
                    selected.append(pair)

        n_minority = len(selected)
        # Cible = 4× les images minoritaires (25% chacun idéalement)
        target_total = n_minority * 4
        target_majority = (target_total - n_minority) // 2

        # 2. Ajouter images sit/down jusqu'à la cible
        for cid in [1, 3]:   # down, sit
            pool = [p for p in groups[cid] if p[0].stem not in selected_set]
            n    = min(len(pool), target_majority)
            chosen = random.sample(pool, n)
            for pair in chosen:
                selected_set.add(pair[0].stem)
                selected.append(pair)

        n_after_undersample = len(selected)

        # 3. Oversample bow si encore sous-représenté
        bow_in_sel   = [p for p in selected if dominant_class(p[0]) == 0]
        look_in_sel  = [p for p in selected if dominant_class(p[0]) == 2]
        other_in_sel = [p for p in selected if dominant_class(p[0]) not in [0,2]]

        per_class_target = len(other_in_sel) // 2  # sit et down ont chacun ~target
        for pool, name_c in [(bow_in_sel, "bow"), (look_in_sel, "lookup")]:
            if pool and len(pool) < per_class_target:
                extra = random.choices(pool, k=per_class_target - len(pool))
                selected.extend(extra)

        print(f"\n  Stratégie train :")
        print(f"    Minoritaires (bow+lookup) gardés : {n_minority}")
        print(f"    Cible sit/down chacun            : {target_majority}")
        print(f"    Total après sélection            : {len(selected)}")

    else:
        # VALID : garder un minimum par classe, priorité aux classes rares
        for cid in range(4):
            name = CLASS_NAMES[cid]
            pool = contains[cid]   # images qui contiennent cette classe
            pool_new = [p for p in pool if p[0].stem not in selected_set]

            if not pool_new:
                print(f"    {name:8s} : absent dans valid → ignoré")
                continue

            n = min(len(pool_new), max(VALID_MIN, len(pool_new) // 4))
            chosen = random.sample(pool_new, n)
            for pair in chosen:
                selected_set.add(pair[0].stem)
                selected.append(pair)
            print(f"    {name:8s} : {len(pool):4d} disponibles → {n} gardées")

    print(f"\n  Total sélectionné : {len(selected)} images")

    print(f"\n  Total sélectionné : {len(selected)} images")

    # ── Copier vers le nouveau dataset ────────────────────────────────────────
    dst_label_dir = OUTPUT_DIR / split / "labels"
    dst_image_dir = OUTPUT_DIR / split / "images"

    if args.dry_run:
        print(f"  [DRY-RUN] Copie simulée vers {OUTPUT_DIR / split}")
        continue

    # Nettoyer le dossier de sortie s'il existe déjà
    if (OUTPUT_DIR / split).exists():
        shutil.rmtree(OUTPUT_DIR / split)

    dst_label_dir.mkdir(parents=True, exist_ok=True)
    dst_image_dir.mkdir(parents=True, exist_ok=True)

    # Compteur pour les doublons (éviter les conflits de noms)
    name_counter = defaultdict(int)

    for lf, img in selected:
        stem = lf.stem
        name_counter[stem] += 1
        count = name_counter[stem]
        suffix = f"_dup{count:03d}" if count > 1 else ""

        new_stem = stem + suffix
        shutil.copy2(lf,  dst_label_dir / f"{new_stem}.txt")
        shutil.copy2(img, dst_image_dir / f"{new_stem}{img.suffix}")

    print(f"  ✅ Copié vers {OUTPUT_DIR / split}/")

# ── Copier le split test si présent ───────────────────────────────────────────
test_src = DATASET_DIR / "test"
if test_src.exists() and not args.dry_run:
    test_dst = OUTPUT_DIR / "test"
    if test_dst.exists():
        shutil.rmtree(test_dst)
    shutil.copytree(test_src, test_dst)
    print(f"\n  ✅ Test copié tel quel → {test_dst}/")

# ── Générer data.yaml ─────────────────────────────────────────────────────────
if not args.dry_run:
    abs_out = OUTPUT_DIR.resolve()
    yaml_content = {
        "path":  str(abs_out),
        "train": str(abs_out / "train" / "images"),
        "val":   str(abs_out / "valid" / "images"),
        "nc":    4,
        "names": CLASS_NAMES,
    }
    with open(OUTPUT_DIR / "data.yaml", "w") as f:
        yaml.dump(yaml_content, f, default_flow_style=False, allow_unicode=True)
    print(f"\n  ✅ data.yaml généré → {OUTPUT_DIR}/data.yaml")

# ── Vérification finale ────────────────────────────────────────────────────────
if not args.dry_run:
    print(f"\n{'='*62}")
    print(f"  Vérification dataset équilibré")
    print(f"{'='*62}")
    for split in SPLITS:
        label_dir = OUTPUT_DIR / split / "labels"
        if not label_dir.exists():
            continue
        counts = defaultdict(int)
        for lf in label_dir.glob("*.txt"):
            for line in lf.read_text().splitlines():
                parts = line.strip().split()
                if parts:
                    counts[int(parts[0])] += 1
        total = sum(counts.values())
        n_img = len(list(label_dir.glob("*.txt")))
        print(f"\n  [{split.upper()}]  {n_img} images  |  {total} annotations")
        for cid, name in enumerate(CLASS_NAMES):
            n = counts[cid]
            pct = n / total * 100 if total else 0
            bar = "█" * int(pct / 2.5)
            print(f"    {name:8s} : {n:6d}  ({pct:5.1f}%)  {bar}")
        if total > 0:
            vals = [counts[i] for i in range(4)]
            if min(vals) > 0:
                ratio = max(vals) / min(vals)
                print(f"    Ratio max/min : {ratio:.1f}x  "
                      f"({'✅ équilibré' if ratio < 2.5 else '⚠️  encore déséquilibré'})")

print(f"\n{'='*62}")
if args.dry_run:
    print(f"  [DRY-RUN terminé — aucun fichier créé]")
else:
    print(f"  ✅ Dataset équilibré prêt dans : {OUTPUT_DIR}/")
    print(f"\n  Prochaine étape :")
    print(f"    python retrain_balanced.py --data {OUTPUT_DIR}/data.yaml")
print(f"{'='*62}")
