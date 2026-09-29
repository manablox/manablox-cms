/** Usage periods: months starting on an anchor day (1-28), in UTC. */

export interface UsagePeriod {
  /** `YYYY-MM` of the month the period starts in. */
  label: string;
  start: Date;
  /** The start of the next period. */
  end: Date;
}

export function usagePeriod(at: Date, anchorDay = 1): UsagePeriod {
  let year = at.getUTCFullYear();
  let month = at.getUTCMonth();
  if (at.getUTCDate() < anchorDay) month -= 1;
  if (month < 0) {
    month = 11;
    year -= 1;
  }
  const start = new Date(Date.UTC(year, month, anchorDay));
  const end = new Date(Date.UTC(year, month + 1, anchorDay));
  return { label: `${year}-${String(month + 1).padStart(2, '0')}`, start, end };
}
