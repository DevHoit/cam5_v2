/** Normalize the history-to-trend window, ending no later than the current time. */
export function normalizeTrendRange(from: string, to: string, now = Date.now()) {
  const toTime = Math.min(now, new Date(to).getTime());
  const fromTime = Math.min(new Date(from).getTime(), toTime - 60_000);
  return { from: new Date(fromTime).toISOString(), to: new Date(toTime).toISOString() };
}
