// Removes personal and secret data from Sentry events and breadcrumbs (CD-25,
// docs/monitoring.md). Used as beforeSend and beforeBreadcrumb in src/monitoring/sentry.js.
// The client has its own copy in client/src/monitoring/scrub.js; keep the two in step.
//
// Removed: request bodies, cookies, query strings (and URL fragments), the Authorization and
// Cookie headers, any password, token, secret, email or ticket text field (title,
// description, comment body), and every user field except an opaque id. Email addresses,
// bearer tokens and JWTs inside free text (error messages, log lines) are replaced too.

// Field names that are dropped wherever they appear in an event.
const SENSITIVE_KEY =
  /pass(word)?|token|secret|authorization|cookie|api[-_]?key|e-?mail|^(title|description|body|text|comment)$/i;
// Parts of event.request that are dropped as a whole: the body, cookies and query string.
const REQUEST_DROPPED = ['data', 'cookies', 'query_string'];
// Fields that hold a URL; their query string and fragment are cut off.
const URL_KEY = /^(url|from|to|referer|referrer)$/i;

const EMAIL = /[^\s@"'<>(),;:]+@[^\s@"'<>(),;:]+\.[a-z]{2,}/gi;
const BEARER = /bearer\s+[^\s"',]+/gi;
const JWT = /eyJ[\w-]+\.[\w-]+\.[\w-]+/g;

function scrubText(value) {
  return value
    .replace(BEARER, 'Bearer [Filtered]')
    .replace(JWT, '[Filtered]')
    .replace(EMAIL, '[email]');
}

function stripQuery(value) {
  return value.replace(/[?#].*$/s, '');
}

function scrubValue(value, key) {
  if (typeof value === 'string') {
    return scrubText(key && URL_KEY.test(key) ? stripQuery(value) : value);
  }
  if (Array.isArray(value)) return value.map((entry) => scrubValue(entry));
  if (value && typeof value === 'object') {
    const result = {};
    for (const [name, entry] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(name)) continue;
      result[name] = scrubValue(entry, name);
    }
    return result;
  }
  return value;
}

// Only an opaque id survives; never email, name, IP address or anything else.
function scrubUser(user) {
  return user && user.id !== undefined ? { id: String(user.id) } : undefined;
}

// beforeSend. Returns a scrubbed copy of the event (never null: errors are still reported).
function scrubEvent(event) {
  if (!event || typeof event !== 'object') return event;
  const { user, request, ...rest } = event;
  const scrubbed = scrubValue(rest);

  if (request && typeof request === 'object') {
    const kept = { ...request };
    for (const name of REQUEST_DROPPED) delete kept[name];
    scrubbed.request = scrubValue(kept);
  }
  const safeUser = scrubUser(user);
  if (safeUser) scrubbed.user = safeUser;
  return scrubbed;
}

// beforeBreadcrumb: the same rules for one breadcrumb.
function scrubBreadcrumb(breadcrumb) {
  if (!breadcrumb || typeof breadcrumb !== 'object') return breadcrumb;
  return scrubValue(breadcrumb);
}

module.exports = { scrubBreadcrumb, scrubEvent };
