import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('hoit_simulator', Path(__file__).parents[1] / 'examples/hoit_simulator.py')
simulator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(simulator)

class RetryTest(unittest.TestCase):
    def test_rate_limit_preserves_the_exact_batch(self):
        payload = {'message_id': 'same-id', 'sequence': 12, 'samples': [{'value': 5}]}
        with patch.object(simulator, 'request_json', side_effect=[(429, {'retry_after_seconds': 7}, ''), (202, {'accepted': True}, '')]) as request, patch.object(simulator.time, 'sleep') as sleep:
            self.assertEqual(simulator.send_ingest_with_retry('https://example.test', 'test', payload)[0], 202)
            self.assertEqual(request.call_count, 2)
            self.assertIs(request.call_args_list[0].args[4], payload)
            self.assertIs(request.call_args_list[1].args[4], payload)
            sleep.assert_called_once_with(7)
    def test_retries_are_bounded_and_contract_errors_are_not_retried(self):
        with patch.object(simulator, 'request_json', return_value=(503, None, 'unavailable')) as request, patch.object(simulator.time, 'sleep'):
            self.assertEqual(simulator.send_ingest_with_retry('https://example.test', 'test', {}, attempts=3)[0], 503)
            self.assertEqual(request.call_count, 3)
        with patch.object(simulator, 'request_json', return_value=(401, None, 'denied')) as request:
            self.assertEqual(simulator.send_ingest_with_retry('https://example.test', 'test', {})[0], 401)
            self.assertEqual(request.call_count, 1)

if __name__ == '__main__':
    unittest.main()
