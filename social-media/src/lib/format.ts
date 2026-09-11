/** Formatting helpers. French locale, matching the design's copy. */

const DAY_NAMES = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

const MONTH_NAMES = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

/** Short weekday initials, Monday first - the calendar header. */
export const WEEKDAY_INITIALS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

const pad = (value: number) => String(value).padStart(2, '0');

/** `28/07` */
export function formatDayMonth(iso: string): string {
  const date = new Date(iso);
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
}

/** `28/07/2026` */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

/** `18:00` */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `28/07 · 18:00` */
export function formatDateTime(iso: string): string {
  return `${formatDayMonth(iso)} · ${formatTime(iso)}`;
}

/**
 * `28/07 · 18:00` read in `timezone` instead of the device's - for a scheduled
 * slot, which the community manager picked in the publication's own zone.
 */
export function formatDateTimeIn(iso: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour12: false,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  return `${part('day')}/${part('month')} · ${pad(Number(part('hour')) % 24)}:${part('minute')}`;
}

/** `jeudi 30 juillet` */
export function formatLongDay(date: Date): string {
  return `${DAY_NAMES[date.getDay()]} ${date.getDate()} ${MONTH_NAMES[date.getMonth()]}`;
}

/** `Juillet 2026` */
export function formatMonthYear(date: Date): string {
  const month = MONTH_NAMES[date.getMonth()] ?? '';
  return `${month.charAt(0).toUpperCase()}${month.slice(1)} ${date.getFullYear()}`;
}

/**
 * Minutes east of UTC for an IANA timezone, read from that zone's own wall clock
 * so summer time is included. The device timezone never enters into it.
 */
function timezoneOffsetMinutes(timezone: string, date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((candidate) => candidate.type === type)?.value);
  // `hour12: false` renders midnight as 24 on some engines.
  const wallClock = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour') % 24,
    part('minute'),
  );
  return Math.round((wallClock - Math.floor(date.getTime() / 60_000) * 60_000) / 60_000);
}

/** `UTC+2 · Paris` - a readable label for an IANA timezone. */
export function formatTimezone(timezone: string): string {
  const city = timezone.split('/').pop()?.replace(/_/g, ' ') ?? timezone;
  const offsetMinutes = timezoneOffsetMinutes(timezone, new Date());
  const sign = offsetMinutes < 0 ? '−' : '+';
  const hours = Math.floor(Math.abs(offsetMinutes) / 60);
  const minutes = Math.abs(offsetMinutes) % 60;
  return `UTC${sign}${hours}${minutes === 0 ? '' : `:${pad(minutes)}`} · ${city}`;
}

/** `il y a 12 min`, `Hier · 18:00`, `28/07 · 18:00` */
export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMinutes = Math.round((Date.now() - then) / 60_000);

  if (diffMinutes < 1) return 'à l’instant';
  if (diffMinutes < 60) return `il y a ${diffMinutes} min`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `il y a ${diffHours} h`;
  if (diffHours < 48) return `Hier · ${formatTime(iso)}`;

  return formatDateTime(iso);
}

/** `1,9 k` / `42 k` / `128` - compact numbers, French decimal comma. */
export function formatCompactNumber(value: number): string {
  if (Math.abs(value) < 1000) return String(value);
  const thousands = value / 1000;
  const rounded = thousands >= 10 ? Math.round(thousands) : Math.round(thousands * 10) / 10;
  return `${String(rounded).replace('.', ',')} k`;
}

/** `4,2 %` - or `Non disponible` when the platform gave us nothing. */
export function formatPercent(value: number | null, digits = 1): string {
  if (value === null) return UNAVAILABLE;
  return `${value.toFixed(digits).replace('.', ',')} %`;
}

/** Rule from the spec: never show `0` for a metric a platform does not provide. */
export const UNAVAILABLE = 'Non disponible';
export const UNAVAILABLE_SHORT = 'N. dispo.';

export function formatMetric(value: number | null, options?: { short?: boolean }): string {
  if (value === null) return options?.short ? UNAVAILABLE_SHORT : UNAVAILABLE;
  return formatCompactNumber(value);
}

/** `1,8 Mo` */
export function formatFileSize(bytes: number): string {
  const megabytes = bytes / 1_000_000;
  if (megabytes >= 1) return `${megabytes.toFixed(1).replace('.', ',')} Mo`;
  return `${Math.round(bytes / 1000)} Ko`;
}

/** `JPEG` from `image/jpeg` */
export function formatMimeType(mimeType: string): string {
  return (mimeType.split('/')[1] ?? mimeType).toUpperCase();
}

/** `+12 %` / `−0,4 pt` */
export function formatDelta(value: number, unit: '%' | 'pt' = '%'): string {
  const sign = value >= 0 ? '+' : '−';
  const magnitude = Math.abs(value);
  const formatted = Number.isInteger(magnitude) ? String(magnitude) : magnitude.toFixed(1).replace('.', ',');
  return `${sign}${formatted} ${unit}`;
}

/** Truncates on a word boundary so card excerpts stay readable. */
export function excerpt(text: string, maxLength = 90): string {
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 40 ? lastSpace : maxLength).trimEnd()}…`;
}

/**
 * Combines a calendar day and a `HH:mm` time into the matching instant, reading
 * the time as wall clock in `timezone` - the zone the scheduler shows the user,
 * which is not necessarily the device's.
 */
export function combineDateAndTime(date: Date, time: string, timezone: string): string {
  const [hours, minutes] = time.split(':').map(Number);
  const asUtc = Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    hours ?? 0,
    minutes ?? 0,
  );
  // Second pass: around a summer-time switch the first offset can be the one
  // in force on the other side of the transition.
  const rough = asUtc - timezoneOffsetMinutes(timezone, new Date(asUtc)) * 60_000;
  return new Date(asUtc - timezoneOffsetMinutes(timezone, new Date(rough)) * 60_000).toISOString();
}

/** Calendar grid for a month, padded to whole Monday-first weeks. */
export function buildMonthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  // getDay() is Sunday-first; shift so Monday === 0.
  const leading = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - leading);

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cellCount = Math.ceil((leading + daysInMonth) / 7) * 7;

  return Array.from({ length: cellCount }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}
