-- Medidores de energía leídos por un gateway (Modbus RTU / RS-485) que envía las mediciones ya decodificadas.
INSERT INTO "reading_profiles" ("key", "name", "description", "stale_after_seconds", "storage_interval_seconds", "heartbeat_interval_seconds", "diagnostic_interval_seconds", "raw_retention_days", "aggregate_retention_days")
VALUES ('energy-meter-v1', 'Medidor de energía', 'Medidores de tableros y empalmes: guarda una lectura por minuto y avisa si el medidor deja de reportar por 3 minutos.', 180, 60, 60, 3600, 31, 1825)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
INSERT INTO "device_models" ("code", "manufacturer", "name", "register_map_version", "protocol", "capabilities")
VALUES ('PM5330', 'Schneider Electric', 'PowerLogic PM5330', 'decoded-1', 'modbus_rtu', '{"temperatureInputs":0,"uhfInputs":0,"humidityInputs":0,"relayOutputs":2}'::jsonb)
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
INSERT INTO "register_definitions" ("model_id", "source_key", "human_reference", "name", "register_group", "metric", "scale_factor", "unit", "minimum_value", "maximum_value")
SELECT "device_models"."id", v.source_key, v.reference, v.name, v.register_group, v.metric, v.scale_factor, v.unit, v.minimum_value, v.maximum_value
FROM "device_models"
CROSS JOIN (VALUES
	('p_kw', 'P', 'Potencia activa', 'Potencia', 'active_power', 1::numeric, 'kW', -5000::numeric, 5000::numeric),
	('q_kvar', 'Q', 'Potencia reactiva', 'Potencia', 'reactive_power', 1::numeric, 'kvar', -5000::numeric, 5000::numeric),
	('s_kva', 'S', 'Potencia aparente', 'Potencia', 'apparent_power', 1::numeric, 'kVA', 0::numeric, 5000::numeric),
	('e_kwh', 'KWH', 'Energía activa', 'Energía', 'energy', 1::numeric, 'kWh', 0::numeric, 1000000000::numeric),
	('v_l1', 'VL1', 'Voltaje L1-N', 'Tensión', 'voltage', 1::numeric, 'V', 0::numeric, 600::numeric),
	('v_l2', 'VL2', 'Voltaje L2-N', 'Tensión', 'voltage', 1::numeric, 'V', 0::numeric, 600::numeric),
	('v_l3', 'VL3', 'Voltaje L3-N', 'Tensión', 'voltage', 1::numeric, 'V', 0::numeric, 600::numeric),
	('i_l1', 'IL1', 'Corriente L1', 'Corriente', 'current', 1::numeric, 'A', 0::numeric, 6000::numeric),
	('i_l2', 'IL2', 'Corriente L2', 'Corriente', 'current', 1::numeric, 'A', 0::numeric, 6000::numeric),
	('i_l3', 'IL3', 'Corriente L3', 'Corriente', 'current', 1::numeric, 'A', 0::numeric, 6000::numeric),
	('pf', 'FP', 'Factor de potencia', 'Calidad', 'power_factor', 1::numeric, '', -1::numeric, 1::numeric),
	('hz', 'HZ', 'Frecuencia', 'Calidad', 'frequency', 1::numeric, 'Hz', 40::numeric, 70::numeric)
) AS v(source_key, reference, name, register_group, metric, scale_factor, unit, minimum_value, maximum_value)
WHERE "device_models"."code" = 'PM5330'
ON CONFLICT DO NOTHING;
