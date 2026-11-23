const bcrypt = require('bcryptjs');

const BCRYPT_ROUNDS = 12;

// Compared against when the email is unknown, so both failure paths take a similar time.
const DUMMY_HASH = bcrypt.hashSync('clinicdesk-dummy-password', BCRYPT_ROUNDS);

function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash || DUMMY_HASH);
}

module.exports = { hashPassword, verifyPassword };
