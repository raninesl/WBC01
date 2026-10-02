"""
╔══════════════════════════════════════════════════════════════════╗
║   SMARTCLASS — COLLECTEUR DE DATASET PERSONNEL                  ║
║   Permet de créer votre propre dataset annoté depuis la caméra  ║
╚══════════════════════════════════════════════════════════════════╝

Usage :
  python collect_dataset.py

Contrôles pendant la collecte :
  [1] → Annoter comme ATTENTIF
  [2] → Annoter comme DISTRAIT
  [3] → Annoter comme FATIGUÉ
  [4] → Annoter comme BÂILLEMENT
  [S] → Sauvegarder le buffer
  [Q] → Quitter
"""

import cv2
import mediapipe as mp
import csv, os, time
from datetime import datetime
from detect_engagement import (
    calc_ear, calc_mar, calc_head_pose,
    LEFT_EYE, RIGHT_EYE, COLORS, landmark_to_xy
)

OUTPUT_FILE = "dataset/custom_dataset.csv"
LABEL_NAMES = {ord('1'): "attentif", ord('2'): "distrait", ord('3'): "fatigue", ord('4'): "baillement"}

def collect():
    os.makedirs("dataset", exist_ok=True)
    write_header = not os.path.exists(OUTPUT_FILE)

    mp_face_mesh = mp.solutions.face_mesh
    face_mesh = mp_face_mesh.FaceMesh(
        max_num_faces=5,
        refine_landmarks=True,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    )

    cap = cv2.VideoCapture(0)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)

    current_label = "attentif"
    buffer = []
    total_saved = 0

    print("[INFO] Collecteur démarré. Touches: [1]=Attentif [2]=Distrait [3]=Fatigué [4]=Bâillement [S]=Sauvegarder [Q]=Quitter")

    with open(OUTPUT_FILE, "a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        if write_header:
            writer.writerow(["timestamp","face_id","ear_left","ear_right","ear_avg","mar","yaw","pitch","label"])

        while True:
            ret, frame = cap.read()
            if not ret: continue
            frame = cv2.flip(frame, 1)
            h, w = frame.shape[:2]
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = face_mesh.process(rgb)

            if results.multi_face_landmarks:
                for fid, face_lm in enumerate(results.multi_face_landmarks):
                    lm = face_lm.landmark
                    ear_l = calc_ear(lm, LEFT_EYE, w, h)
                    ear_r = calc_ear(lm, RIGHT_EYE, w, h)
                    ear   = round((ear_l + ear_r) / 2, 3)
                    mar   = round(calc_mar(lm, w, h), 3)
                    yaw, pitch = calc_head_pose(lm, w, h)
                    ts = datetime.now().isoformat()
                    buffer.append([ts, fid+1, round(ear_l,3), round(ear_r,3), ear, mar, yaw, pitch, current_label])

            # Overlay
            col = COLORS.get(current_label, (200,200,200))
            cv2.putText(frame, f"Label: {current_label.upper()}", (10, 40),
                        cv2.FONT_HERSHEY_SIMPLEX, 1.0, col, 2)
            cv2.putText(frame, f"Buffer: {len(buffer)}  |  Total sauvé: {total_saved}", (10, 80),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (150,150,150), 1)
            cv2.putText(frame, "[1]Attentif [2]Distrait [3]Fatigue [4]Baillement [S]Save [Q]Quit",
                        (10, h-15), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (80,80,80), 1)

            cv2.imshow("Collecteur Dataset SmartClass", frame)

            key = cv2.waitKey(1) & 0xFF
            if key in LABEL_NAMES:
                current_label = LABEL_NAMES[key]
                print(f"[LABEL] → {current_label}")
            elif key == ord('s'):
                writer.writerows(buffer)
                total_saved += len(buffer)
                print(f"[SAVE] {len(buffer)} lignes sauvegardées (total: {total_saved})")
                buffer.clear()
            elif key in (ord('q'), 27):
                if buffer:
                    writer.writerows(buffer)
                    total_saved += len(buffer)
                break

    cap.release()
    face_mesh.close()
    cv2.destroyAllWindows()
    print(f"\n[INFO] Dataset sauvegardé dans '{OUTPUT_FILE}' ({total_saved} lignes)")

if __name__ == "__main__":
    collect()
