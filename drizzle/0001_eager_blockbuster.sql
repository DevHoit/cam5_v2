CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(60) NOT NULL,
	"name" varchar(180) NOT NULL,
	"legal_name" varchar(220),
	"tax_id" varchar(40),
	"contact_email" varchar(320),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "clients_code_uidx" ON "clients" USING btree ("code");--> statement-breakpoint
CREATE INDEX "clients_active_idx" ON "clients" USING btree ("active");--> statement-breakpoint
INSERT INTO "clients" ("id", "code", "name")
VALUES ('00000000-0000-4000-8000-000000000001', 'CLIENTE-PRINCIPAL', 'Cliente principal')
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD COLUMN "active_site_id" uuid;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "client_id" uuid;--> statement-breakpoint
UPDATE "sites"
SET "client_id" = (SELECT "id" FROM "clients" WHERE "code" = 'CLIENTE-PRINCIPAL' LIMIT 1)
WHERE "client_id" IS NULL;--> statement-breakpoint
ALTER TABLE "sites" ALTER COLUMN "client_id" SET NOT NULL;--> statement-breakpoint
DROP INDEX "sites_code_uidx";--> statement-breakpoint
DROP INDEX "sites_active_idx";--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_active_site_id_sites_id_fk" FOREIGN KEY ("active_site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_sessions_active_site_idx" ON "auth_sessions" USING btree ("active_site_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sites_client_code_uidx" ON "sites" USING btree ("client_id","code");--> statement-breakpoint
CREATE INDEX "sites_client_active_idx" ON "sites" USING btree ("client_id","active");--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_cam5_device_site_consistency()
RETURNS trigger AS $$
DECLARE
  point_site_id uuid;
  gateway_site_id uuid;
BEGIN
  SELECT site_id INTO point_site_id FROM assets WHERE id = NEW.asset_id;
  SELECT site_id INTO gateway_site_id FROM gateways WHERE id = NEW.gateway_id;
  IF point_site_id IS NULL OR gateway_site_id IS NULL OR point_site_id IS DISTINCT FROM gateway_site_id THEN
    RAISE EXCEPTION 'El controlador, el gateway y el punto de medición deben pertenecer al mismo sitio.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER devices_site_consistency_trigger
BEFORE INSERT OR UPDATE OF asset_id, gateway_id ON devices
FOR EACH ROW EXECUTE FUNCTION enforce_cam5_device_site_consistency();
