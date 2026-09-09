CREATE TABLE "user_channel_preferences" (
	"user_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"display_order" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_channel_preferences_user_id_channel_id_pk" PRIMARY KEY("user_id","channel_id"),
	CONSTRAINT "user_channel_preferences_order_chk" CHECK ("user_channel_preferences"."display_order" IS NULL OR "user_channel_preferences"."display_order" >= 0)
);
--> statement-breakpoint
ALTER TABLE "user_channel_preferences" ADD CONSTRAINT "user_channel_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_channel_preferences" ADD CONSTRAINT "user_channel_preferences_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_channel_preferences_channel_idx" ON "user_channel_preferences" USING btree ("channel_id");