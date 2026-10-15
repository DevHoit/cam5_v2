INSERT INTO "report_templates" ("site_id", "key", "name", "description", "definition", "active")
VALUES (
  NULL,
  'electrical-summary',
  'Informe de monitoreo eléctrico',
  'Variables eléctricas, calidad de datos, consumo/energía y alarmas de un punto eléctrico.',
  '{"domain":"electrical","sections":["summary","meters","metrics","alarms"]}'::jsonb,
  true
)
ON CONFLICT ("site_id", "key") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "definition" = EXCLUDED."definition",
  "active" = true,
  "updated_at" = now();