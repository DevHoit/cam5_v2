export const NOTIFICATION_STATUSES = ["queued", "sending", "sent", "delivered", "failed", "suppressed"] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

/** Provider acceptance verifies connectivity; it does not confirm inbox delivery. */
export function notificationAccepted(status: string): boolean {
  return status === "sent" || status === "delivered";
}

export function notificationStatusLabel(status: NotificationStatus): string {
  const labels: Record<NotificationStatus, string> = {
    queued: "Programada", sending: "Enviando", sent: "Enviada al proveedor",
    delivered: "Entregada", failed: "Fallida", suppressed: "Suprimida",
  };
  return labels[status];
}
