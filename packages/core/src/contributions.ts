/** Contributions on one UTC day, as the API counts them. `day` is `YYYY-MM-DD`. */
export interface ContributionDay {
  readonly day: string;
  readonly count: number;
}

export type ContributionLevel = 0 | 1 | 2 | 3 | 4;

export interface CalendarCell {
  readonly date: string;
  readonly count: number;
  readonly level: ContributionLevel;
}

export interface ContributionCalendar {
  /** 53 weeks, oldest first, each Sunday to Saturday. Days after today are null. */
  readonly weeks: readonly (readonly (CalendarCell | null)[])[];
  readonly total: number;
  /** Where each month's label goes: the first week that starts in that month. */
  readonly months: readonly { readonly label: string; readonly weekIndex: number }[];
}

export const CALENDAR_WEEKS = 53;
const DAY_MS = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 0 for no contributions, then 1-4 by quarter of the busiest day, as on GitHub. */
export function contributionLevel(count: number, max: number): ContributionLevel {
  if (count <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((count / max) * 4))) as ContributionLevel;
}

/** Lays out a year of contributions as GitHub does: 53 week columns ending with the week of `today` (UTC). */
export function contributionCalendar(days: readonly ContributionDay[], today: Date): ContributionCalendar {
  const todayMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const startMs = todayMs - (today.getUTCDay() + (CALENDAR_WEEKS - 1) * 7) * DAY_MS;
  const counts = new Map<string, number>();
  for (const { day, count } of days) {
    const ms = Date.parse(`${day}T00:00:00Z`);
    if (ms >= startMs && ms <= todayMs) counts.set(day, (counts.get(day) ?? 0) + count);
  }
  const max = Math.max(0, ...counts.values());
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);

  const weeks: (CalendarCell | null)[][] = [];
  const months: { label: string; weekIndex: number }[] = [];
  for (let week = 0; week < CALENDAR_WEEKS; week++) {
    const cells: (CalendarCell | null)[] = [];
    for (let weekday = 0; weekday < 7; weekday++) {
      const ms = startMs + (week * 7 + weekday) * DAY_MS;
      if (ms > todayMs) {
        cells.push(null);
        continue;
      }
      const date = new Date(ms).toISOString().slice(0, 10);
      const count = counts.get(date) ?? 0;
      cells.push({ date, count, level: contributionLevel(count, max) });
    }
    weeks.push(cells);
    const month = new Date(startMs + week * 7 * DAY_MS).getUTCMonth();
    if (week === 0 || month !== new Date(startMs + (week - 1) * 7 * DAY_MS).getUTCMonth()) months.push({ label: MONTHS[month]!, weekIndex: week });
  }
  // A partial first month too close to the next label would overlap it.
  if (months.length > 1 && months[1]!.weekIndex < 3) months.shift();
  return { weeks, total, months };
}
