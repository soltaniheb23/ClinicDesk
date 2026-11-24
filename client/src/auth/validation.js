// Client-side checks that mirror the API rules in server/src/routes/auth.js.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_BYTES = 72; // bcrypt only uses the first 72 bytes.
const NAME_MAX_LENGTH = 80;

function passwordTooLong(password) {
  return new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES;
}

function validateEmail(email) {
  const value = email.trim();
  if (!value) return 'Enter your email address';
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

export function validateRegister({ name, email, password, confirmPassword }) {
  let passwordError = null;
  if (password.length < PASSWORD_MIN_LENGTH) {
    passwordError = `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  } else if (passwordTooLong(password)) {
    passwordError = 'Password is too long';
  }

  let nameError = null;
  if (!name.trim()) nameError = 'Enter your name';
  else if (name.trim().length > NAME_MAX_LENGTH) {
    nameError = `Name must be at most ${NAME_MAX_LENGTH} characters`;
  }

  return withoutEmpty({
    name: nameError,
    email: validateEmail(email),
    password: passwordError,
    confirmPassword: password && confirmPassword !== password ? 'Passwords do not match' : null,
  });
}
