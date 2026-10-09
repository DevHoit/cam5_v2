CREATE TABLE "preview_operational_schedulers" (
 "key" text PRIMARY KEY,
 "site_id" uuid NOT NULL REFERENCES "sites"("id"),
 "generation" uuid NOT NULL,
 "enabled" boolean NOT NULL DEFAULT false,
 "run_id" text,
 "cycle_count" integer NOT NULL DEFAULT 0,
 "last_execution" text,
 "last_started_at" timestamp with time zone,
 "last_completed_at" timestamp with time zone,
 "last_ok" boolean,
 "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
