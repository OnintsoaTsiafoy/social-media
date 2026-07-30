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

/** `jeudi 30 juillet` */
export function formatLongDay(date: Date): string {
  return `${DAY_NAMES[date.getDay()]} ${date.getDate()} ${MONTH_NAMES[date.getMonth()]}`;
}

/** `Juillet 2026` */
export function formatMonthYear(date: Date): string {
  const month = MONTH_NAMES[date.getMonth()] ?? '';
  return `${month.charAt(0).toUpperCase()}${month.slice(1)} ${date.getFullYear()}`;
}

/** `UTC+1 · Paris` - a readable label for an IANA timezone. */
export function formatTimezone(timezone: string): string {
  const city = timezone.split('/').pop()?.replace(/_/g, ' ') ?? timezone;
  const offsetMinutes = -new Date().getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '−';
  const hours = Math.floor(Math.abs(offsetMinutes) / 60);
  return `UTC${sign}${hours} · ${city}`;
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

/** Combines a `YYYY-MM-DD` date and a `HH:mm` time into an ISO string. */
export function combineDateAndTime(date: Date, time: string): string {
  const [hours, minutes] = time.split(':').map(Number);
  const result = new Date(date);
  result.setHours(hours ?? 0, minutes ?? 0, 0, 0);
  return result.toISOString();
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
