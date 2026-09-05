import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const html = await readFile(
    new URL("../.next/server/app/index.html", import.meta.url),
    "utf8",
  );

  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

test("server-renders the CAM5 operational portal", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>CAM5 CORE \| Gestión de Activos Críticos<\/title>/i);
  assert.match(html, /Resumen operativo/);
  assert.match(html, /Mapa de condición/);
  assert.match(html, /Centro de alertas/);
  assert.match(html, /Activos y ubicaciones/);
  assert.match(html, /Reportes/);
  assert.match(html, /Mantenimiento/);
  assert.match(html, /Integraciones/);
  assert.match(html, /Configuración/);
});

test("keeps the production portal free of starter preview code", async () => {
  const [page, layout, css, packageJson, engineering, model] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/cam5-engineering.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/cam5-model.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /function ReportsView\(\)/);
  assert.match(page, /function AssetsView\(\{ onNavigate \}/);
  assert.match(page, /function MaintenanceView\(/);
  assert.match(page, /function IntegrationsView\(\)/);
  assert.match(page, /function DiagnosticsView\(\)/);
  assert.match(page, /Diagnóstico OT/);
  assert.match(page, /Comprobación de extremo a extremo/);
  assert.match(page, /Crear orden de trabajo/);
  assert.match(page, /sourceAlarmId/);
  assert.match(page, /Orden abierta desde el Centro de alertas/);
  assert.match(page, /closedAlarmIds/);
  assert.match(page, /alarmNotes/);
  assert.match(page, /Intervención completada/);
  assert.match(page, /usePersistentState/);
  assert.match(page, /portal-notice/);
  assert.match(page, /Piloto monositio/);
  assert.match(page, /function useSensorData/);
  assert.match(page, /URLSearchParams/);
  assert.match(page, /report-preview/);
  assert.match(page, /ConfirmContext/);
  assert.match(page, /Datos atrasados/);
  assert.match(page, /Vista por rol/);
  assert.match(page, /CAM5-CTRL-01/);
  assert.match(page, /CAM5-GW-01/);
  assert.match(page, /Subestación Norte/);
  assert.match(page, /Modbus TCP/);
  assert.match(page, /Mapa de registros Modbus/);
  assert.match(engineering, /Mapa oficial incorporado al frontend/);
  assert.match(engineering, /Ver mapa 418–522/);
  assert.match(model, /const humanReference/);
  assert.match(model, /registerDefinition\(418/);
  assert.match(model, /cam5RegisterCatalog/);
  assert.match(model, /cam5InputInventory/);
  assert.doesNotMatch(page, /CAM5-GW-0[234]|Subestación Auxiliar|2 subestaciones/);
  assert.match(layout, /CAM5 CORE \| Gestión de Activos Críticos/);
  assert.match(css, /\.report-builder/);
  assert.match(css, /\.asset-management-layout/);
  assert.match(css, /\.maintenance-plan-grid/);
  assert.match(css, /\.integration-card-grid/);
  assert.match(css, /\.register-map-table/);
  assert.match(css, /\.diagnostic-chain/);
  assert.match(css, /\.commissioning-summary/);
  assert.match(css, /\.register-reference-table/);
  assert.match(css, /\.focused-order/);
  assert.match(css, /\.event-remediation-state/);
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
  assert.doesNotMatch(layout, /SkeletonPreview|codex-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});

test("includes the backend handoff contract", async () => {
  const [apiClient, openapi, handoff] = await Promise.all([
    readFile(new URL("../app/cam5-api.ts", import.meta.url), "utf8"),
    readFile(new URL("../handoff/CAM5-frontend-ready/openapi.yaml", import.meta.url), "utf8"),
    readFile(new URL("../handoff/CAM5-frontend-ready/BACKEND_INTEGRATION.md", import.meta.url), "utf8"),
  ]);
  assert.match(apiClient, /export const cam5Api/);
  assert.match(apiClient, /TelemetryReading/);
  assert.match(openapi, /openapi: 3\.1\.0/);
  assert.match(openapi, /\/assets\/\{assetId\}\/readings\/latest/);
  assert.match(handoff, /cam5\.front\.channel-config/);
});
