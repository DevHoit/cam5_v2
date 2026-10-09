from __future__ import annotations

import struct
import time
from dataclasses import dataclass
from typing import Callable, Protocol


class SerialPort(Protocol):
    def reset_input_buffer(self) -> None: ...
    def write(self, data: bytes) -> int: ...
    def flush(self) -> None: ...
    def read(self, size: int) -> bytes: ...
    def close(self) -> None: ...


SerialFactory = Callable[..., SerialPort]


class ModbusError(RuntimeError):
    pass


class ModbusTimeout(ModbusError):
    pass


class ModbusCrcError(ModbusError):
    pass


class ModbusExceptionResponse(ModbusError):
    def __init__(self, function_code: int, exception_code: int):
        super().__init__(f"Modbus exception function=0x{function_code:02X} code=0x{exception_code:02X}")
        self.function_code = function_code
        self.exception_code = exception_code


def crc16(data: bytes) -> int:
    value = 0xFFFF
    for byte in data:
        value ^= byte
        for _ in range(8):
            value = (value >> 1) ^ 0xA001 if value & 1 else value >> 1
    return value & 0xFFFF


def append_crc(frame: bytes) -> bytes:
    return frame + crc16(frame).to_bytes(2, "little")


def validate_crc(frame: bytes) -> bool:
    if len(frame) < 4:
        return False
    expected = int.from_bytes(frame[-2:], "little")
    return crc16(frame[:-2]) == expected


@dataclass(frozen=True)
class RtuSettings:
    port: str
    baud: int
    parity: str
    stop_bits: int
    slave_id: int
    timeout_seconds: float = 1.0

    def validate(self) -> None:
        if not self.port.startswith("/dev/"):
            raise ValueError("El puerto Modbus RTU debe ser una ruta /dev/ explícita.")
        if self.baud <= 0:
            raise ValueError("baud debe ser positivo.")
        if self.parity not in {"N", "E", "O"}:
            raise ValueError("parity debe ser N, E u O.")
        if self.stop_bits not in {1, 2}:
            raise ValueError("stop_bits debe ser 1 o 2.")
        if not 1 <= self.slave_id <= 247:
            raise ValueError("slave_id debe estar entre 1 y 247.")


class ModbusRtuClient:
    def __init__(self, settings: RtuSettings, serial_factory: SerialFactory | None = None):
        settings.validate()
        self.settings = settings
        self.serial_factory = serial_factory or self._pyserial_factory

    @staticmethod
    def _pyserial_factory(**kwargs) -> SerialPort:
        try:
            import serial  # type: ignore
        except ImportError as error:
            raise RuntimeError("El driver físico Modbus requiere pyserial en el gateway.") from error
        return serial.Serial(**kwargs)

    def _silent_interval_seconds(self) -> float:
        if self.settings.baud > 19200:
            return 0.00175
        # 11 bits/character is conservative for start + 8 data + parity + stop.
        return (3.5 * 11.0) / float(self.settings.baud)

    def _open(self) -> SerialPort:
        return self.serial_factory(
            port=self.settings.port,
            baudrate=self.settings.baud,
            parity=self.settings.parity,
            stopbits=self.settings.stop_bits,
            bytesize=8,
            timeout=self.settings.timeout_seconds,
        )

    def read_registers(self, start_address: int, quantity: int, function_code: int = 3) -> list[int]:
        if function_code not in {3, 4}:
            raise ValueError("Solo se soportan FC03 y FC04 en V1 read-only.")
        if not 0 <= start_address <= 0xFFFF:
            raise ValueError("start_address fuera de rango.")
        if not 1 <= quantity <= 125:
            raise ValueError("quantity debe estar entre 1 y 125.")

        request = append_crc(struct.pack(">BBHH", self.settings.slave_id, function_code, start_address, quantity))
        port = self._open()
        try:
            port.reset_input_buffer()
            time.sleep(self._silent_interval_seconds())
            written = port.write(request)
            if written != len(request):
                raise ModbusError("No se transmitió el frame RTU completo.")
            port.flush()

            header = port.read(3)
            if len(header) != 3:
                raise ModbusTimeout("Timeout esperando cabecera Modbus RTU.")
            slave_id, response_function, byte_count = header

            if response_function == (function_code | 0x80):
                remainder = port.read(2)
                frame = header + remainder
                if len(frame) != 5:
                    raise ModbusTimeout("Respuesta de excepción Modbus incompleta.")
                if not validate_crc(frame):
                    raise ModbusCrcError("CRC inválido en respuesta de excepción.")
                raise ModbusExceptionResponse(function_code, byte_count)

            expected_bytes = quantity * 2
            if slave_id != self.settings.slave_id:
                raise ModbusError("Respuesta recibida desde un slave_id distinto.")
            if response_function != function_code:
                raise ModbusError("Function code inesperado en respuesta Modbus.")
            if byte_count != expected_bytes:
                raise ModbusError(f"Byte count inválido: esperado {expected_bytes}, recibido {byte_count}.")

            tail = port.read(byte_count + 2)
            if len(tail) != byte_count + 2:
                raise ModbusTimeout("Respuesta Modbus RTU incompleta.")
            frame = header + tail
            if not validate_crc(frame):
                raise ModbusCrcError("CRC inválido en respuesta Modbus RTU.")
            return list(struct.unpack(">" + ("H" * quantity), tail[:-2]))
        finally:
            port.close()
