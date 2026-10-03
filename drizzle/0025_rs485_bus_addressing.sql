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
    NULLIF(gdb."config"->>'interfaceKey', ''),
    CASE WHEN gdb."interface_type" = 'rs485' THEN 'rs485-1' ELSE NULL END
  ),
  "address" = COALESCE(
    NULLIF(gdb."config"->>'unitId', '')::smallint,
    d."unit_id"
  ),
  "baud_rate" = NULLIF(gdb."config"->>'baudRate', '')::integer,
  "parity" = NULLIF(lower(gdb."config"->>'parity'), ''),
  "data_bits" = NULLIF(gdb."config"->>'dataBits', '')::smallint,
  "stop_bits" = NULLIF(gdb."config"->>'stopBits', '')::smallint
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
