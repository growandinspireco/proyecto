const express = require('express');
const db = require('../db');
const { isAdmin } = require('../access');
const { toInt, toDbDateTime } = require('../utils');

const router = express.Router();

router.post('/:id/toggle', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(toInt(req.params.id));
  if (task && (isAdmin(req.user) || task.user_id === req.user.id)) {
    db.prepare('UPDATE tasks SET done = ?, done_at = ? WHERE id = ?').run(task.done ? 0 : 1, task.done ? null : toDbDateTime(), task.id);
  }
  const ref = req.get('referer') || '';
  res.redirect(ref.startsWith(`${req.protocol}://${req.get('host')}/`) ? ref : '/');
});

module.exports = router;
