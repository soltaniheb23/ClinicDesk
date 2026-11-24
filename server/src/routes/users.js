const express = require('express');
const User = require('../models/User');
const { authenticate } = require('../auth/authenticate');
const { requireRole } = require('../auth/authorize');

const router = express.Router();

router.use(authenticate);

// Active agents and admins, for the admin's assignee select. Only id and name leave the
// server (never email, role or passwordHash).
router.get('/agents', requireRole('agent', 'admin'), async (_request, response) => {
  const users = await User.find({ role: { $in: ['agent', 'admin'] }, isActive: true })
    .select('name')
    .sort({ name: 1, _id: 1 })
    .lean();

  return response.json({
    items: users.map((user) => ({ id: user._id.toString(), name: user.name })),
  });
});

module.exports = router;
