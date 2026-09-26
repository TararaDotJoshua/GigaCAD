import { contributionCalendar, type ContributionDay } from '@gigacad/core';

const CELL = 11;
const STEP = CELL + 3;
const LEFT = 30;
const TOP = 18;
const WEEKDAYS = [
  [1, 'Mon'],
  [3, 'Wed'],
  [5, 'Fri'],
] as const;

const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

function describe(count: number, date: string): string {
  const day = dateFormat.format(new Date(`${date}T00:00:00Z`));
  return `${count === 0 ? 'No' : count} ${count === 1 ? 'contribution' : 'contributions'} on ${day}`;
}

/**
 * A year of contributions, a week to a column, as on GitHub. Darker cells mean busier
 * days: one ink at five strengths, since green is kept for state.
 */
export function ContributionGraph({ days }: { days: readonly ContributionDay[] }) {
  const { weeks, total, months } = contributionCalendar(days, new Date());
  const busiest = days.reduce((best, day) => (day.count > (best?.count ?? 0) ? day : best), null as ContributionDay | null);
  const width = LEFT + weeks.length * STEP;
  const height = TOP + 7 * STEP;
  const summary = `${total} ${total === 1 ? 'contribution' : 'contributions'} in the last year.${busiest ? ` The busiest day had ${describe(busiest.count, busiest.day)}.` : ''}`;
  return (
    <section className="contrib" aria-labelledby="contrib-heading">
      <h2 id="contrib-heading" className="contrib-heading">
        {total} {total === 1 ? 'contribution' : 'contributions'} in the last year
      </h2>
      <div className="contrib-frame">
        <div className="contrib-scroll">
          <svg className="contrib-graph" viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={summary}>
            {months.map((month) => (
              <text key={`${month.label}-${month.weekIndex}`} x={LEFT + month.weekIndex * STEP} y={10} className="contrib-label">
                {month.label}
              </text>
            ))}
            {WEEKDAYS.map(([row, label]) => (
              <text key={label} x={0} y={TOP + row * STEP + CELL - 2} className="contrib-label">
                {label}
              </text>
            ))}
            {weeks.map((week, column) =>
              week.map(
                (cell, row) =>
                  cell && (
                    <rect
                      key={cell.date}
                      x={LEFT + column * STEP}
                      y={TOP + row * STEP}
                      width={CELL}
                      height={CELL}
                      rx={2}
                      className={`contrib-level-${cell.level}`}
                      data-count={cell.count}
                    >
                      <title>{describe(cell.count, cell.date)}</title>
                    </rect>
                  ),
              ),
            )}
          </svg>
        </div>
        <div className="contrib-foot">
          <span>Version commits, release requests, releases, and approvals. Days are in UTC.</span>
          <span className="contrib-legend" aria-hidden="true">
            Less
            {[0, 1, 2, 3, 4].map((level) => (
              <svg key={level} width={CELL} height={CELL} viewBox={`0 0 ${CELL} ${CELL}`}>
                <rect width={CELL} height={CELL} rx={2} className={`contrib-level-${level}`} />
              </svg>
            ))}
            More
          </span>
        </div>
      </div>
    </section>
  );
}
