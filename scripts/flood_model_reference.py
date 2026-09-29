#!/usr/bin/env python
"""
Generate reference predictions from the NEXORA flood-risk XGBoost model.

Prints a JSON array of {name, features, proba, pred} that
scripts/verify-flood-model.mjs replays through the pure-JS predictor and
compares. Run:  python scripts/flood_model_reference.py
"""
import json
import os
import sys

import numpy as np
import xgboost as xgb

# Default to the in-repo model so a clean clone works. Previously this pointed
# at a hardcoded C:\Users\ADMIN\... path from another machine.
MODEL = os.environ.get("FLOOD_MODEL", "public/models/flood_risk_xgboost.json")

FEATURES = [
    "Temperature_C",
    "Humidity_pct",
    "Pressure_hPa",
    "Rainfall_mm",
    "Water_Level_cm",
    "Latitude",
    "Longitude",
    "Elevation_m",
    "River_Discharge_m3_s",
    "Historical_Floods",
    "Population_Density_per_km2",
]

# A spread of cases: calm, in-domain mid, each single driver pushed to an
# extreme, the all-extreme row, and deliberately out-of-domain coordinates
# (Guwahati) plus out-of-range water depth.
CASES = [
    ("calm", dict(Temperature_C=27, Humidity_pct=60, Pressure_hPa=1013, Rainfall_mm=2,
                  Water_Level_cm=20, Latitude=11.4, Longitude=79.8, Elevation_m=60,
                  River_Discharge_m3_s=800, Historical_Floods=0,
                  Population_Density_per_km2=900)),
    ("mid_in_domain", dict(Temperature_C=29, Humidity_pct=80, Pressure_hPa=1000,
                           Rainfall_mm=45, Water_Level_cm=70, Latitude=9.98,
                           Longitude=76.6, Elevation_m=15, River_Discharge_m3_s=3000,
                           Historical_Floods=2, Population_Density_per_km2=3000)),
    ("all_extreme", dict(Temperature_C=33, Humidity_pct=97, Pressure_hPa=985,
                         Rainfall_mm=190, Water_Level_cm=240, Latitude=11.4,
                         Longitude=79.8, Elevation_m=8, River_Discharge_m3_s=14000,
                         Historical_Floods=7, Population_Density_per_km2=9000)),
    ("only_water_high", dict(Temperature_C=27, Humidity_pct=60, Pressure_hPa=1013,
                             Rainfall_mm=2, Water_Level_cm=260, Latitude=11.4,
                             Longitude=79.8, Elevation_m=60,
                             River_Discharge_m3_s=800, Historical_Floods=0,
                             Population_Density_per_km2=900)),
    ("only_rain_high", dict(Temperature_C=27, Humidity_pct=60, Pressure_hPa=1013,
                            Rainfall_mm=220, Water_Level_cm=20, Latitude=11.4,
                            Longitude=79.8, Elevation_m=60,
                            River_Discharge_m3_s=800, Historical_Floods=0,
                            Population_Density_per_km2=900)),
    ("only_pressure_low", dict(Temperature_C=27, Humidity_pct=60, Pressure_hPa=980,
                               Rainfall_mm=2, Water_Level_cm=20, Latitude=11.4,
                               Longitude=79.8, Elevation_m=60,
                               River_Discharge_m3_s=800, Historical_Floods=0,
                               Population_Density_per_km2=900)),
    ("only_humidity_high", dict(Temperature_C=27, Humidity_pct=99, Pressure_hPa=1013,
                                Rainfall_mm=2, Water_Level_cm=20, Latitude=11.4,
                                Longitude=79.8, Elevation_m=60,
                                River_Discharge_m3_s=800, Historical_Floods=0,
                                Population_Density_per_km2=900)),
    ("guwahati_out_of_domain", dict(Temperature_C=29, Humidity_pct=88,
                                    Pressure_hPa=997, Rainfall_mm=68,
                                    Water_Level_cm=82, Latitude=26.178,
                                    Longitude=91.702, Elevation_m=50,
                                    River_Discharge_m3_s=1200, Historical_Floods=4,
                                    Population_Density_per_km2=1800)),
    ("patna_out_of_domain", dict(Temperature_C=30, Humidity_pct=85,
                                 Pressure_hPa=1000, Rainfall_mm=90,
                                 Water_Level_cm=110, Latitude=25.594,
                                 Longitude=85.137, Elevation_m=52,
                                 River_Discharge_m3_s=5000, Historical_Floods=5,
                                 Population_Density_per_km2=4000)),
    ("water_above_train_max", dict(Temperature_C=28, Humidity_pct=90,
                                   Pressure_hPa=995, Rainfall_mm=120,
                                   Water_Level_cm=142, Latitude=11.4,
                                   Longitude=79.8, Elevation_m=10,
                                   River_Discharge_m3_s=9000, Historical_Floods=3,
                                   Population_Density_per_km2=5000)),
    ("below_all_thresholds", dict(Temperature_C=18, Humidity_pct=47,
                                  Pressure_hPa=1025, Rainfall_mm=5,
                                  Water_Level_cm=16, Latitude=8.3,
                                  Longitude=80.2, Elevation_m=338,
                                  River_Discharge_m3_s=34, Historical_Floods=1,
                                  Population_Density_per_km2=243)),
    ("random_1", dict(Temperature_C=31.4, Humidity_pct=73.2, Pressure_hPa=1008.6,
                      Rainfall_mm=17.9, Water_Level_cm=38.4, Latitude=10.85,
                      Longitude=78.9, Elevation_m=94.2, River_Discharge_m3_s=2210,
                      Historical_Floods=2, Population_Density_per_km2=7200)),
    ("random_2", dict(Temperature_C=22.7, Humidity_pct=98.1, Pressure_hPa=991.3,
                      Rainfall_mm=143.6, Water_Level_cm=119.7, Latitude=12.97,
                      Longitude=77.59, Elevation_m=6.3, River_Discharge_m3_s=9877,
                      Historical_Floods=6, Population_Density_per_km2=14200)),
    ("random_3", dict(Temperature_C=35.8, Humidity_pct=51.4, Pressure_hPa=1019.8,
                      Rainfall_mm=8.2, Water_Level_cm=92.1, Latitude=9.31,
                      Longitude=76.94, Elevation_m=211.5, River_Discharge_m3_s=451,
                      Historical_Floods=0, Population_Density_per_km2=1100)),
]


def main() -> int:
    if not os.path.exists(MODEL):
        print(f"model not found: {MODEL}", file=sys.stderr)
        return 1

    booster = xgb.Booster()
    booster.load_model(MODEL)

    # Fail loudly if the dump's feature order ever drifts from ours.
    dumped = booster.feature_names
    if dumped and dumped != FEATURES:
        print("FEATURE ORDER MISMATCH", file=sys.stderr)
        print(f"  model: {dumped}", file=sys.stderr)
        print(f"  ours : {FEATURES}", file=sys.stderr)
        return 2

    out = []
    for name, row in CASES:
        x = np.array([[row[f] for f in FEATURES]], dtype=np.float32)
        dmat = xgb.DMatrix(x, feature_names=FEATURES)
        # ravel() normalizes (1,3) vs (3,) across xgboost versions.
        # NB: a multi:softmax booster's predict() returns the class INDEX, not
        # probabilities -- so take the margins and softmax them explicitly.
        margin = np.asarray(booster.predict(dmat, output_margin=True)).ravel()
        proba = softmax(margin)
        cls = int(np.argmax(margin))
        out.append(
            {
                "name": name,
                "features": row,
                "proba": [float(v) for v in proba],
                "margin": [float(v) for v in margin],
                "class": cls,
            }
        )

    # Write UTF-8 explicitly; a shell redirect on Windows would emit UTF-16.
    dest = sys.argv[1] if len(sys.argv) > 1 else None
    text = json.dumps(out, indent=2)
    if dest:
        with open(dest, "w", encoding="utf-8") as fh:
            fh.write(text)
        print(f"wrote {len(out)} cases -> {dest}", file=sys.stderr)
    else:
        sys.stdout.reconfigure(encoding="utf-8")
        print(text)
    return 0


def softmax(m):
    m = np.asarray(m, dtype=np.float64)
    e = np.exp(m - m.max())
    return e / e.sum()


if __name__ == "__main__":
    raise SystemExit(main())
