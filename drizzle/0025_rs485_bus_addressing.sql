ALTER TABLE "gateway_device_bindings"
  ADD COLUMN IF NOT EXISTS "interface_key" varchar(64),
  ADD COLUMN IF NOT EXISTS "address" smallint,
  ADD COLUMN IF NOT EXISTS "baud_rate" integer,
  ADD COLUMN IF NOT EXISTS "parity" varchar(8),
  ADD COLUMN IF NOT EXISTS "data_bits" smallint,
  ADD COLUMN IF NOT EXISTS "stop_bits" smallint;

UPDATE "gateway_device_bindings" AS gdb
SET
  "interface_key" = COALESCE(
    NULLIF(left(trim(gdb."config"->>'interfaceKey'), 64), ''),
    CASE WHEN gdb."interface_type" = 'rs485' THEN 'rs485-1' ELSE NULL END
  ),
  "address" = COALESCE(
    CASE WHEN (gdb."config"->>'unitId') ~ '^[0-9]+
FROM "devices" AS d
WHERE d."id" = gdb."device_id"
  AND gdb."interface_type" = 'rs485';

ALTER TABLE "gateway_device_bindings"
  ADD CONSTRAINT "gateway_device_bindings_address_chk"
    CHECK ("address" IS NULL OR "address" BETWEEN 1 AND 247),
  ADD CONSTRAINT "gateway_device_bindings_baud_chk"
    CHECK ("baud_rate" IS NULL OR "baud_rate" BETWEEN 1200 AND 115200),
  ADD CONSTRAINT "gateway_device_bindings_parity_chk"
    CHECK ("parity" IS NULL OR "parity" IN ('none', 'even', 'odd')),
  ADD CONSTRAINT "gateway_device_bindings_data_bits_chk"
    CHECK ("data_bits" IS NULL OR "data_bits" BETWEEN 5 AND 8),
  ADD CONSTRAINT "gateway_device_bindings_stop_bits_chk"
    CHECK ("stop_bits" IS NULL OR "stop_bits" BETWEEN 1 AND 2),
  ADD CONSTRAINT "gateway_device_bindings_rs485_scope_chk"
    CHECK (
      "interface_type" <> 'rs485'
      OR (
        "interface_key" IS NOT NULL
        AND length(trim("interface_key")) > 0
        AND "address" IS NOT NULL
      )
    );

CREATE UNIQUE INDEX IF NOT EXISTS "gateway_device_bindings_rs485_address_uidx"
  ON "gateway_device_bindings" ("gateway_id", "interface_key", "address")
  WHERE "interface_type" = 'rs485' AND "enabled" = true;

CREATE INDEX IF NOT EXISTS "gateway_device_bindings_rs485_bus_idx"
  ON "gateway_device_bindings" ("gateway_id", "interface_key")
  WHERE "interface_type" = 'rs485' AND "enabled" = true;
 THEN (gdb."config"->>'unitId')::smallint ELSE NULL END,
    d."unit_id"
  ),
  "baud_rate" = CASE WHEN (gdb."config"->>'baudRate') ~ '^[0-9]+
FROM "devices" AS d
WHERE d."id" = gdb."device_id"
  AND gdb."interface_type" = 'rs485';

ALTER TABLE "gateway_device_bindings"
  ADD CONSTRAINT "gateway_device_bindings_address_chk"
    CHECK ("address" IS NULL OR "address" BETWEEN 1 AND 247),
  ADD CONSTRAINT "gateway_device_bindings_baud_chk"
    CHECK ("baud_rate" IS NULL OR "baud_rate" BETWEEN 1200 AND 115200),
  ADD CONSTRAINT "gateway_device_bindings_parity_chk"
    CHECK ("parity" IS NULL OR "parity" IN ('none', 'even', 'odd')),
  ADD CONSTRAINT "gateway_device_bindings_data_bits_chk"
    CHECK ("data_bits" IS NULL OR "data_bits" BETWEEN 5 AND 8),
  ADD CONSTRAINT "gateway_device_bindings_stop_bits_chk"
    CHECK ("stop_bits" IS NULL OR "stop_bits" BETWEEN 1 AND 2),
  ADD CONSTRAINT "gateway_device_bindings_rs485_scope_chk"
    CHECK (
      "interface_type" <> 'rs485'
      OR (
        "interface_key" IS NOT NULL
        AND length(trim("interface_key")) > 0
        AND "address" IS NOT NULL
      )
    );

CREATE UNIQUE INDEX IF NOT EXISTS "gateway_device_bindings_rs485_address_uidx"
  ON "gateway_device_bindings" ("gateway_id", "interface_key", "address")
  WHERE "interface_type" = 'rs485' AND "enabled" = true;

CREATE INDEX IF NOT EXISTS "gateway_device_bindings_rs485_bus_idx"
  ON "gateway_device_bindings" ("gateway_id", "interface_key")
  WHERE "interface_type" = 'rs485' AND "enabled" = true;
 THEN (gdb."config"->>'baudRate')::integer ELSE NULL END,
  "parity" = CASE WHEN lower(gdb."config"->>'parity') IN ('none', 'even', 'odd') THEN lower(gdb."config"->>'parity') ELSE NULL END,
  "data_bits" = CASE WHEN (gdb."config"->>'dataBits') ~ '^[0-9]+
FROM "devices" AS d
WHERE d."id" = gdb."device_id"
  AND gdb."interface_type" = 'rs485';

ALTER TABLE "gateway_device_bindings"
  ADD CONSTRAINT "gateway_device_bindings_address_chk"
    CHECK ("address" IS NULL OR "address" BETWEEN 1 AND 247),
  ADD CONSTRAINT "gateway_device_bindings_baud_chk"
    CHECK ("baud_rate" IS NULL OR "baud_rate" BETWEEN 1200 AND 115200),
  ADD CONSTRAINT "gateway_device_bindings_parity_chk"
    CHECK ("parity" IS NULL OR "parity" IN ('none', 'even', 'odd')),
  ADD CONSTRAINT "gateway_device_bindings_data_bits_chk"
    CHECK ("data_bits" IS NULL OR "data_bits" BETWEEN 5 AND 8),
  ADD CONSTRAINT "gateway_device_bindings_stop_bits_chk"
    CHECK ("stop_bits" IS NULL OR "stop_bits" BETWEEN 1 AND 2),
  ADD CONSTRAINT "gateway_device_bindings_rs485_scope_chk"
    CHECK (
      "interface_type" <> 'rs485'
      OR (
        "interface_key" IS NOT NULL
        AND length(trim("interface_key")) > 0
        AND "address" IS NOT NULL
      )
    );

CREATE UNIQUE INDEX IF NOT EXISTS "gateway_device_bindings_rs485_address_uidx"
  ON "gateway_device_bindings" ("gateway_id", "interface_key", "address")
  WHERE "interface_type" = 'rs485' AND "enabled" = true;

CREATE INDEX IF NOT EXISTS "gateway_device_bindings_rs485_bus_idx"
  ON "gateway_device_bindings" ("gateway_id", "interface_key")
  WHERE "interface_type" = 'rs485' AND "enabled" = true;
 THEN (gdb."config"->>'dataBits')::smallint ELSE NULL END,
  "stop_bits" = CASE WHEN (gdb."config"->>'stopBits') ~ '^[0-9]+
FROM "devices" AS d
WHERE d."id" = gdb."device_id"
  AND gdb."interface_type" = 'rs485';

ALTER TABLE "gateway_device_bindings"
  ADD CONSTRAINT "gateway_device_bindings_address_chk"
    CHECK ("address" IS NULL OR "address" BETWEEN 1 AND 247),
  ADD CONSTRAINT "gateway_device_bindings_baud_chk"
    CHECK ("baud_rate" IS NULL OR "baud_rate" BETWEEN 1200 AND 115200),
  ADD CONSTRAINT "gateway_device_bindings_parity_chk"
    CHECK ("parity" IS NULL OR "parity" IN ('none', 'even', 'odd')),
  ADD CONSTRAINT "gateway_device_bindings_data_bits_chk"
    CHECK ("data_bits" IS NULL OR "data_bits" BETWEEN 5 AND 8),
  ADD CONSTRAINT "gateway_device_bindings_stop_bits_chk"
    CHECK ("stop_bits" IS NULL OR "stop_bits" BETWEEN 1 AND 2),
  ADD CONSTRAINT "gateway_device_bindings_rs485_scope_chk"
    CHECK (
      "interface_type" <> 'rs485'
      OR (
        "interface_key" IS NOT NULL
        AND length(trim("interface_key")) > 0
        AND "address" IS NOT NULL
      )
    );

CREATE UNIQUE INDEX IF NOT EXISTS "gateway_device_bindings_rs485_address_uidx"
  ON "gateway_device_bindings" ("gateway_id", "interface_key", "address")
  WHERE "interface_type" = 'rs485' AND "enabled" = true;

CREATE INDEX IF NOT EXISTS "gateway_device_bindings_rs485_bus_idx"
  ON "gateway_device_bindings" ("gateway_id", "interface_key")
  WHERE "interface_type" = 'rs485' AND "enabled" = true;
 THEN (gdb."config"->>'stopBits')::smallint ELSE NULL END
FROM "devices" AS d
WHERE d."id" = gdb."device_id"
  AND gdb."interface_type" = 'rs485';

ALTER TABLE "gateway_device_bindings"
  ADD CONSTRAINT "gateway_device_bindings_address_chk"
    CHECK ("address" IS NULL OR "address" BETWEEN 1 AND 247),
  ADD CONSTRAINT "gateway_device_bindings_baud_chk"
    CHECK ("baud_rate" IS NULL OR "baud_rate" BETWEEN 1200 AND 115200),
  ADD CONSTRAINT "gateway_device_bindings_parity_chk"
    CHECK ("parity" IS NULL OR "parity" IN ('none', 'even', 'odd')),
  ADD CONSTRAINT "gateway_device_bindings_data_bits_chk"
    CHECK ("data_bits" IS NULL OR "data_bits" BETWEEN 5 AND 8),
  ADD CONSTRAINT "gateway_device_bindings_stop_bits_chk"
    CHECK ("stop_bits" IS NULL OR "stop_bits" BETWEEN 1 AND 2),
  ADD CONSTRAINT "gateway_device_bindings_rs485_scope_chk"
    CHECK (
      "interface_type" <> 'rs485'
      OR (
        "interface_key" IS NOT NULL
        AND length(trim("interface_key")) > 0
        AND "address" IS NOT NULL
      )
    );

CREATE UNIQUE INDEX IF NOT EXISTS "gateway_device_bindings_rs485_address_uidx"
  ON "gateway_device_bindings" ("gateway_id", "interface_key", "address")
  WHERE "interface_type" = 'rs485' AND "enabled" = true;

CREATE INDEX IF NOT EXISTS "gateway_device_bindings_rs485_bus_idx"
  ON "gateway_device_bindings" ("gateway_id", "interface_key")
  WHERE "interface_type" = 'rs485' AND "enabled" = true;


CREATE OR REPLACE FUNCTION "enforce_rs485_bus_serial_consistency"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."interface_type" = 'rs485' AND NEW."enabled" = true THEN
    IF EXISTS (
      SELECT 1
      FROM "gateway_device_bindings" AS peer
      WHERE peer."gateway_id" = NEW."gateway_id"
        AND peer."interface_type" = 'rs485'
        AND peer."enabled" = true
        AND peer."interface_key" = NEW."interface_key"
        AND peer."id" <> NEW."id"
        AND (
          (peer."baud_rate" IS NOT NULL AND NEW."baud_rate" IS NOT NULL AND peer."baud_rate" <> NEW."baud_rate")
          OR (peer."parity" IS NOT NULL AND NEW."parity" IS NOT NULL AND peer."parity" <> NEW."parity")
          OR (peer."data_bits" IS NOT NULL AND NEW."data_bits" IS NOT NULL AND peer."data_bits" <> NEW."data_bits")
          OR (peer."stop_bits" IS NOT NULL AND NEW."stop_bits" IS NOT NULL AND peer."stop_bits" <> NEW."stop_bits")
        )
    ) THEN
      RAISE EXCEPTION 'RS485 bus % has incompatible serial settings', NEW."interface_key"
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "gateway_device_bindings_rs485_serial_guard" ON "gateway_device_bindings";
CREATE TRIGGER "gateway_device_bindings_rs485_serial_guard"
BEFORE INSERT OR UPDATE OF "gateway_id", "interface_type", "interface_key", "enabled", "baud_rate", "parity", "data_bits", "stop_bits"
ON "gateway_device_bindings"
FOR EACH ROW
EXECUTE FUNCTION "enforce_rs485_bus_serial_consistency"();
