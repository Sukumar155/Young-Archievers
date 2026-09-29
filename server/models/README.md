# YOLO weight files

Drop your trained weights here. `yolo_detect.py` looks for these exact names:

| Slot | Filename |
| --- | --- |
| 🔥 Fire / Smoke | `fire_smoke.pt` |
| 🌊 Flood | `flood.pt` |

Nested layouts also work: `fire and smoke/best.pt` and `flood/best.pt`.

The `.pt` binaries are gitignored (they are large), so this README is tracked to
keep the folder. If you keep your weights on another drive instead, skip this
folder and set `YOLO_MODEL_FIRE_SMOKE` / `YOLO_MODEL_FLOOD` — see
`server/.env.example`.

See `../YOLO_SETUP.md` for the full setup.

## Improving accuracy further

The weights alone can't be pushed past a point — real gains need the **training
dataset**, which is not in this repo. To find out what these models actually score
(you currently have no recorded metrics), restore the dataset and run:

```powershell
python -c "from ultralytics import YOLO; YOLO('server/models/flood.pt').val(data='<dataset>/data.yaml')"
```

That prints precision, recall and mAP50-95. Highest-value next steps:

1. **Split the flood model.** It bundles `Potholes` and `Waste Management` with
   `Flooding`. Those civic classes dilute disaster precision — a flood-only model
   would be tighter and cleaner.
2. **Train longer with augmentation**, and keep a real `val/` split.
3. **Compare a larger architecture** if you have enough data (flood is a 3M-param
   nano model; fire_smoke is 21.8M).
4. **Label edge cases** — night, drone altitude, heavy rain. That's where these
   models will fail first in the field.
