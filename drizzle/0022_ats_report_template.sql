INSERT INTO "report_templates" ("site_id", "key", "name", "description", "definition", "active")
VALUES (
  NULL,
  'ats-summary',
  'Informe ATS',
  'Estado de fuentes, transferencia, carga, calidad de datos y alarmas de un ATS.',
  '{"domain":"ats","sections":["summary","controllers","metrics","alarms"]}'::jsonb,
  true
)
ON CONFLICT ("site_id", "key") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "definition" = EXCLUDED."definition",
  "active" = true,
  "updated_at" = now();