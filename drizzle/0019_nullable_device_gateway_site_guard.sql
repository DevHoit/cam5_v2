CREATE OR REPLACE FUNCTION enforce_cam5_device_site_consistency()
RETURNS trigger AS $$
DECLARE
  point_site_id uuid;
  gateway_site_id uuid;
BEGIN
  SELECT site_id INTO point_site_id FROM assets WHERE id = NEW.asset_id;
  IF point_site_id IS NULL THEN
    RAISE EXCEPTION 'El dispositivo debe pertenecer a un punto de medición válido.';
  END IF;

  IF NEW.gateway_id IS NOT NULL THEN
    SELECT site_id INTO gateway_site_id FROM gateways WHERE id = NEW.gateway_id;
    IF gateway_site_id IS NULL OR point_site_id IS DISTINCT FROM gateway_site_id THEN
      RAISE EXCEPTION 'El controlador, el gateway y el punto de medición deben pertenecer al mismo sitio.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;