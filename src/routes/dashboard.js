const express = require('express');
const db = require('../db');
const { computeStats, resolveRange } = require('../analytics');
const { isAdmin, contactScope } = require('../access');
const { toDbDate, addDays, toDbDateTime } = require('../utils');

const router = express.Router();

router.get('/', (req, res) => {
  const user = req.user;
  const { from, to } = resolveRange('mes');
  const stats = computeStats({ userId: isAdmin(user) ? null : user.id, from, to });
  const today = toDbDate();
  const tomorrow = toDbDate(addDays(new Date(), 1));
  const apptScope = isAdmin(user) ? { sql: '', params: [] } : { sql: ' AND a.user_id = ?', params: [user.id] };
  const s = contactScope(user);

  const todayAppts = db
    .prepare(
      `SELECT a.*, c.first_name, c.last_name, c.phone, u.name AS user_name, p.title AS property_title
       FROM appointments a JOIN contacts c ON c.id = a.contact_id LEFT JOIN users u ON u.id = a.user_id LEFT JOIN properties p ON p.id = a.property_id
       WHERE a.starts_at >= ? AND a.starts_at < ? AND a.status != 'cancelada' ${apptScope.sql} ORDER BY a.starts_at`
    )
    .all(`${today} 00:00:00`, `${tomorrow} 00:00:00`, ...apptScope.params);

  const tasks = db
    .prepare(
      `SELECT t.*, c.first_name, c.last_name FROM tasks t LEFT JOIN contacts c ON c.id = t.contact_id
       WHERE t.done = 0 AND t.user_id = ? ORDER BY t.due_at IS NULL, t.due_at LIMIT 10`
    )
    .all(user.id);

  const unread = db
    .prepare(
      `SELECT c.id, c.first_name, c.last_name, COUNT(*) n, MAX(m.created_at) last_at,
              (SELECT body FROM messages WHERE contact_id = c.id ORDER BY id DESC LIMIT 1) last_body
       FROM messages m JOIN contacts c ON c.id = m.contact_id
       WHERE m.direction = 'in' AND m.is_read = 0 ${s.sql} GROUP BY c.id ORDER BY last_at DESC LIMIT 6`
    )
    .all(...s.params);

  // Leads sin actividad en 3+ días que siguen abiertos: hay que darles seguimiento.
  const stale = db
    .prepare(
      `SELECT c.* FROM contacts c WHERE c.stage IN ('nuevo','contactado','propuesta')
       AND COALESCE(c.last_activity_at, c.created_at) < ? ${s.sql} ORDER BY COALESCE(c.last_activity_at, c.created_at) LIMIT 6`
    )
    .all(toDbDateTime(addDays(new Date(), -3)), ...s.params);

  res.render('dashboard', { title: 'Inicio', stats, todayAppts, tasks, unread, stale, now: toDbDateTime() });
});

module.exports = router;
