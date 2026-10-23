import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

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


def batch(count=3):
    rows = []
    for index in range(count):
        row = report()
        row.update(batchId="a" * 32, windowId=index + 1, loadSessionId="b" * 32,
                   characterId="fixture", phase="ready", environment=copy.deepcopy(row["sample"]["environment"]),
                   engineStatsCharacterId="fixture")
        row["load"].update(sessionId="b" * 32, stages=[])
        row["loadAttempts"] = [copy.deepcopy(row["load"])]
        row["sample"].update(reason="window-ended", engineLifetimeCpuDrawMsMax=4)
        # The actual engine's untouched state contains these empty strings.
        row["engineStats"] = {"frames": 180, "paused": False, "motion": "", "expression": "",
            "activeMotion": "idle", "motionElapsed": 0, "completedMotion": "", "motionPlays": 0,
            "renderMsAvg": 2, "renderMsMax": 4, "cachedMotions": 1, "cachedExpressions": 0}
        rows.append(row)
    return {"kind": SAMPLES.BATCH_KIND, "schema": 1, "batchId": "a" * 32,
            "maxWindows": 20, "replacedWindows": 0, "windows": rows}


class DiagnosticBatchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); self.input = self.root / "batch.json"; self.out = self.root / "unpacked"

    def write(self, value): self.input.write_text(json.dumps(value))

    def metadata(self, directory):
        path = directory / "runs.json"; value = json.loads(path.read_text())
        for run in value["runs"]:
            run.update(platform="desktop", physicalDevice=True, device="test", os="test OS", browser="test browser",
                       conditions="fixed", cache="cold", scenario="load", visualCheck="pass")
        path.write_text(json.dumps(value)); return value

    def test_unpack_real_state_shape_and_template_defaults_preserves_one_loading_session(self):
        self.write(batch()); before = self.input.read_bytes()
        self.assertEqual(SAMPLES.unpack_batch(self.input, self.out), 3)
        template = json.loads((self.out / "runs.json").read_text())
        self.assertEqual(len({row["session"] for row in template["runs"]}), 1)
        self.assertEqual(len({row["id"] for row in template["runs"]}), 3)
        self.assertTrue(all(row["physicalDevice"] is False and row["visualCheck"] == "not-run" and row["platform"] is None for row in template["runs"]))
        self.assertEqual(set(path.name for path in self.out.iterdir()), {"runs.json", "window-01.json", "window-02.json", "window-03.json"})
        self.metadata(self.out); result = SAMPLES.summarize(self.out / "runs.json")
        self.assertEqual(result["acceptedWindows"], 3); self.assertEqual(result["groups"][0]["loadSessions"], 1)
        self.assertEqual(self.input.read_bytes(), before)
        self.assertEqual(json.loads((self.out / 'window-01.json').read_text())['engineStats']['expression'], '')

    def test_interrupted_and_missing_first_frame_are_preserved_then_conservatively_summarized(self):
        value = batch(); value["windows"][0]["sample"].update(interrupted=True, durationMs=500, frameDelta=30, reason="user-stopped-sampling")
        for window in value["windows"]:
            window["load"].update(firstFrameMs=None, firstFrameStatus="not-observed")
            window["loadAttempts"] = [copy.deepcopy(window["load"])]
        self.write(value); SAMPLES.unpack_batch(self.input, self.out)
        self.assertTrue(json.loads((self.out / "window-01.json").read_text())["sample"]["interrupted"])
        self.metadata(self.out); summary = SAMPLES.summarize(self.out / "runs.json")
        self.assertEqual(summary["acceptedWindows"], 2); self.assertEqual(summary["groups"][0]["firstFrameMs"], {"n": 0})

    def test_stable_window_ids_deduplicate_reexports_even_if_live_metadata_changes(self):
        value = batch(2); value["windows"][1]["loadSessionId"] = 'c' * 32
        value["windows"][1]["load"]["sessionId"] = 'c' * 32
        self.write(value); SAMPLES.unpack_batch(self.input, self.out); first = self.metadata(self.out)
        self.assertEqual(len({row["session"] for row in first["runs"]}), 2)
        copied = copy.deepcopy(value["windows"][0]); copied["load"]["firstFrameMs"] += 10
        (self.out / 'duplicate.json').write_text(json.dumps(copied))
        duplicate = dict(first['runs'][0], id='duplicate', report='duplicate.json')
        first['runs'].append(duplicate); (self.out/'runs.json').write_text(json.dumps(first))
        self.assertEqual(SAMPLES.summarize(self.out/'runs.json')['acceptedWindows'], 2)
        other = batch(1); other['batchId'] = 'd' * 32; other['windows'][0]['batchId'] = 'd' * 32
        self.write(other); second_dir = self.root/'second'; SAMPLES.unpack_batch(self.input, second_dir)
        second = json.loads((second_dir/'runs.json').read_text())
        self.assertNotEqual(first['runs'][0]['session'], second['runs'][0]['session'])

    def test_invalid_batches_are_prevalidated_without_partial_output(self):
        mutations = [lambda v:v.update(kind='other'), lambda v:v.update(windows=v['windows']*8),
            lambda v:v['windows'][1].update(windowId=1), lambda v:v['windows'][0].update(report='../private.json'),
            lambda v:v['windows'][0].update(batchId='x'), lambda v:v['windows'][0]['sample'].update(frameDelta=True),
            lambda v:v['windows'][0]['engineStats'].update(frames=''),
            lambda v:v['windows'][0]['engineStats'].update(expression='bad\ninput')]
        for change in mutations:
            value=batch();change(value);self.write(value)
            with self.assertRaises((ValueError,TypeError)): SAMPLES.unpack_batch(self.input,self.out)
            self.assertFalse(self.out.exists())
        self.input.write_bytes(b' '*(SAMPLES.MAX_REPORT_BYTES+1))
        with self.assertRaises(ValueError): SAMPLES.unpack_batch(self.input,self.out)
        self.assertFalse(self.out.exists())

    def test_existing_output_symlinks_and_input_paths_are_refused(self):
        self.write(batch()); self.out.mkdir()
        with self.assertRaises(ValueError): SAMPLES.unpack_batch(self.input,self.out)
        self.out.rmdir(); self.out.symlink_to(self.root,target_is_directory=True)
        with self.assertRaises(ValueError): SAMPLES.unpack_batch(self.input,self.out)
        self.out.unlink(); linked=self.root/'linked.json';linked.symlink_to(self.input)
        with self.assertRaises(ValueError): SAMPLES.unpack_batch(linked,self.out)
        self.assertFalse(self.out.exists())
        parent=self.root/'parent';parent.symlink_to(self.root,target_is_directory=True)
        with self.assertRaises(ValueError): SAMPLES.unpack_batch(self.input,parent/'new')
        self.assertFalse((self.root/'new').exists())

    def test_failed_write_cleanup_retains_replaced_files(self):
        self.write(batch()); original=SAMPLES.os.open
        def interrupted(name,*args,**kwargs):
            if name=='window-02.json':
                foreign=self.out/'foreign';foreign.write_text('foreign bytes')
                foreign.replace(self.out/'window-01.json')
                raise OSError('synthetic write failure')
            return original(name,*args,**kwargs)
        with mock.patch.object(SAMPLES.os,'open',side_effect=interrupted):
            with self.assertRaises(OSError): SAMPLES.unpack_batch(self.input,self.out)
        self.assertEqual((self.out/'window-01.json').read_text(),'foreign bytes')
        self.assertFalse((self.out/'runs.json').exists())

    def test_replaced_output_directory_is_not_written_or_removed(self):
        self.write(batch()); original=SAMPLES.os.open
        def replaced(name,*args,**kwargs):
            if name==self.out.name and kwargs.get('dir_fd') is not None:
                self.out.rename(self.root/'original-created-directory')
                self.out.mkdir()  # Foreign directory must survive cleanup.
            return original(name,*args,**kwargs)
        with mock.patch.object(SAMPLES.os,'open',side_effect=replaced):
            with self.assertRaises(ValueError): SAMPLES.unpack_batch(self.input,self.out)
        self.assertTrue(self.out.is_dir()); self.assertEqual(list(self.out.iterdir()),[])

    def test_unsupported_unpack_platform_fails_cleanly_before_output(self):
        self.write(batch())
        with mock.patch.object(SAMPLES.os, 'name', 'nt'):
            with self.assertRaises(ValueError): SAMPLES.unpack_batch(self.input,self.out)
        self.assertFalse(self.out.exists())

    def test_cli_batch_mode_and_duplicate_keys_do_not_expose_paths(self):
        self.write(batch(1))
        process=subprocess.run([sys.executable,str(ROOT/'tools/diagnostic_samples.py'),'--unpack-batch',str(self.input),'--out',str(self.out)],capture_output=True)
        self.assertEqual(process.returncode,0,process.stderr)
        self.assertNotIn(str(self.root).encode(),process.stdout)
        invalid=self.root/'invalid.json';invalid.write_text('{"schema":1,"schema":2}')
        with self.assertRaises(ValueError): SAMPLES.unpack_batch(invalid,self.root/'bad')
        self.assertFalse((self.root/'bad').exists())


def resource_trace():
    return {"events": [
        {"category": "texture", "operation": "download", "ordinal": 1, "startMs": 0, "durationMs": 50, "bodyBytes": 10, "status": "ok", "errorCode": None},
        {"category": "shader", "operation": "download", "ordinal": 2, "startMs": 2, "durationMs": 60, "bodyBytes": 5, "status": "ok", "errorCode": None},
        {"category": "texture", "operation": "decode", "ordinal": 1, "startMs": 50, "durationMs": 20, "bodyBytes": None, "status": "ok", "errorCode": None}],
        "dropped": 0, "endedBy": "first-frame"}


class ResourceTimingTests(unittest.TestCase):
    def test_optional_old_reports_and_parallel_summary(self):
        self.assertEqual(SAMPLES.resource_summary({}), {"available": False})
        summary = SAMPLES.resource_summary({"resources": resource_trace()})
        self.assertEqual(summary["maxOperationMs"], 60)
        self.assertEqual(summary["bodyBytes"], 15)
        self.assertEqual(len(summary["categories"]), 3)
        self.assertNotIn("totalDurationMs", summary)

    def test_resource_lists_and_fields_are_strict(self):
        mutations = [lambda v: v.update(url="secret"), lambda v:v.update(dropped=True),
            lambda v:v.update(endedBy="user supplied error"), lambda v:v.update(events=v["events"]*50),
            lambda v:v["events"][0].update(url="secret"), lambda v:v["events"][0].update(category="arbitrary"),
            lambda v:v["events"][0].update(operation="GPU"), lambda v:v["events"][0].update(ordinal=True),
            lambda v:v["events"][0].update(bodyBytes=1.5), lambda v:v["events"][2].update(bodyBytes=1),
            lambda v:v["events"][0].update(startMs=-1), lambda v:v["events"][0].update(durationMs=float("nan")),
            lambda v:v["events"][0].update(status="failed",errorCode="private exception"),
            lambda v:v["events"][0].update(errorCode="http"),
            lambda v:v["events"].append(copy.deepcopy(v["events"][0])),
            lambda v:v["events"][1].update(ordinal=1)]
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                value=resource_trace();mutate(value)
                with self.assertRaises((ValueError,TypeError)): SAMPLES.resource_summary({"resources":value})

    def test_failures_cancellation_and_cap(self):
        trace=resource_trace();trace["events"]=[dict(trace["events"][0],ordinal=i+1) for i in range(128)]
        trace.update(dropped=10,endedBy="cancelled")
        trace["events"][0].update(status="failed",errorCode="timeout",bodyBytes=None)
        trace["events"][1].update(status="cancelled",errorCode="cancelled",bodyBytes=None)
        result=SAMPLES.resource_summary({"resources":trace})
        self.assertEqual(result["events"],128);self.assertEqual(result["dropped"],10)
        self.assertEqual(result["categories"][0]["failed"],1)
        self.assertEqual(result["categories"][0]["cancelled"],1)

    def test_unsampled_report_and_batch_preserve_optional_trace(self):
        value=batch(1);row=value["windows"][0]
        row["load"]["resources"]=resource_trace();row["loadAttempts"]=[copy.deepcopy(row["load"])]
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/"report.json"
            path.write_text(json.dumps(dict(row,sample=None,windowId=None)))
            result=SAMPLES.summarize_resource_report(path)
            self.assertEqual(result["loads"][0]["resources"]["bodyBytes"],15)
            path.write_text(json.dumps(value));out=Path(temp)/"out"
            SAMPLES.unpack_batch(path,out)
            retained=json.loads((out/"window-01.json").read_text())
            self.assertEqual(retained["load"]["resources"],resource_trace())
            row["load"]["resources"]["events"][0]["url"]="private"
            path.write_text(json.dumps(value))
            with self.assertRaises(ValueError): SAMPLES.unpack_batch(path,Path(temp)/"bad")


if __name__ == "__main__":
    unittest.main()
