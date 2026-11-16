-- Modbus TCP: el Unit ID solo distingue equipos dentro de una misma IP y puerto, así que dos CAM-5 con
-- Unit ID 1 en IPs distintas pueden compartir gateway. La ingestión identifica el controlador por su código.
-- Antes de aplicar en producción, esta consulta debe devolver 0 filas (códigos repetidos en un mismo gateway):
--   SELECT gateway_id, code, count(*) FROM devices GROUP BY 1, 2 HAVING count(*) > 1;
DROP INDEX IF EXISTS "devices_gateway_unit_uidx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "devices_gateway_endpoint_uidx" ON "devices" USING btree ("gateway_id","host","port","unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "devices_gateway_code_uidx" ON "devices" USING btree ("gateway_id","code");
