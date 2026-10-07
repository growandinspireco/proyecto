const express = require('express');
const db = require('../db');
const { computeStats, perUserStats, resolveRange } = require('../analytics');
const { isAdmin } = require('../access');
const { toInt } = require('../utils');

const router = express.Router();

router.get('/', (req, res) => {
  const { range, from, to } = resolveRange(req.query.range);
  // Un agente solo ve sus propias métricas; el admin puede ver todo o filtrar por usuario.
  const userId = isAdmin(req.user) ? toInt(req.query.user) : req.user.id;
  const selectedUser = userId ? db.prepare('SELECT id, name FROM users WHERE id = ?').get(userId) : null;
  const stats = computeStats({ userId: selectedUser ? selectedUser.id : null, from, to });
  const team = isAdmin(req.user) ? perUserStats({ from, to }) : null;
  const users = isAdmin(req.user) ? db.prepare('SELECT id, name FROM users ORDER BY name').all() : [];
  const chartData = {
    days: stats.days,
    leads: stats.leadsSeries,
    sales: stats.salesSeries,
    pipeline: stats.pipeline.map((s) => ({ label: s.label, count: s.count, color: s.color })),
    team: team ? team.map((r) => ({ name: r.user.name, revenue: r.stats.revenue, won: r.stats.wonCount })) : null,
  };
  res.render('analytics', { title: 'Analíticas', range, stats, team, users, selectedUser, chartData });
});

module.exports = router;
