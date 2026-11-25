// Client-side checks that mirror the API rules in server/src/routes/auth.js.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_BYTES = 72; // bcrypt only uses the first 72 bytes.
export const NAME_MAX_LENGTH = 80;

function passwordTooLong(password) {
  return new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES;
}

function validateEmail(email, emptyMessage = 'Enter your email address') {
  const value = email.trim();
  if (!value) return emptyMessage;
  if (!EMAIL_PATTERN.test(value)) return 'Enter a valid email address';
  return null;
}

function withoutEmpty(errors) {
  return Object.fromEntries(Object.entries(errors).filter(([, message]) => message));
}

export function validateLogin({ email, password }) {
  return withoutEmpty({
    email: validateEmail(email),
    password: password ? null : 'Enter your password',
  });
}

function validateNewPassword(password) {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  return passwordTooLong(password) ? 'Password is too long' : null;
}

function validateName(name, emptyMessage) {
  if (!name.trim()) return emptyMessage;
  if (name.trim().length > NAME_MAX_LENGTH) {
    return `Name must be at most ${NAME_MAX_LENGTH} characters`;
  }
  return null;
}

export function validateRegister({ name, email, password, confirmPassword }) {
  return withoutEmpty({
    name: validateName(name, 'Enter your name'),
    email: validateEmail(email),
    password: validateNewPassword(password),
    confirmPassword: password && confirmPassword !== password ? 'Passwords do not match' : null,
  });
}

// An account created by an admin (POST /api/v1/users): same rules as register, plus a role.
export function validateNewUser({ name, email, password, role }, roles) {
  return withoutEmpty({
    name: validateName(name, 'Enter a name'),
    email: validateEmail(email, 'Enter an email address'),
    password: validateNewPassword(password),
    role: roles.includes(role) ? null : 'Choose a role',
  });
}
