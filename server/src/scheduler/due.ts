// Which slot of a schedule is due now. Pure. A slot is due once: the latest cron time at or
// before now, if it is newer than the last slot fired and not older than `maxLagHours` (a worker
// that was down for two days does not replay every missed slot; it runs the latest one).
import cronParser from 'cron-parser';

export function dueSlot(cadence: string, timezone: string, now: Date, lastFired: Date | null, maxLagHours = 24): Date | null {
  let slot: Date;
  try {
    // cron-parser's prev() is strictly before currentDate: nudge by 1 ms so a slot exactly at `now` counts.
    slot = cronParser.parseExpression(cadence, { currentDate: new Date(now.getTime() + 1), tz: timezone }).prev().toDate();
  } catch {
    return null;
  }
  if (lastFired && slot.getTime() <= lastFired.getTime()) return null;
  if (now.getTime() - slot.getTime() > maxLagHours * 3_600_000) return null;
  return slot;
}
