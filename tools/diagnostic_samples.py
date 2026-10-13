#!/usr/bin/env python3
"""Summarize explicitly selected local diagnostic exports; no network or GPU access."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import stat
import statistics
import sys

MAX_REPORT_BYTES = 2 * 1024 * 1024
MAX_RUNS = 256
SOFTWARE = re.compile(r"swiftshader|llvmpipe|softpipe|software|lavapipe", re.I)


def fail(message):
    raise ValueError(message)


def number(value, maximum=86400000, minimum=0):
    if type(value) not in (int, float) or not math.isfinite(value):
        fail("Expected a finite number")
    if not minimum <= value <= maximum:
        fail("Number outside supported range")
    return value


def label(value, limit=200):
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        fail("Missing or oversized label")
    if any(ord(c) < 32 or ord(c) == 127 for c in value):
        fail("Control character in label")
    return value


def read_json(path, limit):
    # Refuse symbolic links, including parent components, and non-regular files.
    path = path.absolute()
    if any(p.is_symlink() for p in (path, *path.parents)):
        fail("Symbolic links are not supported")
    metadata = path.stat()
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > limit:
        fail("Input must be a bounded regular file")
    raw = path.read_bytes()
    if len(raw) > limit:
        fail("Input exceeds size limit")
    try:
        value = json.loads(raw, parse_constant=lambda _: fail("Non-finite JSON number"))
        canonical = json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    except RecursionError:
        fail("JSON nesting exceeds the supported depth")
    if not isinstance(value, dict):
        fail("Expected a JSON object")
    return value, hashlib.sha256(canonical).hexdigest()


def report_path(base, relative):
    if not isinstance(relative, str) or "\\" in relative:
        fail("Report paths must be relative to the manifest")
    path = Path(relative)
    if path.is_absolute() or ".." in path.parts or not path.parts:
        fail("Report paths must remain inside the manifest directory")
    return base / path


def environment(value):
    if not isinstance(value, dict) or not isinstance(value.get("viewport"), dict):
        fail("Missing sample environment")
    viewport = value["viewport"]
    width = number(viewport.get("width"), 32768, 1)
    height = number(viewport.get("height"), 32768, 1)
    ratio = number(viewport.get("pixelRatio"), 16, 0.1)
    renderer = value.get("gpuRenderer")
    if renderer is not None:
        renderer = label(renderer, 300)
    declared = value.get("softwareRenderer")
    if declared is not None and type(declared) is not bool:
        fail("Invalid renderer flag")
    software = True if renderer and SOFTWARE.search(renderer) else declared
    if not renderer and software is False:
        software = None
    webgl = value.get("webgl")
    if webgl not in ("webgl", "webgl2", None):
        fail("Invalid WebGL version")
    if type(value.get("reducedMotion")) is not bool:
        fail("Missing reduced-motion state")
    return {"viewport": {"width": width, "height": height, "pixelRatio": ratio},
            "renderer": renderer, "softwareRenderer": software,
            "webgl": webgl, "reducedMotion": value["reducedMotion"]}


def extract(report):
    if type(report.get("schema")) is not int or report["schema"] != 1:
        fail("Unsupported diagnostic schema")
    version = label(report.get("pluginVersion"), 64)
    sample = report.get("sample")
    if not isinstance(sample, dict):
        fail("No explicit sample window")
    if sample.get("interrupted") is not False:
        fail("Interrupted sample window")
    duration = number(sample.get("durationMs"), 10000, 2900)
    frames = number(sample.get("frameDelta"), 100000, 1)
    if int(frames) != frames:
        fail("Frame count must be an integer")
    fps = frames * 1000 / duration
    recorded = number(sample.get("fps"), 10000)
    if not math.isclose(fps, recorded, rel_tol=1e-6, abs_tol=0.001):
        fail("FPS does not match frames and duration")
    character = label(sample.get("characterId"))
    env = environment(sample.get("environment"))
    cpu = number(sample.get("cpuDrawMsAvg"), 10000)
    load = report.get("load")
    # A previous character's retained sample must not inherit a new load's timings.
    aligned = (isinstance(load, dict) and load.get("characterId") == character
               and load.get("renderedCharacterId") == character
               and report.get("requestedCharacterId") == character
               and report.get("renderedCharacterId") == character
               and load.get("status") == "ready" and load.get("fallback") is False
               and report.get("error") is None
               and isinstance(report.get("loadAttempts"), list)
               and len(report["loadAttempts"]) == 1)
    ready = first = None
    if aligned:
        ready = number(load.get("readyMs"))
        if load.get("firstFrameStatus") == "observed":
            first = number(load.get("firstFrameMs"), minimum=ready)
    return {"version": version, "character": character, "environment": env,
            "fps": fps, "cpuDrawMsAvg": cpu, "readyMs": ready, "firstFrameMs": first}


def stats(values):
    return {"n": len(values), "median": statistics.median(values),
            "min": min(values), "max": max(values)} if values else {"n": 0}


def summarize(manifest_path):
    manifest_path = Path(manifest_path).absolute()
    manifest, _ = read_json(manifest_path, 256 * 1024)
    if type(manifest.get("schema")) is not int or manifest["schema"] != 1:
        fail("Unsupported manifest schema")
    runs = manifest.get("runs")
    if not isinstance(runs, list) or not 1 <= len(runs) <= MAX_RUNS:
        fail("Manifest needs 1–256 explicit runs")
    identifiers, digests, sessions = set(), set(), {}
    groups, rejected = {}, []
    for index, run in enumerate(runs, 1):
        if not isinstance(run, dict):
            fail("Invalid run entry")
        identifier = label(run.get("id"), 64)
        if identifier in identifiers:
            fail("Duplicate run ID")
        identifiers.add(identifier)
        try:
            platform = run.get("platform")
            if platform not in ("desktop", "android", "ios"):
                fail("Unknown platform")
            physical = run.get("physicalDevice")
            if type(physical) is not bool:
                fail("Declare whether the device is physical")
            cache = run.get("cache")
            scenario = run.get("scenario")
            if cache not in ("cold", "warm") or scenario not in ("load", "switch", "resume", "soak"):
                fail("Unknown cache state or scenario")
            visual = run.get("visualCheck")
            if visual not in ("pass", "fail", "not-run"):
                fail("Missing manual visual result")
            session = label(run.get("session"), 64)
            report, digest = read_json(report_path(manifest_path.parent, run.get("report")), MAX_REPORT_BYTES)
            if digest in digests:
                fail("Duplicate diagnostic export")
            data = extract(report)
            conditions = {"platform": platform, "physicalDeviceDeclared": physical,
                          "device": label(run.get("device"), 100), "os": label(run.get("os"), 100),
                          "browser": label(run.get("browser"), 100),
                          "conditions": label(run.get("conditions"), 100),
                          "cache": cache, "scenario": scenario, "pluginVersion": data["version"],
                          "characterId": data["character"], **data["environment"]}
            key = json.dumps(conditions, sort_keys=True)
            if session in sessions and sessions[session] != key:
                fail("Session reused across different conditions")
            sessions[session] = key
            group = groups.setdefault(key, {"conditions": conditions, "windows": [], "loads": {},
                                           "visualChecks": {"pass": 0, "fail": 0, "not-run": 0}})
            if data["readyMs"] is not None and scenario == "load":
                timings = (data["readyMs"], data["firstFrameMs"])
                if session in group["loads"] and group["loads"][session] != timings:
                    fail("Load timing changed within the same session; use a new session after reload")
                group["loads"][session] = timings
            group["windows"].append(data)
            group["visualChecks"][visual] += 1
            digests.add(digest)
        except (ValueError, OSError, KeyError, TypeError, OverflowError):
            # Do not echo paths, raw JSON, exception text or arbitrary extra fields.
            rejected.append({"run": index, "id": identifier, "reason": "invalid-or-incomplete-sample"})
    output = []
    for group in groups.values():
        windows = group["windows"]
        if not windows:
            continue
        conditions = group["conditions"]
        renderer = conditions["softwareRenderer"]
        classification = ("software" if renderer is True else "unknown" if renderer is None
                          else "operator-declared-physical" if conditions["physicalDeviceDeclared"]
                          else "simulated-or-unspecified-device")
        loads = list(group["loads"].values())
        output.append({"conditions": conditions, "classification": classification,
                       "sampleWindows": len(windows), "loadSessions": len(loads),
                       "enoughLoadRepeats": len(loads) >= 3,
                       "missingFirstFrameSessions": sum(x[1] is None for x in loads),
                       "enoughFirstFrameRepeats": sum(x[1] is not None for x in loads) >= 3,
                       "readyMs": stats([x[0] for x in loads]),
                       "firstFrameMs": stats([x[1] for x in loads if x[1] is not None]),
                       "fps": stats([x["fps"] for x in windows]),
                       "cpuDrawMsAvg": stats([x["cpuDrawMsAvg"] for x in windows]),
                       "visualChecks": group["visualChecks"]})
    return {"schema": 1, "inputRuns": len(runs), "acceptedWindows": sum(g["sampleWindows"] for g in output),
            "rejected": rejected, "groups": output, "hardwareVerified": False,
            "limitations": ["Device identity, cache state and visual checks are operator declarations.",
                            "Renderer classification is a heuristic, not hardware attestation.",
                            "CPU draw time is not GPU execution time; no automatic tuning or acceptance verdict.",
                            "Repeated windows from one session count as one load, not independent cold starts."]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--out", type=Path, required=True, help="New private summary file; existing files are refused")
    args = parser.parse_args()
    try:
        result = summarize(args.manifest)
        import os
        # Exclusive create prevents accidental replacement of input or evidence files.
        descriptor = os.open(args.out, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w") as handle:
            json.dump(result, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
    except (ValueError, OSError, KeyError, TypeError, OverflowError):
        parser.exit(2, "Cannot summarize: check input schema, bounded local files and new output path.\n")
    print(f"Accepted {result['acceptedWindows']} windows; excluded {len(result['rejected'])}. No hardware certification.")
    return 1 if result["rejected"] else 0


if __name__ == "__main__":
    sys.exit(main())
