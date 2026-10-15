CREATE OR REPLACE FUNCTION "enforce_area_scope_consistency"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  site_client_id uuid;
  parent_client_id uuid;
  parent_site_id uuid;
BEGIN
  SELECT "client_id" INTO site_client_id
  FROM "sites"
  WHERE "id" = NEW."site_id";

  IF site_client_id IS NULL OR site_client_id IS DISTINCT FROM NEW."client_id" THEN
    RAISE EXCEPTION 'Area client_id must match the site client_id';
  END IF;

  IF NEW."parent_area_id" IS NOT NULL THEN
    SELECT "client_id", "site_id"
      INTO parent_client_id, parent_site_id
    FROM "areas"
    WHERE "id" = NEW."parent_area_id";

    IF parent_client_id IS NULL
      OR parent_client_id IS DISTINCT FROM NEW."client_id"
      OR parent_site_id IS DISTINCT FROM NEW."site_id" THEN
      RAISE EXCEPTION 'Parent area must belong to the same client and site';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "areas_scope_consistency_trg" ON "areas";
--> statement-breakpoint
CREATE TRIGGER "areas_scope_consistency_trg"
BEFORE INSERT OR UPDATE OF "client_id", "site_id", "parent_area_id"
ON "areas"
FOR EACH ROW
EXECUTE FUNCTION "enforce_area_scope_consistency"();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "enforce_asset_area_consistency"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  area_site_id uuid;
BEGIN
  IF NEW."area_id" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "site_id" INTO area_site_id
  FROM "areas"
  WHERE "id" = NEW."area_id";

  IF area_site_id IS NULL OR area_site_id IS DISTINCT FROM NEW."site_id" THEN
    RAISE EXCEPTION 'Asset area_id must belong to the same site';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "assets_area_consistency_trg" ON "assets";
--> statement-breakpoint
CREATE TRIGGER "assets_area_consistency_trg"
BEFORE INSERT OR UPDATE OF "site_id", "area_id"
ON "assets"
FOR EACH ROW
EXECUTE FUNCTION "enforce_asset_area_consistency"();
