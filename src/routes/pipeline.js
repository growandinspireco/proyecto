const express = require('express');
const db = require('../db');
const { STAGES } = require('../constants');
const { isAdmin, contactScope, activeUsers } = require('../access');
const { toInt } = require('../utils');

const router = express.Router();

router.get('/', (req, res) => {
  const s = contactScope(req.user);
  const params = [...s.params];
  let extra = '';
  if (isAdmin(req.user) && toInt(req.query.owner)) {
    extra = ' AND c.owner_id = ?';
    params.push(toInt(req.query.owner));
  }
  const contacts = db
    .prepare(
      `SELECT c.*, u.name AS owner_name, p.title AS property_title FROM contacts c
       LEFT JOIN users u ON u.id = c.owner_id LEFT JOIN properties p ON p.id = c.property_id
       WHERE 1=1 ${s.sql} ${extra} ORDER BY COALESCE(c.last_activity_at, c.created_at) DESC`
    )
    .all(...params);
  const columns = STAGES.map((st) => {
    const items = contacts.filter((c) => c.stage === st.key);
    return { ...st, items, total: items.reduce((a, c) => a + (c.deal_value || 0), 0) };
  });
  res.render('pipeline', { title: 'Pipeline', columns, users: activeUsers(), owner: toInt(req.query.owner) });
});

module.exports = router;
