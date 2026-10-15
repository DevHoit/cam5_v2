from __future__ import annotations

import unittest

from gateway.hoit_agent.protocols.modbus_rtu import (
    ModbusCrcError,
    ModbusExceptionResponse,
    ModbusRtuClient,
    RtuSettings,
    append_crc,
    crc16,
)


class FakeSerial:
    def __init__(self, response: bytes):
        self.response = bytearray(response)
        self.written = b""
        self.closed = False

    def reset_input_buffer(self) -> None:
        pass

    def write(self, data: bytes) -> int:
        self.written += data
        return len(data)

    def flush(self) -> None:
        pass

    def read(self, size: int) -> bytes:
        chunk = bytes(self.response[:size])
        del self.response[:size]
        return chunk

    def close(self) -> None:
        self.closed = True


class ModbusRtuTests(unittest.TestCase):
    def settings(self) -> RtuSettings:
        return RtuSettings(
            port="/dev/ttyS1",
            baud=19200,
            parity="E",
            stop_bits=1,
            slave_id=1,
            timeout_seconds=0.1,
        )

    def test_crc_matches_standard_rtu_vector_and_is_low_byte_first(self):
        payload = bytes.fromhex("01030000000A")
        self.assertEqual(crc16(payload), 0xCDC5)
        self.assertEqual(append_crc(payload).hex().upper(), "01030000000AC5CD")

    def test_read_holding_registers_validates_frame_and_decodes_big_endian_words(self):
        response = append_crc(bytes.fromhex("0103041234ABCD"))
        port = FakeSerial(response)
        client = ModbusRtuClient(self.settings(), serial_factory=lambda **_kwargs: port)
        client._silent_interval_seconds = lambda: 0.0

        values = client.read_registers(0x0010, 2, function_code=3)

        self.assertEqual(values, [0x1234, 0xABCD])
        self.assertEqual(port.written, append_crc(bytes.fromhex("010300100002")))
        self.assertTrue(port.closed)

    def test_read_input_registers_uses_function_04(self):
        response = append_crc(bytes.fromhex("0104020064"))
        port = FakeSerial(response)
        client = ModbusRtuClient(self.settings(), serial_factory=lambda **_kwargs: port)
        client._silent_interval_seconds = lambda: 0.0

        self.assertEqual(client.read_registers(0x0020, 1, function_code=4), [100])
        self.assertEqual(port.written, append_crc(bytes.fromhex("010400200001")))

    def test_exception_response_is_not_treated_as_data(self):
        response = append_crc(bytes.fromhex("018302"))
        port = FakeSerial(response)
        client = ModbusRtuClient(self.settings(), serial_factory=lambda **_kwargs: port)
        client._silent_interval_seconds = lambda: 0.0

        with self.assertRaises(ModbusExceptionResponse) as raised:
            client.read_registers(0, 1, function_code=3)
        self.assertEqual(raised.exception.exception_code, 2)

    def test_bad_crc_is_rejected(self):
        port = FakeSerial(bytes.fromhex("01030200640000"))
        client = ModbusRtuClient(self.settings(), serial_factory=lambda **_kwargs: port)
        client._silent_interval_seconds = lambda: 0.0

        with self.assertRaises(ModbusCrcError):
            client.read_registers(0, 1, function_code=3)


if __name__ == "__main__":
    unittest.main()
