CREATE TABLE "detected_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gateway_id" uuid NOT NULL,
	"external_id" varchar(120) NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_count" integer DEFAULT 1 NOT NULL,
	"last_rssi" smallint,
	"last_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dismissed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "measurement_quantities" (
	"key" varchar(60) PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"unit" varchar(40) NOT NULL,
	"decimals" smallint DEFAULT 1 NOT NULL,
	"kind" varchar(16) DEFAULT 'gauge' NOT NULL,
	"builtin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "measurement_quantities_key_chk" CHECK ("measurement_quantities"."key" ~ '^[a-z][a-z0-9_]{1,59}$'),
	CONSTRAINT "measurement_quantities_kind_chk" CHECK ("measurement_quantities"."kind" IN ('gauge', 'counter', 'state')),
	CONSTRAINT "measurement_quantities_decimals_chk" CHECK ("measurement_quantities"."decimals" BETWEEN 0 AND 6)
);
--> statement-breakpoint
INSERT INTO "measurement_quantities" ("key", "name", "unit", "decimals", "kind", "builtin") VALUES
	('temperature', 'Temperatura', '°C', 1, 'gauge', true),
	('ambient_temperature', 'Temperatura ambiente', '°C', 1, 'gauge', true),
	('humidity', 'Humedad relativa', '%RH', 1, 'gauge', true),
	('partial_discharge', 'Descarga parcial', 'idx', 0, 'gauge', true),
	('surface_discharge', 'Descarga superficial', 'idx', 0, 'gauge', true),
	('noise', 'Ruido', 'idx', 0, 'gauge', true),
	('event_count', 'Eventos', 'eventos', 0, 'counter', true),
	('alpha', 'Alfa', 'idx', 0, 'gauge', true),
	('beta', 'Beta', 'idx', 0, 'gauge', true),
	('phi', 'Fase', 'idx', 0, 'gauge', true),
	('system', 'Sistema', '', 0, 'state', true),
	('battery', 'Batería', '%', 0, 'gauge', true),
	('battery_voltage', 'Voltaje de batería', 'V', 2, 'gauge', true),
	('signal_strength', 'Intensidad de señal', 'dBm', 0, 'gauge', true),
	('voltage', 'Voltaje', 'V', 1, 'gauge', true),
	('current', 'Corriente', 'A', 1, 'gauge', true),
	('active_power', 'Potencia activa', 'kW', 2, 'gauge', true),
	('reactive_power', 'Potencia reactiva', 'kvar', 2, 'gauge', true),
	('apparent_power', 'Potencia aparente', 'kVA', 2, 'gauge', true),
	('power_factor', 'Factor de potencia', '', 2, 'gauge', true),
	('frequency', 'Frecuencia', 'Hz', 2, 'gauge', true),
	('energy', 'Energía activa', 'kWh', 1, 'counter', true),
	('pressure', 'Presión', 'bar', 2, 'gauge', true),
	('state', 'Estado', '', 0, 'state', true)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "channels" ALTER COLUMN "metric" SET DATA TYPE varchar(60) USING "metric"::text;--> statement-breakpoint
ALTER TABLE "register_definitions" ALTER COLUMN "native_register" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "register_definitions" ALTER COLUMN "metric" SET DATA TYPE varchar(60) USING "metric"::text;--> statement-breakpoint
ALTER TABLE "register_definitions" ALTER COLUMN "data_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "device_models" ADD COLUMN "protocol" varchar(24) DEFAULT 'modbus_tcp' NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "external_id" varchar(120);--> statement-breakpoint
ALTER TABLE "register_definitions" ADD COLUMN "source_key" varchar(60);--> statement-breakpoint
ALTER TABLE "detected_devices" ADD CONSTRAINT "detected_devices_gateway_id_gateways_id_fk" FOREIGN KEY ("gateway_id") REFERENCES "public"."gateways"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "detected_devices_gateway_external_uidx" ON "detected_devices" USING btree ("gateway_id","external_id");--> statement-breakpoint
CREATE INDEX "detected_devices_gateway_seen_idx" ON "detected_devices" USING btree ("gateway_id","last_seen_at");--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_metric_measurement_quantities_key_fk" FOREIGN KEY ("metric") REFERENCES "public"."measurement_quantities"("key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "register_definitions" ADD CONSTRAINT "register_definitions_metric_measurement_quantities_key_fk" FOREIGN KEY ("metric") REFERENCES "public"."measurement_quantities"("key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "devices_gateway_external_uidx" ON "devices" USING btree ("gateway_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "register_model_source_key_uidx" ON "register_definitions" USING btree ("model_id","source_key");--> statement-breakpoint
ALTER TABLE "register_definitions" ADD CONSTRAINT "register_source_chk" CHECK (("register_definitions"."native_register" IS NOT NULL AND "register_definitions"."data_type" IS NOT NULL) OR "register_definitions"."source_key" IS NOT NULL);--> statement-breakpoint
DROP TYPE "public"."channel_metric";--> statement-breakpoint
INSERT INTO "reading_profiles" ("key", "name", "description", "stale_after_seconds", "storage_interval_seconds", "heartbeat_interval_seconds", "diagnostic_interval_seconds", "raw_retention_days", "aggregate_retention_days")
VALUES ('ble-beacon-v1', 'Beacon BLE', 'Beacons leídos por un mini gateway Wi-Fi: guarda una lectura por minuto y avisa si el beacon deja de reportar por 5 minutos.', 300, 60, 60, 3600, 7, 1825)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
INSERT INTO "device_models" ("code", "manufacturer", "name", "register_map_version", "protocol", "capabilities")
VALUES ('BLE-KKM-TH', 'KKM', 'Beacon BLE temperatura y humedad (KBeacon/KSensor)', 'ble-esp32-1', 'ble', '{"temperatureInputs":0,"uhfInputs":0,"humidityInputs":0,"relayOutputs":0}'::jsonb)
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
INSERT INTO "register_definitions" ("model_id", "source_key", "human_reference", "name", "register_group", "metric", "scale_factor", "unit", "minimum_value", "maximum_value")
SELECT "device_models"."id", v.source_key, v.reference, v.name, v.register_group, v.metric, v.scale_factor, v.unit, v.minimum_value, v.maximum_value
FROM "device_models"
CROSS JOIN (VALUES
	('temperature', 'TEMP', 'Temperatura', 'Medición', 'temperature', 1::numeric, '°C', -40::numeric, 85::numeric),
	('humidity', 'HR', 'Humedad relativa', 'Medición', 'humidity', 1::numeric, '%RH', 0::numeric, 100::numeric),
	('battery_percent', 'BAT', 'Batería', 'Equipo', 'battery', 1::numeric, '%', 0::numeric, 100::numeric),
	('battery_mv', 'VBAT', 'Voltaje de batería', 'Equipo', 'battery_voltage', 0.001::numeric, 'V', 0::numeric, 5::numeric),
	('rssi', 'RSSI', 'Señal BLE', 'Equipo', 'signal_strength', 1::numeric, 'dBm', -120::numeric, 0::numeric)
) AS v(source_key, reference, name, register_group, metric, scale_factor, unit, minimum_value, maximum_value)
WHERE "device_models"."code" = 'BLE-KKM-TH'
ON CONFLICT DO NOTHING;
