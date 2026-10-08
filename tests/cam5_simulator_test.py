import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('launcher', ROOT / 'examples/hoit_simulator.py')
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)
spec = importlib.util.spec_from_file_location('cam5', ROOT / 'examples/cam5_simulator.py')
cam5 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cam5)


class Cam5ProfileTests(unittest.TestCase):
    def test_cloud_sample_has_all_channels_and_no_raw_registers(self):
        phase, samples, done = launcher.build_metrics('cam5', cam5, ['CAM5-E2E-01'], 0, {})
        self.assertFalse(done)
        self.assertEqual(len(samples[0]['metrics']), 36)
        self.assertEqual(set(samples[0]), {'device_id', 'sampled_at', 'quality', 'metrics'})
        self.assertEqual(samples[0]['quality'], 'GOOD')
        self.assertEqual(samples[0]['metrics']['cam5.temperature.t01'], 50)

    def test_scenarios_change_only_the_intended_channel(self):
        baseline = cam5.metrics(0, 'normal')
        for scenario, key, value in [('high_temperature', 'cam5.temperature.t01', 90), ('high_humidity', 'cam5.humidity.h01', 90), ('partial_discharge', 'cam5.pd.pd1', 70), ('surface_discharge', 'cam5.sd.sd1', 50)]:
            metrics = cam5.metrics(0, scenario)
            self.assertEqual([k for k in metrics if metrics[k] != baseline[k]], [key])
            self.assertEqual(metrics[key], value)

    def test_brief_excursion_lasts_thirty_seconds_and_recovers(self):
        previous = cam5.SCENARIO
        try:
            cam5.SCENARIO = 'brief'
            self.assertEqual([cam5.phase(t) for t in [19, 20, 49, 50]], ['normal', 'high_temperature', 'high_temperature', 'normal'])
        finally:
            cam5.SCENARIO = previous

    def test_production_override_cannot_bypass_cam5_laboratory_scope(self):
        result = subprocess.run([sys.executable, str(ROOT / 'examples/hoit_simulator.py'), '--profile', 'cam5', '--base-url', 'https://core.hoitlive.com', '--allow-production', '--cycles', '1'], env={**os.environ, 'HOIT_GATEWAY_TOKEN': 'fake-no-network'}, capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertIn('sólo admite el Preview', result.stderr)


if __name__ == '__main__':
    unittest.main()
