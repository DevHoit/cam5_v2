CREATE TABLE "gateway_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" varchar(40) NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"signature" varchar(120) NOT NULL,
	"size_bytes" integer NOT NULL,
	"bundle" "bytea" NOT NULL,
	"notes" varchar(500),
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gateways" ADD COLUMN "target_release_id" uuid;--> statement-breakpoint
ALTER TABLE "gateways" ADD COLUMN "target_assigned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gateway_releases" ADD CONSTRAINT "gateway_releases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gateway_releases_version_uidx" ON "gateway_releases" USING btree ("version");--> statement-breakpoint
ALTER TABLE "gateways" ADD CONSTRAINT "gateways_target_release_id_gateway_releases_id_fk" FOREIGN KEY ("target_release_id") REFERENCES "public"."gateway_releases"("id") ON DELETE set null ON UPDATE no action;