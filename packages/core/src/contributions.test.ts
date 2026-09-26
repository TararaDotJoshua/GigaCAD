import { describe, expect, it } from 'vitest';
import { CALENDAR_WEEKS, contributionCalendar, contributionLevel } from './contributions.js';

describe('contributionCalendar', () => {
  // Saturday 2026-09-26.
  const today = new Date('2026-09-26T15:00:00Z');

  it('ends with the week of today and starts on a Sunday 52 weeks earlier', () => {
    const { weeks } = contributionCalendar([], today);
    expect(weeks).toHaveLength(CALENDAR_WEEKS);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(weeks[0]![0]!.date).toBe('2025-09-21');
    expect(new Date(`${weeks[0]![0]!.date}T00:00:00Z`).getUTCDay()).toBe(0);
    expect(weeks.at(-1)![6]!.date).toBe('2026-09-26');
  });

  it('blanks the days after today', () => {
    const { weeks } = contributionCalendar([], new Date('2026-09-23T23:59:00Z'));
    const last = weeks.at(-1)!;
    expect(last[3]!.date).toBe('2026-09-23');
    expect(last.slice(4)).toEqual([null, null, null]);
  });

  it('counts days across a year boundary and ignores days outside the range', () => {
    const { weeks, total } = contributionCalendar(
      [
        { day: '2025-12-31', count: 2 },
        { day: '2026-01-01', count: 3 },
        { day: '2024-01-01', count: 9 },
        { day: '2026-09-27', count: 9 },
      ],
      today,
    );
    expect(total).toBe(5);
    const cells = weeks.flat().filter((cell) => cell && cell.count > 0);
    expect(cells.map((cell) => [cell!.date, cell!.count, cell!.level])).toEqual([
      ['2025-12-31', 2, 3],
      ['2026-01-01', 3, 4],
    ]);
  });

  it('handles no contributions', () => {
    const { weeks, total } = contributionCalendar([], today);
    expect(total).toBe(0);
    expect(weeks.flat().every((cell) => cell === null || cell.level === 0)).toBe(true);
  });

  it('labels each month once, at the first week that starts in it', () => {
    const { months, weeks } = contributionCalendar([], today);
    expect(months.map((month) => month.label).join(' ')).toBe('Oct Nov Dec Jan Feb Mar Apr May Jun Jul Aug Sep');
    const october = months[0]!;
    expect(weeks[october.weekIndex]![0]!.date).toBe('2025-10-05');
  });
});

describe('contributionLevel', () => {
  it('buckets by quarter of the busiest day', () => {
    expect(contributionLevel(0, 8)).toBe(0);
    expect(contributionLevel(1, 8)).toBe(1);
    expect(contributionLevel(2, 8)).toBe(1);
    expect(contributionLevel(3, 8)).toBe(2);
    expect(contributionLevel(6, 8)).toBe(3);
    expect(contributionLevel(8, 8)).toBe(4);
    expect(contributionLevel(1, 1)).toBe(4);
    expect(contributionLevel(0, 0)).toBe(0);
  });
});
