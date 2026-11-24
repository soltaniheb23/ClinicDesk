const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema(
  {
    ticket: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', required: true },
    // Set from the authenticated user by the route, never from the request body.
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true, trim: true, minlength: 1, maxlength: 2000 },
    // Internal notes are for agents and admins only; customers never receive them.
    internal: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_document, returned) {
        returned.id = returned._id.toString();
        delete returned._id;
        delete returned.__v;
        return returned;
      },
    },
  },
);

// A ticket's thread, oldest first.
commentSchema.index({ ticket: 1, createdAt: 1 });

module.exports = mongoose.model('Comment', commentSchema);
