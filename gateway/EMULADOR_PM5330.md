# Emulador de medidores PM5330 (Raspberry Pi)

`gateway/tools/pm5330_emulator.py` envía a HoitLive Core mediciones de PM5330 simuladas, con el mismo
formato que usará el gateway real que lea los medidores por RS-485. Sirve para ver empalmes y tableros
con datos (potencia, energía, tensiones, corrientes, factor de potencia y frecuencia) mientras no
está instalado el equipo.

- Solo necesita Python 3 (viene con Raspberry Pi OS). No usa `pip`.
- La curva sigue la hora de Chile: carga base de noche, climatización de día y punta de mediodía.
- La energía (kWh) se guarda en `emulador-estado.json`: el contador no retrocede al reiniciar.
- Sin red, guarda hasta 2 h de envíos y los reenvía en orden cuando vuelve la conexión.
- Cada envío lleva `health.emulated = true` y `fw = emulador-pm5330-1.0`.

Los datos son simulados. Úsalo en puntos de prueba y elimina esos equipos antes de instalar los
medidores reales.

## 1. En el portal (una vez por sitio)

El gateway pertenece a un sitio. Si cada empalme es un sitio, crea un gateway y un token por sitio.

1. Ponte en el sitio (Estructura › clic en el sitio).
2. **Punto:** Agregar elemento › Punto de medición › tipo **Tablero eléctrico**
   (por ejemplo `EMP-INF` · Empalme Infante).
3. **Gateway:** Agregar elemento › Gateway › código, por ejemplo `HOIT-EMU-INF01`.
4. **Token:** Gateways › Nueva credencial › ese gateway › Generar token. Copia el token (`cam5gw_…`).

## 2. En la Raspberry

```bash
sudo mkdir -p /opt/hoit-emulador
sudo cp pm5330_emulator.py /opt/hoit-emulador/
sudo nano /opt/hoit-emulador/emulador.json
```

```json
{
  "url": "https://core.hoitlive.com/api/v2/gateway/ingest",
  "interval_s": 30,
  "gateways": [
    { "code": "HOIT-EMU-INF01", "token": "cam5gw_…", "meters": [{ "id": "PM5330-INF", "profile": "infante" }] },
    { "code": "HOIT-EMU-RAN01", "token": "cam5gw_…", "meters": [{ "id": "PM5330-RAN", "profile": "rancagua" }] }
  ]
}
```

```bash
sudo chmod 600 /opt/hoit-emulador/emulador.json
python3 /opt/hoit-emulador/pm5330_emulator.py --config /opt/hoit-emulador/emulador.json --dry-run
sudo python3 /opt/hoit-emulador/pm5330_emulator.py --config /opt/hoit-emulador/emulador.json --once
```

`--once` debe mostrar `202` por gateway. Un `401` es un token mal copiado; un `403`, un código de
gateway distinto del creado en el portal.

Perfiles: `infante`, `rancagua` y `tablero`. Cada medidor puede ajustar valores del perfil, por
ejemplo `{ "id": "PM5330-TG", "profile": "tablero", "base_kw": 40, "pf": 0.91 }`
(`base_kw`, `day_kw`, `peak_kw`, `pf`, `unbalance`, `v_offset`, `energy_kwh`).

## 3. Asignar los medidores

Con el primer envío, cada medidor aparece en **Gateways › Equipos detectados** (`PM5330-INF`, …).
Asígnalo con **Asignar**:

- Punto de medición: el empalme.
- Plantilla: **PowerLogic PM5330**.
- Posición: por ejemplo `Acometida`.

Desde ese momento el punto muestra potencia, demanda máxima, energía del día y calidad de energía.

## 4. Dejarlo como servicio

```bash
sudo tee /etc/systemd/system/hoit-emulador.service > /dev/null <<'EOF'
[Unit]
Description=HoitLive emulador PM5330
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/bin/python3 /opt/hoit-emulador/pm5330_emulator.py --config /opt/hoit-emulador/emulador.json
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now hoit-emulador
journalctl -u hoit-emulador -f
```

Para detenerlo: `sudo systemctl disable --now hoit-emulador`.
