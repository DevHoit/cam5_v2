CREATE TABLE "user_client_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_client_assignments" ADD CONSTRAINT "user_client_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_client_assignments" ADD CONSTRAINT "user_client_assignments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_client_assignments" ADD CONSTRAINT "user_client_assignments_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_client_assignments" ADD CONSTRAINT "user_client_assignments_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_client_assignments_scope_uidx" ON "user_client_assignments" USING btree ("user_id","client_id");--> statement-breakpoint
CREATE INDEX "user_client_assignments_client_idx" ON "user_client_assignments" USING btree ("client_id","user_id");--> statement-breakpoint
INSERT INTO "user_client_assignments" ("user_id", "client_id", "role_id")
SELECT DISTINCT ON (ura."user_id", s."client_id") ura."user_id", s."client_id", ura."role_id"
FROM "user_role_assignments" ura
INNER JOIN "sites" s ON s."id" = ura."site_id"
INNER JOIN "roles" r ON r."id" = ura."role_id"
ORDER BY ura."user_id", s."client_id",
  CASE r."key" WHEN 'administrator' THEN 4 WHEN 'engineer' THEN 3 WHEN 'operator' THEN 2 ELSE 1 END DESC
ON CONFLICT ("user_id", "client_id") DO NOTHING;
