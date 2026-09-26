"""
yolo_detect.py — called by sos-server.mjs via child_process.
Usage: python yolo_detect.py <image_path> <model_type>
  model_type: fire_smoke | flood | auto
Output: single JSON line to stdout
"""
import sys, json, os
from pathlib import Path

BASE = Path(r"C:\Users\Admin1\Desktop\sugu\Young-Archievers\server")

MODEL_PATHS = {
    "fire_smoke": Path(r"D:\sutharson\yolo\fire and smoke\best.pt"),
    "flood":      Path(r"D:\sutharson\yolo\flood\best.pt"),
}

def run(image_path: str, model_type: str):
    from ultralytics import YOLO

    models_to_run = (
        list(MODEL_PATHS.items())
        if model_type == "auto"
        else [(model_type, MODEL_PATHS[model_type])]
    )

    all_detections = []

    for name, path in models_to_run:
        if not path.exists():
            continue
        model = YOLO(str(path))
        results = model.predict(source=image_path, conf=0.25, save=False, verbose=False)
        for result in results:
            w, h = result.orig_shape[1], result.orig_shape[0]
            for box in result.boxes:
                cid   = int(box.cls[0])
                conf  = float(box.conf[0])
                label = model.names[cid]
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                all_detections.append({
                    "model":      name,
                    "label":      label,
                    "confidence": round(conf * 100, 1),
                    # normalised bbox for SVG overlay [ymin, xmin, ymax, xmax] 0-100
                    "bbox": [
                        round(y1 / h * 100, 2),
                        round(x1 / w * 100, 2),
                        round(y2 / h * 100, 2),
                        round(x2 / w * 100, 2),
                    ],
                })

    labels_lower = [d["label"].lower() for d in all_detections]
    if any(k in l for l in labels_lower for k in ("fire", "smoke", "flame")):
        disaster_type = "FIRE_SMOKE"
    elif any(k in l for l in labels_lower for k in ("flood", "water", "inundation")):
        disaster_type = "FLOOD"
    elif all_detections:
        disaster_type = "DETECTED"
    else:
        disaster_type = "CLEAR"

    print(json.dumps({
        "ok":            True,
        "disaster_type": disaster_type,
        "detections":    all_detections,
        "count":         len(all_detections),
    }))

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "Usage: yolo_detect.py <image> <model_type>"}))
        sys.exit(1)
    try:
        run(sys.argv[1], sys.argv[2])
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1)
