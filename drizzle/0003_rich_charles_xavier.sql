CREATE TABLE "device_register_samples" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"batch_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"register_definition_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"raw_value" integer,
	"value" numeric(18, 6),
	"quality" "data_quality" NOT NULL,
	"quality_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sequence" bigint,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gateway_api_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gateway_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"token_prefix" varchar(24) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "device_register_samples" ADD CONSTRAINT "device_register_samples_batch_id_ingestion_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."ingestion_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_register_samples" ADD CONSTRAINT "device_register_samples_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_register_samples" ADD CONSTRAINT "device_register_samples_register_definition_id_register_definitions_id_fk" FOREIGN KEY ("register_definition_id") REFERENCES "public"."register_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_api_credentials" ADD CONSTRAINT "gateway_api_credentials_gateway_id_gateways_id_fk" FOREIGN KEY ("gateway_id") REFERENCES "public"."gateways"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_api_credentials" ADD CONSTRAINT "gateway_api_credentials_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "device_register_samples_batch_register_uidx" ON "device_register_samples" USING btree ("batch_id","register_definition_id");--> statement-breakpoint
CREATE INDEX "device_register_samples_device_time_idx" ON "device_register_samples" USING btree ("device_id","recorded_at");--> statement-breakpoint
CREATE INDEX "device_register_samples_register_time_idx" ON "device_register_samples" USING btree ("register_definition_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "gateway_api_credentials_token_hash_uidx" ON "gateway_api_credentials" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "gateway_api_credentials_gateway_idx" ON "gateway_api_credentials" USING btree ("gateway_id","revoked_at");