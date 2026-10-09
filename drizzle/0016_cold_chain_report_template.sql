INSERT INTO "report_templates" ("site_id", "key", "name", "description", "definition", "active")
VALUES (
  NULL,
  'cold-chain-summary',
  'Informe de cadena de frío',
  'Temperaturas, calidad de datos, excursiones y alarmas de una cámara de refrigeración.',
  '{"domain":"cold_chain","sections":["summary","sensors","excursions","alarms"]}'::jsonb,
  true
)
ON CONFLICT ("site_id", "key") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "definition" = EXCLUDED."definition",
  "active" = true,
  "updated_at" = now();