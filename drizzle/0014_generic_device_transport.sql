ALTER TABLE "devices" ALTER COLUMN "gateway_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ALTER COLUMN "model_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ALTER COLUMN "host" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ALTER COLUMN "port" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "devices" ALTER COLUMN "port" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ALTER COLUMN "unit_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "devices" ALTER COLUMN "unit_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" DROP CONSTRAINT IF EXISTS "devices_gateway_id_gateways_id_fk";--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_gateway_id_gateways_id_fk" FOREIGN KEY ("gateway_id") REFERENCES "public"."gateways"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" DROP CONSTRAINT IF EXISTS "devices_model_id_device_models_id_fk";--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_model_id_device_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."device_models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" DROP CONSTRAINT IF EXISTS "devices_port_chk";--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_port_chk" CHECK ("port" IS NULL OR "port" BETWEEN 1 AND 65535);--> statement-breakpoint
ALTER TABLE "devices" DROP CONSTRAINT IF EXISTS "devices_unit_id_chk";--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_unit_id_chk" CHECK ("unit_id" IS NULL OR "unit_id" BETWEEN 0 AND 247);