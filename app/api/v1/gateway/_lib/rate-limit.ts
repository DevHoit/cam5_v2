import { ApiError } from "../../_lib/auth";

type WindowEntry = {
  timestamps: number[];
};

const windowStore = new Map<string, WindowEntry>();
const WINDOW_SIZE_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 120; // Allow max 120 requests per minute per gateway key/IP

export function checkIngestRateLimit(identifier: string, now = Date.now()) {
  const windowStart = now - WINDOW_SIZE_MS;
  let entry = windowStore.get(identifier);

  if (!entry) {
    entry = { timestamps: [] };
    windowStore.set(identifier, entry);
  }

  // Filter out timestamps outside current sliding window
  entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);

  if (entry.timestamps.length >= MAX_REQUESTS_PER_WINDOW) {
    throw new ApiError(429, "Tasa de ingestión excedida. Demasiados lotes recibidos en el último minuto.");
  }

  entry.timestamps.push(now);

  // Periodic cleanup of stale keys
  if (windowStore.size > 1000) {
    for (const [key, val] of windowStore.entries()) {
      if (!val.timestamps.some((ts) => ts > windowStart)) {
        windowStore.delete(key);
      }
    }
  }
}
