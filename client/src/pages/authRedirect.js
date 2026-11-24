// Where to send a user after login: the page ProtectedRoute remembered, or the ticket list.
export function redirectTarget(location) {
  const from = location.state?.from;
  if (!from?.pathname || from.pathname === '/login' || from.pathname === '/register') {
    return '/tickets';
  }
  return `${from.pathname}${from.search ?? ''}${from.hash ?? ''}`;
}

export function focusFirstInvalid(prefix, fields, errors) {
  const first = fields.find((field) => errors[field]);
  if (first) document.getElementById(`${prefix}-${first}`)?.focus();
}
