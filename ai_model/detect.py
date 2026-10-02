from inference_sdk import InferenceHTTPClient
import supervision as sv
import cv2
import os

images_folder = "smartclass_ai/student_behavior_balanced"

client = InferenceHTTPClient(
    api_url="https://serverless.roboflow.com",
    api_key="OIBlfGr9Hhehr9TahKCL",
)

bounding_box_annotator = sv.BoxAnnotator()
label_annotator = sv.LabelAnnotator()

output_folder = "ai_model/resultats"
os.makedirs(output_folder, exist_ok=True)

for root, dirs, files in os.walk(images_folder):
    for filename in files:
        if filename.lower().endswith((".jpg", ".jpeg", ".png")):

            image_file = os.path.join(root, filename)
            image = cv2.imread(image_file)

            if image is None:
                print("Impossible de lire :", image_file)
                continue

            results = client.infer(image, model_id="taylor-swift-records/3")

            detections = sv.Detections.from_inference(results)

            annotated_image = bounding_box_annotator.annotate(
                scene=image,
                detections=detections
            )

            annotated_image = label_annotator.annotate(
                scene=annotated_image,
                detections=detections
            )

            output_name = "resultat_" + filename
            output_path = os.path.join(output_folder, output_name)

            cv2.imwrite(output_path, annotated_image)

            print("Image traitée :", image_file)
            print("Résultat enregistré :", output_path)