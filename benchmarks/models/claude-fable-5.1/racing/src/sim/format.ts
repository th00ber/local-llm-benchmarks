/** Formats a duration in seconds as M:SS.mmm (e.g. 1:07.345). */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '-:--.---';
  const totalMs = Math.floor(seconds * 1000 + 1e-6);
  const minutes = Math.floor(totalMs / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${minutes}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

/** Converts simulation speed (m/s) to the HUD unit (km/h). */
export function toKmh(metersPerSecond: number): number {
  return Math.abs(metersPerSecond) * 3.6;
}
