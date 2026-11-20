CREATE TABLE "point_types" (
	"key" varchar(80) PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"system" varchar(24) NOT NULL,
	"primary_quantity" varchar(60),
	"aggregation" varchar(8) DEFAULT 'max' NOT NULL,
	"default_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"display_order" smallint DEFAULT 100 NOT NULL,
	"builtin" boolean DEFAULT false NOT NULL,
	CONSTRAINT "point_types_system_chk" CHECK ("point_types"."system" IN ('condition', 'cold', 'energy', 'backup', 'other')),
	CONSTRAINT "point_types_aggregation_chk" CHECK ("point_types"."aggregation" IN ('max', 'min', 'avg', 'sum', 'last'))
);
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "config" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "role" varchar(16) DEFAULT 'process' NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "position" varchar(80);--> statement-breakpoint
ALTER TABLE "measurement_quantities" ADD COLUMN "default_role" varchar(16) DEFAULT 'process' NOT NULL;--> statement-breakpoint
ALTER TABLE "register_definitions" ADD COLUMN "channel_role" varchar(16);--> statement-breakpoint
INSERT INTO "point_types" ("key", "name", "system", "primary_quantity", "aggregation", "default_config", "display_order", "builtin") VALUES
	('switchgear_cabinet', 'Celda de media tensión', 'condition', 'temperature', 'max', '{}'::jsonb, 10, true),
	('cold_room', 'Cámara de refrigeración', 'cold', 'temperature', 'max', '{"rangeMin":0,"rangeMax":5,"toleranceMinutes":10}'::jsonb, 20, true),
	('freezer', 'Cámara de congelados', 'cold', 'temperature', 'max', '{"rangeMin":null,"rangeMax":-18,"toleranceMinutes":15}'::jsonb, 21, true),
	('electrical_panel', 'Tablero eléctrico', 'energy', 'active_power', 'sum', '{}'::jsonb, 30, true),
	('transfer_switch', 'Transferencia red/grupo', 'energy', 'state', 'last', '{}'::jsonb, 31, true),
	('ups', 'UPS', 'backup', 'battery', 'min', '{}'::jsonb, 40, true),
	('generic', 'Otro punto de medición', 'other', NULL, 'max', '{}'::jsonb, 90, true)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
UPDATE "assets" SET "asset_type" = 'generic' WHERE "asset_type" NOT IN (SELECT "key" FROM "point_types");--> statement-breakpoint
UPDATE "measurement_quantities" SET "default_role" = 'health' WHERE "key" IN ('battery_voltage', 'signal_strength');--> statement-breakpoint
UPDATE "register_definitions" SET "channel_role" = 'health'
	WHERE "source_key" IN ('battery_percent', 'battery_mv', 'rssi')
	AND "model_id" IN (SELECT "id" FROM "device_models" WHERE "code" = 'BLE-KKM-TH');--> statement-breakpoint
UPDATE "channels" SET "role" = 'health'
	FROM "register_definitions"
	WHERE "register_definitions"."id" = "channels"."register_definition_id" AND "register_definitions"."channel_role" = 'health';--> statement-breakpoint
ALTER TABLE "point_types" ADD CONSTRAINT "point_types_primary_quantity_measurement_quantities_key_fk" FOREIGN KEY ("primary_quantity") REFERENCES "public"."measurement_quantities"("key") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_asset_type_point_types_key_fk" FOREIGN KEY ("asset_type") REFERENCES "public"."point_types"("key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_role_chk" CHECK ("channels"."role" IN ('process', 'health', 'diagnostic'));--> statement-breakpoint
ALTER TABLE "measurement_quantities" ADD CONSTRAINT "measurement_quantities_role_chk" CHECK ("measurement_quantities"."default_role" IN ('process', 'health', 'diagnostic'));