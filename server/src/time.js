// Market-calendar time helpers. US equity feeds reopen at Sunday 20:00 New York time, so the UTC
// hour moves with US daylight saving (00:00 UTC in summer time, 01:00 UTC in winter). Computed
// with the IANA zone via Intl, never a fixed offset.
const NY = 'America/New_York';
const parts = new Intl.DateTimeFormat('en-US', {
  timeZone: NY, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

/** New York's offset from UTC (ms) at instant `ms`. */
function nyOffset(ms) {
  const p = Object.fromEntries(parts.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms;
}

/** UTC instant (ms) of a New York wall-clock time. */
export function nyWallToUtc(y, m, d, h, min = 0) {
  const wall = Date.UTC(y, m, d, h, min);
  let ms = wall - nyOffset(wall);
  ms = wall - nyOffset(ms); // second pass settles the offset on DST-change days
  return ms;
}

/**
 * Expected feed reopen for the weekend whose Saturday is `satTs` (unix seconds, 00:00 UTC):
 * the following Sunday at 20:00 New York time. The real reopen is the first feed round after it
 * (later on US market holidays).
 */
export function expectedReopen(satTs) {
  const sun = new Date((satTs + 86_400) * 1000);
  return nyWallToUtc(sun.getUTCFullYear(), sun.getUTCMonth(), sun.getUTCDate(), 20) / 1000;
}

/** Friday of the weekend whose Saturday is `satTs`, at a New York wall-clock hour, in unix seconds. */
function fridayNy(satTs, hour) {
  const fri = new Date((satTs - 86_400) * 1000);
  return nyWallToUtc(fri.getUTCFullYear(), fri.getUTCMonth(), fri.getUTCDate(), hour) / 1000;
}
/** The weekend starts at Friday's regular close, 16:00 New York (21:00 UTC in winter). */
export const weekendStart = (satTs) => fridayNy(satTs, 16);
/** Feeds can still post extended-hours rounds until Friday 20:00 New York. */
export const feedsSettle = (satTs) => fridayNy(satTs, 20);
