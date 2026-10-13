import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("diagnostic_samples", ROOT / "tools/diagnostic_samples.py")
SAMPLES = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SAMPLES)


def report():
    return {"schema": 1, "pluginVersion": "3.6.1", "requestedCharacterId": "fixture",
            "renderedCharacterId": "fixture", "error": None, "loadAttempts": [{}],
            "load": {"characterId": "fixture", "renderedCharacterId": "fixture", "fallback": False,
                     "status": "ready", "readyMs": 100, "firstFrameMs": 125, "firstFrameStatus": "observed"},
            "sample": {"characterId": "fixture", "durationMs": 3000, "frameDelta": 180,
                       "fps": 60, "cpuDrawMsAvg": 2, "interrupted": False,
                       "environment": {"viewport": {"width": 1000, "height": 800, "pixelRatio": 1},
                                       "reducedMotion": False, "webgl": "webgl2", "gpuRenderer": "Test GPU",
                                       "softwareRenderer": False}}}


class DiagnosticSamplesTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.manifest = self.root / "runs.json"

    def run_samples(self, reports, changes=None):
        runs = []
        for index, payload in enumerate(reports):
            name = f"sample-{index}.json"
            (self.root / name).write_text(json.dumps(payload))
            run = {"id": f"run-{index}", "session": f"session-{index}", "platform": "desktop",
                   "physicalDevice": True, "device": "test-desktop", "os": "test-os", "browser": "test-browser",
                   "conditions": "fixed-page-network", "cache": "cold", "scenario": "load",
                   "visualCheck": "pass", "report": name}
            if changes:
                run.update(changes[index])
            runs.append(run)
        self.manifest.write_text(json.dumps({"schema": 1, "runs": runs}))
        return SAMPLES.summarize(self.manifest)

    def test_three_loads_and_statistics_are_not_hardware_certification(self):
        rows = [report() for _ in range(3)]
        for i, row in enumerate(rows):
            row["load"]["firstFrameMs"] += i * 10
        result = self.run_samples(rows)
        group = result["groups"][0]
        self.assertEqual(group["firstFrameMs"], {"n": 3, "median": 135, "min": 125, "max": 145})
        self.assertTrue(group["enoughLoadRepeats"])
        self.assertFalse(result["hardwareVerified"])
        self.assertEqual(group["classification"], "operator-declared-physical")

    def test_repeated_windows_do_not_multiply_load_sessions(self):
        rows = [report() for _ in range(3)]
        for i, row in enumerate(rows):
            row["sample"]["cpuDrawMsAvg"] += i
        result = self.run_samples(rows, [{"session": "same"}] * 3)
        self.assertEqual(result["groups"][0]["sampleWindows"], 3)
        self.assertEqual(result["groups"][0]["loadSessions"], 1)
        self.assertFalse(result["groups"][0]["enoughLoadRepeats"])

    def test_duplicate_export_and_interrupted_window_are_excluded(self):
        bad = report()
        bad["sample"]["interrupted"] = True
        result = self.run_samples([report(), report(), bad])
        self.assertEqual(result["acceptedWindows"], 1)
        self.assertEqual(len(result["rejected"]), 2)

    def test_software_and_unknown_renderers_never_become_physical(self):
        rows = [report(), report()]
        rows[0]["sample"]["environment"]["gpuRenderer"] = "ANGLE SwiftShader"
        rows[1]["sample"]["environment"]["gpuRenderer"] = None
        result = self.run_samples(rows)
        self.assertEqual([x["classification"] for x in result["groups"]], ["software", "unknown"])

    def test_no_first_frame_or_fallback_keeps_timings_unavailable(self):
        for change in ({"firstFrameStatus": "not-observed", "firstFrameMs": None}, {"fallback": True},
                       {"characterId": "other"}):
            row = report()
            row["load"].update(change)
            result = self.run_samples([row])
            self.assertEqual(result["groups"][0]["firstFrameMs"], {"n": 0})
            self.assertEqual(result["acceptedWindows"], 1)
            if change.get("firstFrameStatus") == "not-observed":
                self.assertEqual(result["groups"][0]["readyMs"]["n"], 1)
                self.assertEqual(result["groups"][0]["missingFirstFrameSessions"], 1)

    def test_reformatted_duplicate_does_not_count_as_new_session(self):
        self.run_samples([report(), report()])
        path = self.root / "sample-1.json"
        path.write_text(json.dumps(report(), indent=4, sort_keys=True))
        result = SAMPLES.summarize(self.manifest)
        self.assertEqual(result["acceptedWindows"], 1)
        self.assertEqual(result["groups"][0]["loadSessions"], 1)

    def test_invalid_row_does_not_poison_corrected_row_for_same_export(self):
        result = self.run_samples([report(), report()], [{"device": None}, {}])
        self.assertEqual(result["acceptedWindows"], 1)
        self.assertEqual(len(result["rejected"]), 1)

    def test_unknown_sensitive_fields_are_not_copied(self):
        row = report()
        row["cookie"] = "SENSITIVE-TOKEN"
        row["sample"]["environment"]["url"] = "https://private.invalid/secret"
        result = self.run_samples([row])
        self.assertNotIn("SENSITIVE-TOKEN", json.dumps(result))
        self.assertNotIn("private.invalid", json.dumps(result))

    def test_unlike_conditions_remain_separate(self):
        rows = [report(), report(), report()]
        rows[1]["sample"]["cpuDrawMsAvg"] = 3
        rows[2]["sample"]["environment"]["viewport"]["width"] = 700
        result = self.run_samples(rows, [{}, {"cache": "warm"}, {}])
        self.assertEqual(len(result["groups"]), 3)

    def test_invalid_metrics_are_excluded(self):
        for field, value in [("fps", 9), ("frameDelta", True), ("cpuDrawMsAvg", float("nan")),
                             ("durationMs", 2000), ("frameDelta", 0)]:
            row = report()
            row["sample"][field] = value
            result = self.run_samples([row])
            self.assertEqual(result["acceptedWindows"], 0)

    def test_parent_path_and_symlink_are_not_read(self):
        self.run_samples([report()])
        original = json.loads(self.manifest.read_text())
        for target in ["../outside.json", "/etc/passwd", "link.json"]:
            data = copy.deepcopy(original)
            data["runs"][0]["report"] = target
            self.manifest.write_text(json.dumps(data))
            (self.root / "link.json").unlink(missing_ok=True)
            (self.root / "link.json").symlink_to(self.root / "sample-0.json")
            self.assertEqual(SAMPLES.summarize(self.manifest)["acceptedWindows"], 0)

    def test_cli_refuses_overwrite_and_does_not_modify_inputs(self):
        self.run_samples([report()])
        before = self.manifest.read_bytes()
        process = subprocess.run([sys.executable, str(ROOT / "tools/diagnostic_samples.py"),
                                  str(self.manifest), "--out", str(self.manifest)], capture_output=True)
        self.assertEqual(process.returncode, 2)
        self.assertEqual(self.manifest.read_bytes(), before)
        self.assertNotIn(str(self.root).encode(), process.stderr)

    def test_deep_json_fails_without_traceback_or_path_disclosure(self):
        self.manifest.write_text('{"nested":' + '[' * 2000 + '0' + ']' * 2000 + '}')
        process = subprocess.run([sys.executable, str(ROOT / "tools/diagnostic_samples.py"),
                                  str(self.manifest), "--out", str(self.root / "out.json")], capture_output=True)
        self.assertEqual(process.returncode, 2)
        self.assertNotIn(b"Traceback", process.stderr)
        self.assertNotIn(str(self.root).encode(), process.stderr)
        self.assertFalse((self.root / "out.json").exists())

    def test_duplicate_session_with_changed_timing_is_excluded(self):
        rows = [report(), report()]
        rows[1]["load"]["firstFrameMs"] = 500
        result = self.run_samples(rows, [{"session": "same"}] * 2)
        self.assertEqual(result["acceptedWindows"], 1)
        self.assertEqual(result["groups"][0]["firstFrameMs"]["max"], 125)


if __name__ == "__main__":
    unittest.main()
