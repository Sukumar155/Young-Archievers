"""
yolo_detect.py — called by sos-server.mjs via child_process.
Usage: python yolo_detect.py <image_path> <model_type> [output_json_path] [include_context]
  model_type:     fire_smoke | flood | auto
  include_context: 1 (default) also runs the COCO person/car pass; 0 skips it
Output: single JSON line to stdout, and (when a path is given) to that file too.

The result is written to a FILE as well as stdout because Ultralytics likes to
print banner/version/font chatter to stdout, which would otherwise corrupt the
JSON. The bridge prefers the file and only falls back to stdout.

Diagnostics are ALSO written to stderr so the Node bridge can surface a real
error message instead of the useless "Python exited with code 1".

Weight locations (first existing candidate wins), overridable by env var:
  fire_smoke : $YOLO_MODEL_FIRE_SMOKE  then server/models/fire_smoke.pt
  flood      : $YOLO_MODEL_FLOOD       then server/models/flood.pt
  context    : $YOLO_MODEL_CONTEXT      then yolo11n.pt (COCO, auto-download)
  Put a .pt in server/models/ — that keeps the project self-contained.

The response carries a `models` manifest whose `classes` are read off the live
weights at load time. The panel uses it to state honestly which classes it CAN
detect — fire_smoke.pt is {fire, smoke} and flood.pt is {Flooding, Potholes,
Waste Management}, so `tree` and `building` are simply not available from them.
"""
import os
import sys
import json
from pathlib import Path

# Quieten Ultralytics *before* importing it: its settings/analytics banner and
# AMP-check notices go to stdout and would be mistaken for our result.
os.environ.setdefault("YOLO_VERBOSE", "false")
os.environ.setdefault("YOLO_AUTOINSTALL", "false")
os.environ.setdefault("ULTRALYTICS_ANALYTICS", "false")

HERE = Path(__file__).resolve().parent
MODEL_DIR = HERE / "models"

DEFAULT_PATHS = {
    "fire_smoke": [MODEL_DIR / "fire_smoke.pt", MODEL_DIR / "fire and smoke" / "best.pt"],
    "flood":      [MODEL_DIR / "flood.pt",      MODEL_DIR / "flood" / "best.pt"],
}
ENV_VARS = {
    "fire_smoke": "YOLO_MODEL_FIRE_SMOKE",
    "flood":      "YOLO_MODEL_FLOOD",
    "context":    "YOLO_MODEL_CONTEXT",
}

# ── The "context" slot ───────────────────────────────────────────────────────
# fire_smoke.pt only knows {fire, smoke} and flood.pt only knows
# {Flooding, Potholes, Waste Management}. Neither can see a person or a car,
# which is most of what an operator needs in a flood frame. A COCO-pretrained
# detector DOES have person + car (and truck/bus/boat for stranded vehicles), so
# it runs as a third, clearly-separate "context" pass.
#
# It is a CONTEXT pass, not a disaster pass: a person in frame must never
# change `disaster_type`, only add situational awareness boxes.
#
# COCO has no "building" and no "tree" class, so this does NOT close those two
# gaps — see server/models/README.md and the panel's capability manifest.
CONTEXT_DEFAULT = "yolo11n.pt"          # ~6 MB, downloaded once by Ultralytics
CONTEXT_KEEP = {                        # only these COCO classes are reported
    "person", "car", "truck", "bus", "boat", "motorcycle", "bicycle",
}

# Classes that are real detections but are NOT disasters. The flood weights
# bundle two civic classes that fire on ordinary street scenes and dilute the
# disaster verdict. They are reported at their true confidence and flagged
# `non_disaster` so the panel can show or hide them explicitly.
NON_DISASTER = {"potholes", "waste management", "waste", "garbage", "trash"}

OUT_PATH = sys.argv[3] if len(sys.argv) > 3 else None


def _num(key: str, default: float) -> float:
    try:
        return float(os.environ[key])
    except (KeyError, ValueError):
        return default


def _flag(key: str, default: bool) -> bool:
    raw = os.environ.get(key)
    if raw is None:
        return default
    return raw.strip().lower() not in ("0", "false", "no", "off", "")


# ── Inference tuning ─────────────────────────────────────────────────────────
# Tuned for RECALL, not precision: in an emergency-response tool a missed fire
# or flood is far worse than a false alarm an operator can dismiss.
#
# Measured on the sample images (see server/YOLO_SETUP.md):
#                       flood          fire_smoke       time
#   old  conf.25/640    Flooding@68%   3 det (88/80/53)  ~9s
#   new  conf.15/960+TTA Flooding@87%  5 det (89/86/69/40/20)  ~8s
# TTA both raises confidence and surfaces extra fire instances the old
# settings dropped entirely. Set YOLO_AUGMENT=0 to disable it.
CONF   = _num("YOLO_CONF", 0.15)     # was 0.25 — lower = catches more, incl. faint smoke
IMGSZ  = int(_num("YOLO_IMGSZ", 960))  # was 640 — small/distant smoke plumes need this
IOU    = _num("YOLO_IOU", 0.7)      # NMS overlap; 0.7 avoids merging adjacent fires
MAX_DET = int(_num("YOLO_MAX_DET", 300))
AUGMENT = _flag("YOLO_AUGMENT", True)  # test-time augmentation: better recall

# The context (COCO) pass runs at a HIGHER threshold than the disaster models.
# COCO is trained on everyday photography, so at 0.15 it fires on debris, roof
# tiles and reflections and floods the panel with junk. 0.30 keeps real people
# and vehicles while cutting the noise. No TTA here either: it doubles runtime
# for the least critical pass in the pipeline.
CONTEXT_CONF  = _num("YOLO_CONTEXT_CONF", 0.30)
CONTEXT_IMGSZ = int(_num("YOLO_CONTEXT_IMGSZ", 960))


def emit(payload: dict):
    """Write the JSON contract to the output file and to stdout as one line."""
    blob = json.dumps(payload)
    if OUT_PATH:
        try:
            Path(OUT_PATH).write_text(blob, encoding="utf-8")
        except Exception as e:  # never let bookkeeping kill a good prediction
            print(f"[yolo] could not write result file: {e}", file=sys.stderr)
    print(blob)


def fail(message: str, code: int = 1):
    """Emit the JSON contract on stdout AND a human-readable line on stderr."""
    emit({"ok": False, "error": message})
    print(message, file=sys.stderr)
    sys.exit(code)


def resolve_models(model_type: str, include_context: bool):
    """Return {name: path} for the models we can actually load.

    `context` is resolved separately because it is allowed to be absent: it is
    a first-run download, and a machine with no network should still get real
    fire/flood results instead of a hard failure.
    """
    names = list(DEFAULT_PATHS) if model_type == "auto" else [model_type]
    if model_type != "auto" and model_type not in DEFAULT_PATHS:
        fail(f"Unknown model_type '{model_type}' (expected fire_smoke, flood or auto)")

    found, missing = {}, []
    for name in names:
        candidates = []
        env_val = os.environ.get(ENV_VARS[name])
        if env_val:
            candidates.append(Path(env_val))
        candidates.extend(DEFAULT_PATHS[name])

        hit = next((c for c in candidates if c.is_file()), None)
        if hit:
            found[name] = hit
        else:
            missing.append((name, [str(c) for c in candidates]))

    # Disaster models are mandatory — without one of them there is nothing to
    # report and a silent "CLEAR" is a dangerous false negative.
    if not found:
        detail = "; ".join(
            f"{n} not found (looked in: {', '.join(p)})" for n, p in missing
        )
        fail("No YOLO weight files available — " + detail, code=2)
    for name, paths in missing:
        print(f"[yolo] warning: '{name}' weights missing, skipped ({', '.join(paths)})",
              file=sys.stderr)

    if include_context:
        ctx_env = os.environ.get(ENV_VARS["context"])
        found["context"] = Path(ctx_env) if ctx_env else Path(CONTEXT_DEFAULT)
    return found


def run(image_path: str, model_type: str, include_context: bool = True):
    if not Path(image_path).is_file():
        fail(f"Image not found on disk: {image_path}")

    # 1) Dependency check first — this used to fail with a bare
    #    "No module named 'ultralytics'" that the bridge could not report.
    try:
        from ultralytics import YOLO
    except ModuleNotFoundError as e:
        fail(
            f"Missing Python package '{e.name}'. Install the vision deps with: "
            f"\"{sys.executable}\" -m pip install ultralytics"
        )
    except Exception as e:  # broken install / torch DLL problems etc.
        fail(f"Could not import ultralytics: {e}")

    # 2) Resolve weights. Previously a missing .pt was silently `continue`d,
    #    which reported disaster_type "CLEAR" for an image no model ever saw.
    models_to_run = resolve_models(model_type, include_context)

    all_detections = []
    models_ran = []
    manifest = {}
    warnings = []

    for name, path in models_to_run.items():
        is_context = (name == "context")
        try:
            model = YOLO(str(path))
            results = model.predict(
                source=image_path,
                # The context pass uses its own, stricter threshold — see the
                # YOLO_CONTEXT_CONF note above the constants.
                conf=CONTEXT_CONF if is_context else CONF,
                imgsz=CONTEXT_IMGSZ if is_context else IMGSZ,
                iou=IOU,
                max_det=MAX_DET,
                augment=False if is_context else AUGMENT,
                save=False,
                verbose=False,
            )
        except Exception as e:
            # A missing/failed context pass must not lose a good fire or flood
            # result. Report it and carry on with the disaster models.
            if is_context:
                warnings.append(
                    f"context (person/car) pass unavailable: {e}. "
                    f"Fire and flood results below are still valid."
                )
                print(f"[yolo] warning: context pass failed: {e}", file=sys.stderr)
                continue
            fail(f"Inference failed for '{name}' ({path.name}): {e}", code=3)

        models_ran.append(name)
        names_map = model.names if isinstance(model.names, dict) else dict(enumerate(model.names))
        emit_classes = sorted(n for n in names_map.values()
                              if not is_context or str(n).lower() in CONTEXT_KEEP)
        # The manifest is read off the live weights, never hardcoded, so the UI
        # cannot advertise a class the model does not actually have.
        manifest[name] = {
            "role": "context" if is_context else "disaster",
            "classes": [str(n) for n in names_map.values()],
            "reported_classes": emit_classes,
        }

        for result in results:
            h, w = result.orig_shape[0], result.orig_shape[1]
            for box in result.boxes:
                cid   = int(box.cls[0])
                conf  = float(box.conf[0])
                label = str(model.names[cid])
                if is_context and label.lower() not in CONTEXT_KEEP:
                    continue  # drop the ~73 irrelevant COCO classes
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                all_detections.append({
                    "model":      name,
                    "label":      label,
                    "cls_id":     cid,
                    "confidence": round(conf * 100, 1),
                    # `is_context` = came from the COCO pass. `non_disaster` = a
                    # real detection that is not a disaster (Potholes, Waste
                    # Management, and everything from the COCO pass). The two are
                    # separate flags because the flood model's civic classes and
                    # the COCO person/car boxes are different kinds of noise.
                    "is_context":   is_context,
                    "non_disaster": label.lower() in NON_DISASTER or is_context,
                    # normalised bbox for SVG overlay [ymin, xmin, ymax, xmax] 0-100
                    "bbox": [
                        round(y1 / h * 100, 2),
                        round(x1 / w * 100, 2),
                        round(y2 / h * 100, 2),
                        round(x2 / w * 100, 2),
                    ],
                })

    # The disaster verdict is decided by the disaster models ONLY. A person or a
    # car in frame is context, not proof of a disaster, so it must not turn a
    # CLEAR verdict into a positive one.
    disaster_labels = [d["label"].lower() for d in all_detections if not d["model"] == "context"]
    if any(k in l for l in disaster_labels for k in ("fire", "smoke", "flame")):
        disaster_type = "FIRE_SMOKE"
    elif any(k in l for l in disaster_labels for k in ("flood", "water", "inundation")):
        disaster_type = "FLOOD"
    elif any(not d["non_disaster"] for d in all_detections):
        disaster_type = "DETECTED"
    else:
        disaster_type = "CLEAR"

    emit({
        "ok":            True,
        "disaster_type": disaster_type,
        "detections":    all_detections,
        "count":         len(all_detections),
        "models_ran":    models_ran,
        "models":        manifest,
        "warnings":      warnings,
        "settings":      {"conf": CONF, "imgsz": IMGSZ, "iou": IOU, "tta": AUGMENT,
                          "context_conf": CONTEXT_CONF, "context": include_context},
    })


if __name__ == "__main__":
    if len(sys.argv) < 3:
        fail("Usage: yolo_detect.py <image> <model_type> [include_context]")
    try:
        ctx = True
        if len(sys.argv) > 4:
            ctx = sys.argv[4].strip().lower() not in ("0", "false", "no", "off", "")
        run(sys.argv[1], sys.argv[2], ctx)
    except SystemExit:
        raise
    except Exception as e:
        fail(f"{type(e).__name__}: {e}")
