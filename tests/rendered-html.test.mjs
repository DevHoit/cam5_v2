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

test("server-renders the protected HoitLive Core access gate", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>HoitLive Core \| Monitoreo de condición eléctrica<\/title>/i);
  assert.match(html, /HoitLive Core/);
  assert.match(html, /Validando sesión/);
  assert.match(html, /Consultando sesión/);
});

test("keeps the production portal free of starter preview code", async () => {
  const [page, layout, css, packageJson, engineering, commissioningApi, commissioningEngine, model, alarmEngine, trends, notifications, notificationEngine, settings, configurationApi, gatewayConfigurationApi, reports, reportsApi, reportEngine, telemetryApi, diagnostics, diagnosticsApi] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/cam5-engineering.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/v1/commissioning/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/commissioning-engine.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/cam5-model.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/alarm-engine.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/trends-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/notifications-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../db/notification-engine.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/settings-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/v1/configuration/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/v1/gateway/config/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/reports-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/v1/reports/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/report-engine.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/v1/telemetry/latest/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/diagnostics-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/v1/diagnostics/route.ts", import.meta.url), "utf8"),
  ]);
  const [account, accountApi] = await Promise.all([
    readFile(new URL("../app/account-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/v1/account/route.ts", import.meta.url), "utf8"),
  ]);
  const [provisioning, provisioningApi, provisioningCredentialApi] = await Promise.all([
    readFile(new URL("../app/gateway-provisioning-view.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/v1/gateway-credentials/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/v1/gateway-credentials/[id]/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /ReportsView as DatabaseReportsView/);
  assert.match(page, /function OperationalHierarchyView\(/);
  assert.doesNotMatch(page, /view === "integrations"|id: "integrations"|function IntegrationsView/);
  assert.match(page, /DiagnosticsView as DatabaseDiagnosticsView/);
  assert.match(page, /Diagnóstico de comunicación/);
  assert.match(diagnostics, /Estado de extremo a extremo/);
  assert.match(diagnostics, /\/api\/v1\/diagnostics/);
  assert.match(diagnostics, /Diagnóstico pasivo y verificable/);
  assert.match(diagnostics, /<Pagination/);
  assert.doesNotMatch(diagnostics, /setTimeout|99\.98%|42 ms|86 ms|CAM5-CTRL-01|CAM5-GW-01/);
  assert.match(diagnosticsApi, /ingestionBatches/);
  assert.match(diagnosticsApi, /goodRegisters/);
  assert.match(diagnosticsApi, /percentile_cont/);
  assert.match(diagnosticsApi, /diagnostics\.refresh/);
  assert.match(diagnosticsApi, /mode: "passive"/);
  assert.doesNotMatch(page, /Crear orden de trabajo|function MaintenanceView\(|view === "maintenance"/);
  assert.match(page, /Reglas y umbrales/);
  assert.match(page, /Control contra falsos positivos/);
  assert.match(page, /\/api\/v1\/alarms/);
  assert.match(page, /\/api\/v1\/alarm-rules/);
  assert.doesNotMatch(page, /usePersistentState|cam5\.front\.integrations|cam5\.front\.api-keys/);
  assert.match(page, /portal-notice/);
  assert.match(page, /Estructura operacional/);
  assert.match(page, /Clientes, sitios y medición/);
  assert.match(page, /Administración operacional/);
  assert.match(page, /Eliminar definitivamente/);
  assert.match(page, /Elemento activo/);
  assert.match(page, /\/api\/v1\/hierarchy/);
  assert.match(page, /\/api\/v1\/auth\/context/);
  assert.match(page, /function useSensorData/);
  assert.match(page, /telemetry\.data\?\.items/);
  assert.match(page, /zone-channel-grid/);
  assert.match(page, /El gráfico aparecerá cuando PostgreSQL tenga muestras/);
  assert.match(page, /inputSummary\.total/);
  assert.doesNotMatch(page, /const chartData/);
  assert.match(page, /function LoginScreen/);
  assert.match(page, /\/api\/v1\/auth\/login/);
  assert.match(page, /\/api\/v1\/auth\/logout/);
  assert.match(page, /function HistoryView/);
  assert.match(page, /type="date"/);
  assert.match(page, /<Pagination/);
  assert.match(page, /Quitar acceso/);
  assert.match(page, /URLSearchParams/);
  assert.match(reports, /report-preview/);
  assert.match(page, /ConfirmContext/);
  assert.match(page, /Las lecturas están atrasadas/);
  assert.match(page, /Sesión activa/);
  assert.match(page, /AccountView/);
  assert.match(account, /Cambiar contraseña/);
  assert.match(account, /Sesiones activas/);
  assert.match(account, /Cerrar sesión remota/);
  assert.match(accountApi, /account\.profile\.update/);
  assert.match(accountApi, /account\.session\.revoke/);
  assert.match(accountApi, /verifyPassword/);
  assert.match(accountApi, /otherSessionsRevoked/);
  assert.match(page, /GatewayProvisioningView/);
  assert.match(page, /Provisionamiento del gateway/);
  assert.match(provisioning, /Descargar \.env/);
  assert.match(provisioning, /Rotar credencial/);
  assert.match(provisioning, /<Pagination/);
  assert.match(provisioningApi, /hashGatewayToken/);
  assert.match(provisioningApi, /gateway_credentials\.rotate/);
  assert.match(provisioningApi, /settings\.write/);
  assert.doesNotMatch(provisioningApi, /tokenHash: gatewayApiCredentials\.tokenHash/);
  assert.match(provisioningCredentialApi, /gateway_credentials\.revoke/);
  assert.doesNotMatch(page, /CAM5-CTRL-01|CAM5-GW-01|Subestación Norte/);
  assert.match(page, /activeController\?\.code/);
  assert.match(page, /gatewayCode/);
  assert.match(settings, /Modbus TCP/);
  assert.match(settings, /Mapa oficial de registros CAM5/);
  assert.match(settings, new RegExp("/api/v1/configuration"));
  assert.match(settings, /Versiones de configuración/);
  assert.match(configurationApi, /configurationSnapshots/);
  assert.match(configurationApi, /settings\.write/);
  assert.match(configurationApi, /pg_advisory_xact_lock/);
  assert.match(reports, /Biblioteca documental/);
  assert.match(reports, /Programaciones/);
  assert.match(reports, /\/api\/v1\/reports/);
  assert.match(reportsApi, /reports\.generate/);
  assert.match(reportsApi, /createReportRun/);
  assert.match(reportEngine, /payload: snapshot/);
  assert.match(telemetryApi, /physicalInputs/);
  assert.match(telemetryApi, /humanReference/);
  assert.match(telemetryApi, /inputSummary/);
  assert.match(telemetryApi, /nominalVoltageKv/);
  assert.match(gatewayConfigurationApi, /checksumSha256/);
  assert.doesNotMatch(settings, /usePersistentState|setTimeout\(.*Prueba Modbus/);
  assert.doesNotMatch(page, /cam5\.front\.(asset-config|gateway-config|channel-config|register-map)/);
  assert.match(engineering, /\/api\/v1\/commissioning/);
  assert.match(engineering, /Controles previos a operación/);
  assert.match(engineering, /Mapa Modbus/);
  assert.doesNotMatch(engineering, /usePersistentState/);
  assert.match(commissioningApi, /commissioningItems/);
  assert.match(commissioningApi, /commissioning\.validate/);
  assert.match(commissioningApi, /commissioning\.activate/);
  assert.match(commissioningApi, /auditLogs/);
  assert.match(commissioningEngine, /evaluateCommissioning/);
  assert.match(commissioningEngine, /stabilityHours >= 24/);
  assert.match(model, /const humanReference/);
  assert.match(model, /registerDefinition\(418/);
  assert.match(model, /cam5RegisterCatalog/);
  assert.match(model, /cam5InputInventory/);
  assert.doesNotMatch(page, /CAM5-GW-0[234]|Subestación Auxiliar|2 subestaciones/);
  assert.match(layout, /HoitLive Core \| Monitoreo de condición eléctrica/);
  assert.match(css, /\.report-builder/);
  assert.match(css, /\.asset-management-layout/);
  assert.match(css, /\.account-layout/);
  assert.match(css, /\.register-map-table/);
  assert.match(css, /\.diagnostic-chain/);
  assert.match(css, /\.diagnostic-profile-strip/);
  assert.match(css, /\.diagnostic-table-empty/);
  assert.match(css, /\.commissioning-summary/);
  assert.match(css, /\.commissioning-chain/);
  assert.match(css, /\.commissioning-control-list/);
  assert.match(css, /\.zone-channel-grid/);
  assert.match(css, /\.condition-map-empty/);
  assert.match(css, /\.trend-preview-empty/);
  assert.match(css, /\.register-reference-table/);
  assert.match(css, /\.alarm-rule-table/);
  assert.match(alarmEngine, /evaluateAlarmReadings/);
  assert.match(alarmEngine, /evaluateStaleCommunications/);
  assert.match(alarmEngine, /recoveryBoundary/);
  assert.match(trends, /\/api\/v1\/trends/);
  assert.match(trends, /Arrastra horizontalmente/);
  assert.match(trends, /Exportar CSV/);
  assert.match(trends, /Comparar con/);
  assert.match(css, /\.trend-chart-panel/);
  assert.match(notifications, /PostgreSQL · trazabilidad activa/);
  assert.match(notifications, /Enviar prueba/);
  assert.match(notifications, /Reintentar/);
  assert.match(notifications, /RESEND_API_KEY/);
  assert.match(notificationEngine, /queueAlarmNotifications/);
  assert.match(notificationEngine, /processNotificationQueue/);
  assert.match(notificationEngine, /X-HoitLive-Signature/);
  assert.doesNotMatch(notifications, /usePersistentState/);
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
