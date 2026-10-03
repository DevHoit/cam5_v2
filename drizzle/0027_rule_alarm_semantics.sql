ALTER TYPE "severity" ADD VALUE IF NOT EXISTS 'info' BEFORE 'warning';
--> statement-breakpoint
ALTER TYPE "alarm_status" ADD VALUE IF NOT EXISTS 'suppressed' AFTER 'closed';
