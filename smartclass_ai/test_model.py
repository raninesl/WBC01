from ultralytics import YOLO

model = YOLO("runs/detect/smartclass/weights/best.pt")

results = model.predict(
    source="student_behavior_balanced/valid/images",
    save=True,
    conf=0.25
)

print("Test terminé.")