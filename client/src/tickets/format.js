// dd.mm.yyyy in the viewer's time zone, as in the wireframes (e.g. 01.12.2026).
export function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}.${month}.${date.getFullYear()}`;
}

// dd.mm.yyyy, hh:mm (24-hour) in the viewer's time zone, for comment timestamps.
export function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${formatDate(date)}, ${hours}:${minutes}`;
}

// Date and time in the viewer's locale and time zone (for example "1 Dec 2026, 10:00" or
// "Dec 1, 2026, 10:00 AM"), for SLA due times. `locale` is for tests.
export function formatLocaleDateTime(value, locale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

// Reads ?page= from the URL; anything that is not a whole number of at least 1 means page 1.
export function pageFromSearch(searchParams) {
  const page = Number(searchParams.get('page'));
  return Number.isInteger(page) && page >= 1 ? page : 1;
}
