"""CAM5 semantic laboratory profile; values are engineering units, never registers.

This profile models 12 thermal, 8 ambient, 8 humidity and 8 UHF channels.
UHF values are indices from the current CAM5 model, not calibrated pC.
"""
import os

SCENARIO = os.environ.get("HOIT_SCENARIO", "normal")


def phase(elapsed):
    if SCENARIO == "brief":
        return "high_temperature" if 20 <= elapsed < 50 else "normal"
    return SCENARIO


def metrics(elapsed, scenario):
    values = {}
    for index in range(1, 13):
        values[f"cam5.temperature.t{index:02d}"] = 50.0
    for index in range(1, 9):
        values[f"cam5.ambient.a{index:02d}"] = 25.0
        values[f"cam5.humidity.h{index:02d}"] = 50.0
    for index in range(1, 5):
        values[f"cam5.pd.pd{index}"] = 10.0
        values[f"cam5.sd.sd{index}"] = 10.0
    if scenario == "high_temperature":
        values["cam5.temperature.t01"] = 90.0
    elif scenario == "high_humidity":
        values["cam5.humidity.h01"] = 90.0
    elif scenario == "partial_discharge":
        values["cam5.pd.pd1"] = 70.0
    elif scenario == "surface_discharge":
        values["cam5.sd.sd1"] = 50.0
    return values
