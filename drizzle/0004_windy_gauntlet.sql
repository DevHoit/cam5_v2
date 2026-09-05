ALTER TABLE "assets" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "gateways" ADD COLUMN "active" boolean DEFAULT true NOT NULL;