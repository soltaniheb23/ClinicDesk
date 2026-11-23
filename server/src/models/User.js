const mongoose = require('mongoose');

const ROLES = ['customer', 'agent', 'admin'];

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, default: 'customer' },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_document, returned) {
        returned.id = returned._id.toString();
        delete returned._id;
        delete returned.__v;
        delete returned.passwordHash;
        return returned;
      },
    },
  },
);

module.exports = mongoose.model('User', userSchema);
module.exports.ROLES = ROLES;
