// Brazilian national holidays, computed in-app (specs/spec.md §5.2 / §8).
// Fixed-date holidays plus movable feasts derived from Easter.

// Anonymous Gregorian algorithm (Computus).
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Map of "YYYY-MM-DD" -> holiday key for one year. Values are translation
// keys under common:holidays.* (specs/i18n.md §3) — display names come from
// the active locale's bundle.
function holidaysForYear(year: number): Map<string, string> {
  const easter = easterSunday(year);
  const entries: [string, string][] = [
    [`${year}-01-01`, "newYear"],
    [iso(addDays(easter, -48)), "carnival"],
    [iso(addDays(easter, -47)), "carnival"],
    [iso(addDays(easter, -2)), "goodFriday"],
    [`${year}-04-21`, "tiradentes"],
    [`${year}-05-01`, "labourDay"],
    [iso(addDays(easter, 60)), "corpusChristi"],
    [`${year}-09-07`, "independence"],
    [`${year}-10-12`, "aparecida"],
    [`${year}-11-02`, "allSouls"],
    [`${year}-11-15`, "republic"],
    [`${year}-11-20`, "blackAwareness"],
    [`${year}-12-25`, "christmas"],
  ];
  return new Map(entries);
}

// Holiday keys covering an inclusive "YYYY-MM-DD" date range.
export function holidaysInRange(
  startDay: string,
  endDay: string
): Map<string, string> {
  const startYear = Number(startDay.slice(0, 4));
  const endYear = Number(endDay.slice(0, 4));
  const result = new Map<string, string>();
  for (let year = startYear; year <= endYear; year++) {
    for (const [day, name] of holidaysForYear(year)) {
      if (day >= startDay && day <= endDay) result.set(day, name);
    }
  }
  return result;
}
