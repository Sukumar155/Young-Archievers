# YOLO disaster detection — setup

The authority dashboard's **Disaster Image Detection** panel (`/api/yolo/detect`)
runs real YOLO inference on your machine. The flow is:

browser → Vite (`localhost:5173`, proxies `/api`) → `server/sos-server.mjs` → `python server/yolo_detect.py` → Ultralytics

## 1. Install the Python dependency

```powershell
python -m pip install ultralytics
```

This pulls in the CPU build of PyTorch (~250 MB) since there is no NVIDIA GPU here.
Verify:

```powershell
python -c "import ultralytics; print(ultralytics.__version__)"
```

If the backend spawns the wrong interpreter, set `YOLO_PYTHON` to the full path
(see `server/.env.example`).

## 2. Add your weight files

Drop your trained weights into `server/models/`:

| Slot | Expected filename |
| --- | --- |
| 🔥 Fire / Smoke | `server/models/fire_smoke.pt` |
| 🌊 Flood | `server/models/flood.pt` |

Keeping them here makes the project self-contained. If you would rather leave them
on another drive, set `YOLO_MODEL_FIRE_SMOKE` / `YOLO_MODEL_FLOOD` instead.

The script checks the dependency **first**, then the weights, so a mistake in
either place now produces a specific message instead of a bare exit code.

## 3. Run it

```powershell
npm run dev:all
```

Then open http://localhost:5173, go to the authority dashboard, drag an image onto
the YOLO panel and press **Run YOLO Detection**.

## Inference tuning (recall-optimised)

`yolo_detect.py` is tuned for **recall, not precision**. In an emergency-response
tool a missed fire is far worse than a false alarm an operator can dismiss, so the
confidence threshold is deliberately low and every detection is shown with its
real confidence — nothing is rounded up or hidden.

| Setting | Default | Was | Why |
| --- | --- | --- | --- |
| `YOLO_CONF` | `0.15` | `0.25` | Lower threshold catches faint smoke and thin floodwater the old setting dropped silently |
| `YOLO_IMGSZ` | `960` | `640` | Small / distant fire sources and smoke plumes need the resolution |
| `YOLO_IOU` | `0.7` | — | Stops NMS merging two adjacent fire zones into one box |
| `YOLO_MAX_DET` | `300` | — | Ceiling for dense disaster scenes |
| `YOLO_AUGMENT` | `1` (on) | off | Test-time augmentation — the single biggest win, see below |

### Measured on the bundled sample images

| Config | flood | fire_smoke | time |
| --- | --- | --- | --- |
| old `conf.25 / 640 / no TTA` | `Flooding` 68% | 3 det — 88 / 80 / 53% | ~9s |
| `conf.15 / 960` no TTA | `Flooding` 26% ⚠️ | 2 det — 86 / 85% | ~3s |
| **`conf.15 / 960 / TTA`** ✅ | **`Flooding` 87%** | **5 det — 89 / 86 / 69 / 40 / 20%** | **~8s** |

Two findings worth keeping:

- **TTA is not just "more boxes" — it raises confidence.** The flood model is
  sensitive to input size: at `imgsz=960` *without* TTA its confidence *collapsed*
  from 68% to 26%. TTA recovers it to 87%. Resolution alone would have made this
  model look far worse than it is.
- **The extra fire instances are real signal.** `fire@69%` and `fire@40%` are
  additional fire sources in the same frame that the old settings missed entirely.

### Known trade-off

At `conf=0.15` the flood model also reports its two non-disaster classes
(`Potholes`, `Waste Management`) — on the bundled sample, `Waste Management`
fires 7 times with a best confidence of 83%, which is *higher* than the actual
`Flooding` box at 55%. An operator reading only the highest number would be
misled, so the panel now buckets these separately under "Other classes bundled
in these weights" instead of mixing them with disaster evidence.

If you want them out entirely, the cleanest fix is upstream: retrain a
flood-only model without the two civic classes, which also tightens flood
precision. See "Improving accuracy further" below.

## What the bundled weights can and cannot detect

Read this before interpreting a result. The classes are not negotiable — a YOLO
model only emits classes it was trained on.

| Slot | Classes in the weights |
| --- | --- |
| `fire_smoke.pt` | `fire`, `smoke` |
| `flood.pt` | `Flooding`, `Potholes`, `Waste Management` |
| `yolo11n.pt` (context) | COCO — of which only `person`, `car`, `truck`, `bus`, `boat`, `motorcycle`, `bicycle` are reported |

So:

| Wanted | Available? |
| --- | --- |
| fire, smoke | yes |
| car, person | yes, via the COCO context pass |
| **tree** | **no** — no loaded model has a `tree` class |
| **building** | **no** — COCO has no `building` class either |
| flood | yes (as `Flooding`) |

The panel renders this as a **Model capability** row with unavailable classes
struck through. It deliberately does not print "trees: 0" — a genuine absence
and a class the model cannot express are different facts, and in an evacuation
tool that distinction matters. `tree` and `building` need a model trained on
them; see "Improving accuracy further" in `server/models/README.md`.

### The three result buckets

`yolo_detect.py` tags every box so the panel can group them, and the split is
not cosmetic — the verdict depends only on the first bucket:

- **Disaster evidence** — `fire` / `smoke` / `Flooding`. These alone decide
  `disaster_type`.
- **Context** — from the COCO pass (`is_context`). A person or car in frame
  must never turn a `CLEAR` verdict positive, so these are excluded from the
  classification.
- **Civic classes** — `Potholes` / `Waste Management`, bundled into `flood.pt`.
  Real detections, not disasters. They are the reason the flood model fires on
  ordinary street scenes.

### Verifying a change

```powershell
npm run smoke:yolo                                   # bundled flood sample
npm run smoke:yolo -- path\to\image.jpg fire_smoke 1 # one slot + context
npm run smoke:yolo -- path\to\image.jpg auto 0       # disaster models only
```

Prints the verdict, each bucket, and the manifest read off the live weights.

## Behaviour notes

- **Missing weights are a hard error, not a silent "CLEAR".** The previous version
  did `if not path.exists(): continue`, so an image no model had ever looked at was
  reported as `disaster_type: "CLEAR"` — a dangerous false negative for a disaster
  system. It now fails with exit code 2 and names the paths it searched.
- **Errors are reported.** `yolo_detect.py` writes its JSON result to stdout and a
  human-readable line to stderr; the bridge reads the JSON first, so you see the
  real cause (missing package, missing weights, inference failure) rather than
  `Python exited with code 1`.
- **Exit codes:** `1` = bad usage / missing package, `2` = no weight files found,
  `3` = inference failed for a model.
- `auto` runs every weight file it finds and merges the detections. If only one
  model is present, `auto` quietly uses that one and logs a warning to stderr.
