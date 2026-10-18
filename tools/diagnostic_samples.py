#!/usr/bin/env python3
"""Summarize explicitly selected local diagnostic exports; no network or GPU access."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import statistics
import sys

MAX_REPORT_BYTES = 2 * 1024 * 1024
MAX_RUNS = 256
DIRECTORY_FD_SUPPORTED = all(function in getattr(os, "supports_dir_fd", set()) for function in (os.open, os.mkdir, os.stat, os.unlink, os.rmdir))
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
    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            if key in result: fail("Duplicate JSON key")
            result[key] = value
        return result
    try:
        value = json.loads(raw, object_pairs_hook=unique_object, parse_constant=lambda _: fail("Non-finite JSON number"))
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
    identifiers, digests, sessions, window_ids = set(), set(), {}, set()
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
            identity = (report.get("batchId"), report.get("windowId"))
            stable_identity = (isinstance(identity[0], str) and re.fullmatch(r"[0-9a-f]{32}", identity[0])
                               and type(identity[1]) is int and identity[1] > 0)
            if stable_identity and identity in window_ids:
                fail("Duplicate diagnostic window")
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
            if stable_identity: window_ids.add(identity)
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


BATCH_KIND = "wzf-mascot-diagnostic-batch"


def object_keys(value, allowed):
    if not isinstance(value, dict) or set(value) - set(allowed):
        fail("Unknown diagnostic fields")
    return value


def random_id(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{32}", value):
        fail("Invalid diagnostic namespace")
    return value


def optional_label(value, limit=200):
    return None if value is None else label(value, limit)


def validate_error(value):
    if value is None: return
    object_keys(value, ["code", "category", "phase", "characterId"])
    for key in value: label(value[key], 200)
    if value.get("code") not in ("timeout", "http", "network", "invalid", "webgl", "context-lost", "render", "cancelled"):
        fail("Invalid diagnostic error")


def validate_load(value, session):
    if value is None: return
    object_keys(value, ["sessionId", "characterId", "renderedCharacterId", "fallback", "stages", "status", "readyMs", "firstFrameMs", "firstFrameStatus", "error"])
    random_id(value.get("sessionId"))
    label(value.get("characterId"))
    optional_label(value.get("renderedCharacterId"))
    if type(value.get("fallback")) is not bool or value.get("status") not in ("loading", "ready", "failed", "cancelled"):
        fail("Invalid loading state")
    for key in ("readyMs", "firstFrameMs"):
        if value.get(key) is not None: number(value[key])
    if value.get("firstFrameStatus") not in ("observed", "not-observed", "interrupted"):
        fail("Invalid first-frame state")
    if value["firstFrameStatus"] == "observed":
        number(value.get("firstFrameMs"), minimum=value.get("readyMs") or 0)
    elif value.get("firstFrameMs") is not None:
        fail("Unobserved first frame must remain absent")
    stages = value.get("stages")
    if not isinstance(stages, list) or len(stages) > 30: fail("Invalid load stages")
    for stage in stages:
        object_keys(stage, ["phase", "elapsedMs"]); label(stage.get("phase"), 30); number(stage.get("elapsedMs"))
    validate_error(value.get("error"))


def validate_window(value, batch_id):
    object_keys(value, ["schema", "pluginVersion", "batchId", "windowId", "loadSessionId", "characterId", "requestedCharacterId", "renderedCharacterId", "loadAttempts", "environment", "phase", "error", "load", "sample", "engineStats", "engineStatsCharacterId", "measurements"])
    if type(value.get("schema")) is not int or value["schema"] != 1 or value.get("batchId") != batch_id:
        fail("Invalid window schema or batch")
    if type(value.get("windowId")) is not int or not 1 <= value["windowId"] <= 100000000:
        fail("Invalid window ID")
    session = random_id(value.get("loadSessionId"))
    label(value.get("pluginVersion"), 64); label(value.get("characterId"))
    for key in ("requestedCharacterId", "renderedCharacterId", "engineStatsCharacterId"):
        optional_label(value.get(key))
    if "phase" in value: label(value["phase"], 30)
    if "measurements" in value: label(value["measurements"], 2000)
    for env in (value.get("environment"), value.get("sample", {}).get("environment") if isinstance(value.get("sample"), dict) else None):
        object_keys(env, ["viewport", "reducedMotion", "webgl", "gpuRenderer", "softwareRenderer"])
        object_keys(env.get("viewport"), ["width", "height", "pixelRatio"])
        environment(env)
    sample = object_keys(value.get("sample"), ["characterId", "environment", "durationMs", "frameDelta", "fps", "interrupted", "reason", "cpuDrawMsAvg", "engineLifetimeCpuDrawMsMax"])
    if sample.get("characterId") != value["characterId"] or type(sample.get("interrupted")) is not bool:
        fail("Invalid sample ownership")
    duration = number(sample.get("durationMs")); frames = number(sample.get("frameDelta"), 100000000)
    if frames != int(frames): fail("Invalid sample frames")
    fps = frames * 1000 / duration if duration else 0
    if (not duration and frames) or not math.isclose(number(sample.get("fps"), 1000000), fps, rel_tol=1e-6, abs_tol=0.001):
        fail("Invalid sample FPS")
    number(sample.get("cpuDrawMsAvg"), 1000000); number(sample.get("engineLifetimeCpuDrawMsMax"), 1000000)
    optional_label(sample.get("reason"), 100)
    load = value.get("load"); validate_load(load, session)
    if load is not None and (load["sessionId"] != session or load["characterId"] != sample["characterId"]):
        fail("Loading session does not match sample")
    attempts = value.get("loadAttempts")
    if not isinstance(attempts, list) or len(attempts) > 20: fail("Invalid load attempts")
    for attempt in attempts: validate_load(attempt, session)
    validate_error(value.get("error"))
    stats = value.get("engineStats")
    if stats is not None:
        object_keys(stats, ["frames", "paused", "motion", "expression", "activeMotion", "motionElapsed", "completedMotion", "motionPlays", "renderMsAvg", "renderMsMax", "cachedMotions", "cachedExpressions", "disposed", "activeExpression", "renderMsTotal"])
        for key, item in stats.items():
            if key in ("paused", "disposed"):
                if type(item) is not bool: fail("Invalid engine state flag")
            elif key in ("motion", "expression", "activeMotion", "completedMotion", "activeExpression"):
                if item == "" and key in ("motion", "expression", "completedMotion", "activeExpression"): continue
                if item is None and key == "activeExpression": continue
                label(item, 200)
            else:
                number(item, 1000000000)
    return value


def unpack_batch(batch_path, output_path):
    if (os.name != "posix" or not all(hasattr(os, flag) for flag in ("O_DIRECTORY", "O_NOFOLLOW"))
            or not DIRECTORY_FD_SUPPORTED):
        fail("Batch unpacking requires Linux/macOS directory descriptor support")
    batch, _ = read_json(Path(batch_path), MAX_REPORT_BYTES)
    object_keys(batch, ["kind", "schema", "batchId", "maxWindows", "replacedWindows", "windows"])
    if batch.get("kind") != BATCH_KIND or type(batch.get("schema")) is not int or batch["schema"] != 1 or (type(batch.get("maxWindows")) is not int or batch["maxWindows"] != 20):
        fail("Unsupported batch schema")
    batch_id = random_id(batch.get("batchId"))
    if type(batch.get("replacedWindows")) is not int or batch["replacedWindows"] < 0: fail("Invalid replacement count")
    windows = batch.get("windows")
    if not isinstance(windows, list) or not 1 <= len(windows) <= 20: fail("Batch needs 1–20 windows")
    prepared, runs, seen = [], [], set()
    for index, window in enumerate(windows, 1):
        window = validate_window(window, batch_id)
        if window["windowId"] in seen: fail("Duplicate batch window")
        seen.add(window["windowId"])
        name = f"window-{index:02d}.json"  # Never use input paths or IDs as filenames.
        prepared.append((name, json.dumps(window, ensure_ascii=False, indent=2, allow_nan=False) + "\n"))
        identity = hashlib.sha256(f"{batch_id}:{window['windowId']}".encode()).hexdigest()
        session = hashlib.sha256(f"{batch_id}:{window['loadSessionId']}".encode()).hexdigest()
        runs.append({"id": identity, "session": session, "platform": None, "physicalDevice": False,
                     "device": "TODO device", "os": "TODO OS and version", "browser": "TODO browser and version",
                     "conditions": "TODO fixed conditions and checkpoint", "cache": None, "scenario": None,
                     "visualCheck": "not-run", "report": name})
    prepared.append(("runs.json", json.dumps({"schema": 1, "runs": runs}, ensure_ascii=False, indent=2) + "\n"))
    destination = Path(output_path).absolute()
    if any(p.is_symlink() for p in (destination, *destination.parents)) or destination.exists() or not destination.parent.is_dir():
        fail("Output must be a new directory without symbolic links")
    # Validation finishes before creating anything. Pin parent/output directories
    # and use exclusive fixed-name writes; no existing output is overwritten.
    parent = os.open(destination.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    directory = None; created = []; created_directory = None
    try:
        os.mkdir(destination.name, mode=0o700, dir_fd=parent)
        created_directory = os.stat(destination.name, dir_fd=parent, follow_symlinks=False)
        directory = os.open(destination.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
        opened = os.fstat(directory)
        if (opened.st_dev, opened.st_ino) != (created_directory.st_dev, created_directory.st_ino):
            fail("Output directory changed")
        for name, contents in prepared:
            descriptor = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
            identity = os.fstat(descriptor)
            created.append((name, identity.st_dev, identity.st_ino))
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle: handle.write(contents)
    except BaseException:
        if directory is not None:
            for name, device, inode in created:
                try:
                    current_file = os.stat(name, dir_fd=directory, follow_symlinks=False)
                    if (current_file.st_dev, current_file.st_ino) == (device, inode): os.unlink(name, dir_fd=directory)
                except OSError: pass
            opened = os.fstat(directory)
            current = os.stat(destination.name, dir_fd=parent, follow_symlinks=False)
            if (opened.st_dev, opened.st_ino) == (current.st_dev, current.st_ino) == (created_directory.st_dev, created_directory.st_ino):
                try: os.rmdir(destination.name, dir_fd=parent)
                except OSError: pass
        # If opening the newly created directory failed, ownership cannot be
        # proven by a held descriptor; leave it for inspection rather than delete.
        raise
    finally:
        if directory is not None: os.close(directory)
        os.close(parent)
    return len(windows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path, nargs="?")
    parser.add_argument("--unpack-batch", type=Path, help="Explicit local batch JSON; unpack to a new directory")
    parser.add_argument("--out", type=Path, required=True, help="New private summary file or new batch directory; existing outputs are refused")
    args = parser.parse_args()
    try:
        if args.unpack_batch is not None:
            if args.manifest is not None: fail("Choose a manifest or a batch")
            count = unpack_batch(args.unpack_batch, args.out)
            print(f"Unpacked {count} windows. Fill runs.json metadata; no device or visual acceptance is implied.")
            return 0
        if args.manifest is None: fail("Explicit manifest or batch required")
        result = summarize(args.manifest)
        # Exclusive create prevents accidental replacement of input or evidence files.
        descriptor = os.open(args.out, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w") as handle:
            json.dump(result, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
    except (ValueError, OSError, KeyError, TypeError, OverflowError, RecursionError):
        parser.exit(2, "Cannot process diagnostics: check schema, bounded local inputs and new output path; batch unpacking requires Linux/macOS.\n")
    print(f"Accepted {result['acceptedWindows']} windows; excluded {len(result['rejected'])}. No hardware certification.")
    return 1 if result["rejected"] else 0


if __name__ == "__main__":
    sys.exit(main())
