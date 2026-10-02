from pathlib import Path
import cv2
import numpy as np

ROOT = Path("smartclass_v2/student_behavior_v2_raw")
OUT = Path("smartclass_v2/duplicate_check")
OUT.mkdir(parents=True, exist_ok=True)


def get_hash(path):
    img = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)

    if img is None:
        return None

    img = cv2.resize(img, (32, 32))
    return (img > img.mean()).flatten()


train_files = list((ROOT / "train" / "images").glob("*"))
test_files = list((ROOT / "test" / "images").glob("*"))

train_hashes = []

print("Calcul des signatures TRAIN...")

for f in train_files:
    h = get_hash(f)
    if h is not None:
        train_hashes.append((f, h))


print("Recherche des images TEST similaires...")

results = []

for test_file in test_files:

    test_hash = get_hash(test_file)

    if test_hash is None:
        continue

    best_file = None
    best_distance = 999999

    for train_file, train_hash in train_hashes:

        distance = np.count_nonzero(test_hash != train_hash)

        if distance < best_distance:
            best_distance = distance
            best_file = train_file

    results.append(
        (best_distance, test_file, best_file)
    )


results.sort(key=lambda x: x[0])

print("\n20 paires les plus similaires :")

for i, (distance, test_file, train_file) in enumerate(results[:20]):

    print(
        f"{i:02d} | distance={distance} | "
        f"TEST={test_file.name} | TRAIN={train_file.name}"
    )

    img_test = cv2.imread(str(test_file))
    img_train = cv2.imread(str(train_file))

    if img_test is None or img_train is None:
        continue

    height = 400

    def resize(img):
        ratio = height / img.shape[0]
        return cv2.resize(
            img,
            (int(img.shape[1] * ratio), height)
        )

    img_train = resize(img_train)
    img_test = resize(img_test)

    combined = np.hstack([img_train, img_test])

    cv2.putText(
        combined,
        f"TRAIN   |   TEST   distance={distance}",
        (10, 30),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.7,
        (255, 255, 255),
        2
    )

    cv2.imwrite(
        str(OUT / f"pair_{i:02d}_distance_{distance}.jpg"),
        combined
    )


print(f"\nImages sauvegardees dans : {OUT}")