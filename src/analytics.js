const db = require('./db');
const { STAGES } = require('./constants');
const { toDbDate, addDays } = require('./utils');

// Calcula métricas para un rango [from, to) y opcionalmente para un solo usuario.
function computeStats({ userId = null, from, to }) {
  const f = `${from} 00:00:00`;
  const t = `${to} 00:00:00`;
  const owner = userId ? ' AND owner_id = @userId' : '';
  const p = { f, t, userId };

  const newContacts = db.prepare(`SELECT COUNT(*) n FROM contacts WHERE created_at >= @f AND created_at < @t ${owner}`).get(p).n;
  const won = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(deal_value),0) total FROM contacts WHERE stage = 'ganado' AND won_at >= @f AND won_at < @t ${owner}`).get(p);
  const lost = db.prepare(`SELECT COUNT(*) n FROM contacts WHERE stage = 'perdido' AND lost_at >= @f AND lost_at < @t ${owner}`).get(p).n;

  const apptRows = db
    .prepare(`SELECT status, COUNT(*) n FROM appointments WHERE starts_at >= @f AND starts_at < @t ${userId ? ' AND user_id = @userId' : ''} GROUP BY status`)
    .all(p);
  const appts = Object.fromEntries(apptRows.map((r) => [r.status, r.n]));
  const apptTotal = apptRows.reduce((a, r) => a + r.n, 0);
  const attended = appts.completada || 0;
  const noShow = appts.no_show || 0;

  const msgRows = db
    .prepare(
      `SELECT m.direction, COUNT(*) n FROM messages m JOIN contacts c ON c.id = m.contact_id
       WHERE m.created_at >= @f AND m.created_at < @t ${userId ? ' AND c.owner_id = @userId' : ''} GROUP BY m.direction`
    )
    .all(p);
  const msgs = Object.fromEntries(msgRows.map((r) => [r.direction, r.n]));

  const pipelineRows = db.prepare(`SELECT stage, COUNT(*) n, COALESCE(SUM(deal_value),0) total FROM contacts WHERE 1=1 ${owner} GROUP BY stage`).all(p);
  const pipeline = STAGES.map((s) => {
    const r = pipelineRows.find((x) => x.stage === s.key) || { n: 0, total: 0 };
    return { ...s, count: r.n, total: r.total };
  });
  const openValue = pipeline.filter((s) => !['ganado', 'perdido'].includes(s.key)).reduce((a, s) => a + s.total, 0);

  // Series diarias para gráficas.
  const days = [];
  for (let d = new Date(`${from}T00:00:00`); toDbDate(d) < to; d = addDays(d, 1)) days.push(toDbDate(d));
  const series = (sql) => {
    const rows = Object.fromEntries(db.prepare(sql).all(p).map((r) => [r.d, r.n]));
    return days.map((d) => rows[d] || 0);
  };
  const leadsSeries = series(`SELECT substr(created_at,1,10) d, COUNT(*) n FROM contacts WHERE created_at >= @f AND created_at < @t ${owner} GROUP BY d`);
  const salesSeries = series(`SELECT substr(won_at,1,10) d, SUM(deal_value) n FROM contacts WHERE stage='ganado' AND won_at >= @f AND won_at < @t ${owner} GROUP BY d`);

  const sources = db
    .prepare(`SELECT COALESCE(source,'Sin fuente') source, COUNT(*) n, SUM(stage='ganado') won FROM contacts WHERE created_at >= @f AND created_at < @t ${owner} GROUP BY 1 ORDER BY n DESC`)
    .all(p);

  return {
    newContacts,
    wonCount: won.n,
    revenue: won.total,
    lostCount: lost,
    avgTicket: won.n ? won.total / won.n : 0,
    leadToSale: newContacts ? won.n / newContacts : 0,
    closeRate: won.n + lost ? won.n / (won.n + lost) : 0,
    apptTotal,
    appts,
    showRate: attended + noShow ? attended / (attended + noShow) : 0,
    smsOut: msgs.out || 0,
    smsIn: msgs.in || 0,
    pipeline,
    openValue,
    days,
    leadsSeries,
    salesSeries,
    sources,
  };
}

function perUserStats({ from, to }) {
  const users = db.prepare('SELECT id, name, role, active FROM users ORDER BY active DESC, name').all();
  return users
    .map((u) => ({ user: u, stats: computeStats({ userId: u.id, from, to }) }))
    .filter((r) => r.user.active || r.stats.newContacts || r.stats.wonCount || r.stats.apptTotal);
}

// Rango de fechas a partir de ?range=7|30|90|365|mes
function resolveRange(q) {
  const today = new Date();
  const to = toDbDate(addDays(today, 1));
  const range = ['7', '30', '90', '365', 'mes'].includes(q) ? q : '30';
  const from = range === 'mes' ? toDbDate(new Date(today.getFullYear(), today.getMonth(), 1)) : toDbDate(addDays(today, -(Number(range) - 1)));
  return { range, from, to };
}

module.exports = { computeStats, perUserStats, resolveRange };
