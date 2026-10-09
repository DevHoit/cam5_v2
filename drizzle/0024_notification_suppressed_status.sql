ALTER TABLE "notification_deliveries" DROP CONSTRAINT IF EXISTS "notification_deliveries_status_chk";
ALTER TABLE "notification_deliveries"
  ADD CONSTRAINT "notification_deliveries_status_chk"
  CHECK ("status" IN ('queued', 'sending', 'delivered', 'failed', 'suppressed'));