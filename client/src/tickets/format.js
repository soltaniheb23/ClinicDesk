// dd.mm.yyyy in the viewer's time zone, as in the wireframes (e.g. 01.12.2026).
export function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}.${month}.${date.getFullYear()}`;
}

// Reads ?page= from the URL; anything that is not a whole number of at least 1 means page 1.
export function pageFromSearch(searchParams) {
  const page = Number(searchParams.get('page'));
  return Number.isInteger(page) && page >= 1 ? page : 1;
}
