// How times and lengths of time read in the pane and the export: local time,
// since a person reads their own clock.

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** The local date, `2026-10-26`. */
export function formatDay(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** The local time of day, `14:03`. */
export function formatClock(at: number): string {
  const d = new Date(at);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Local date and time, `2026-10-26 14:03`. */
export function formatTime(at: number): string {
  return `${formatDay(at)} ${formatClock(at)}`;
}

/** A length of time, short: `42s`, `3m05s`, `1h02m`. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m${pad2(seconds % 60)}s`;
  return `${Math.floor(minutes / 60)}h${pad2(minutes % 60)}m`;
}
