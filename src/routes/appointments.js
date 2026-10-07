const express = require('express');
const db = require('../db');
const { APPOINTMENT_STATUSES } = require('../constants');
const { isAdmin, contactScope, getContactFor, propertiesFor, activeUsers, canAccessProperty } = require('../access');
const { logActivity, changeStage, sendMessageToContact, templateVars } = require('../services');
const { toInt, str, fromInputDateTime, toDbDate, toDbDateTime, addDays, parseDbDate, fmtDateTime, renderTemplate } = require('../utils');

const router = express.Router();
const STATUS_KEYS = APPOINTMENT_STATUSES.map((s) => s.key);

function weekStart(dateStr) {
  const d = dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? new Date(`${dateStr}T00:00:00`) : new Date();
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7; // lunes = 0
  return addDays(d, -dow);
}

function scopedContacts(user) {
  const s = contactScope(user);
  return db.prepare(`SELECT c.id, c.first_name, c.last_name, c.phone FROM contacts c WHERE c.stage != 'perdido' ${s.sql} ORDER BY c.first_name`).all(...s.params);
}

function readForm(req) {
  const b = req.body;
  return {
    contact_id: toInt(b.contact_id),
    user_id: isAdmin(req.user) && toInt(b.user_id) ? toInt(b.user_id) : req.user.id,
    property_id: toInt(b.property_id),
    title: str(b.title, 200) || 'Cita',
    starts_at: fromInputDateTime(b.starts_at),
    duration_min: Math.min(Math.max(toInt(b.duration_min) || 60, 15), 600),
    location: str(b.location, 300),
    notes: str(b.notes, 3000),
  };
}

function findConflict(v, ignoreId = 0) {
  const start = parseDbDate(v.starts_at);
  const end = new Date(start.getTime() + v.duration_min * 60000);
  const sameDay = db
    .prepare(
      `SELECT a.*, c.first_name, c.last_name FROM appointments a JOIN contacts c ON c.id = a.contact_id
       WHERE a.user_id = ? AND a.id != ? AND a.status IN ('programada','confirmada') AND substr(a.starts_at,1,10) = ?`
    )
    .all(v.user_id, ignoreId, v.starts_at.slice(0, 10));
  return sameDay.find((a) => {
    const s = parseDbDate(a.starts_at);
    const e = new Date(s.getTime() + a.duration_min * 60000);
    return s < end && start < e;
  });
}

function validate(req, v, ignoreId) {
  if (!v.contact_id || !getContactFor(req.user, v.contact_id)) return 'Selecciona un contacto válido.';
  if (!v.starts_at) return 'Indica fecha y hora.';
  if (v.property_id && !canAccessProperty(req.user, v.property_id)) return 'No tienes acceso a esa propiedad.';
  if (!db.prepare('SELECT 1 FROM users WHERE id = ? AND active = 1').get(v.user_id)) return 'El usuario asignado no es válido.';
  const c = findConflict(v, ignoreId);
  if (c) return `Choque de horario: ya hay una cita con ${c.first_name} ${c.last_name || ''} el ${fmtDateTime(c.starts_at)}.`;
  return null;
}

router.get('/', (req, res) => {
  const start = weekStart(req.query.week);
  const end = addDays(start, 7);
  const where = [];
  const params = [`${toDbDate(start)} 00:00:00`, `${toDbDate(end)} 00:00:00`];
  if (!isAdmin(req.user)) {
    where.push('a.user_id = ?');
    params.push(req.user.id);
  } else if (toInt(req.query.user)) {
    where.push('a.user_id = ?');
    params.push(toInt(req.query.user));
  }
  const appts = db
    .prepare(
      `SELECT a.*, c.first_name, c.last_name, c.phone, u.name AS user_name, p.title AS property_title
       FROM appointments a JOIN contacts c ON c.id = a.contact_id LEFT JOIN users u ON u.id = a.user_id LEFT JOIN properties p ON p.id = a.property_id
       WHERE a.starts_at >= ? AND a.starts_at < ? ${where.length ? ' AND ' + where.join(' AND ') : ''} ORDER BY a.starts_at`
    )
    .all(...params);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = toDbDate(addDays(start, i));
    days.push({ date: d, items: appts.filter((a) => a.starts_at.startsWith(d)) });
  }
  res.render('appointments', {
    title: 'Citas',
    days,
    today: toDbDate(),
    prevWeek: toDbDate(addDays(start, -7)),
    nextWeek: toDbDate(addDays(start, 7)),
    weekLabel: `${toDbDate(start)}`,
    filterUser: toInt(req.query.user),
    contacts: scopedContacts(req.user),
    users: activeUsers(),
    properties: propertiesFor(req.user),
    statuses: APPOINTMENT_STATUSES,
    preset: { contact_id: toInt(req.query.contact) },
  });
});

router.post('/', async (req, res) => {
  const v = readForm(req);
  const error = validate(req, v);
  const back = req.body.redirect === 'contact' && v.contact_id ? `/contacts/${v.contact_id}` : `/appointments?week=${v.starts_at ? toDbDate(weekStart(v.starts_at.slice(0, 10))) : ''}`;
  if (error) {
    req.flash('error', error);
    return res.redirect(back);
  }
  const info = db
    .prepare('INSERT INTO appointments (contact_id, user_id, property_id, title, starts_at, duration_min, location, notes) VALUES (@contact_id, @user_id, @property_id, @title, @starts_at, @duration_min, @location, @notes)')
    .run(v);
  const contact = getContactFor(req.user, v.contact_id);
  logActivity(contact.id, req.user.id, 'cita', `Cita agendada: ${v.title} — ${fmtDateTime(v.starts_at)}`);
  if (['nuevo', 'contactado'].includes(contact.stage)) changeStage(contact, 'cita', req.user);

  let msg = 'Cita agendada.';
  if (req.body.send_sms === 'on') {
    const assigned = db.prepare('SELECT * FROM users WHERE id = ?').get(v.user_id);
    const body = renderTemplate('Hola {nombre}, te confirmo tu cita "{titulo}" el {fecha}{lugar}. Responde SI para confirmar. - {agente}', {
      ...templateVars(contact, assigned),
      titulo: v.title,
      fecha: fmtDateTime(v.starts_at),
      lugar: v.location ? ` en ${v.location}` : '',
    });
    try {
      const r = await sendMessageToContact(assigned, contact, body);
      msg += r.status === 'failed' ? ` No se pudo enviar el SMS: ${r.error}` : ' SMS de confirmación enviado.';
    } catch (e) {
      msg += ` SMS no enviado: ${e.message}`;
    }
  }
  req.flash('success', msg);
  res.redirect(back.includes('/contacts/') ? back : `/appointments?week=${toDbDate(weekStart(v.starts_at.slice(0, 10)))}#a${info.lastInsertRowid}`);
});

function getApptFor(user, id) {
  const a = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
  if (!a) return null;
  if (!isAdmin(user) && a.user_id !== user.id) return null;
  return a;
}

router.get('/:id/edit', (req, res) => {
  const appt = getApptFor(req.user, toInt(req.params.id));
  if (!appt) return res.redirect('/appointments');
  res.render('appointment-edit', { title: 'Editar cita', appt, contacts: scopedContacts(req.user), users: activeUsers(), properties: propertiesFor(req.user), statuses: APPOINTMENT_STATUSES, error: null });
});

router.post('/:id', (req, res) => {
  const appt = getApptFor(req.user, toInt(req.params.id));
  if (!appt) return res.redirect('/appointments');
  const v = readForm(req);
  const status = STATUS_KEYS.includes(req.body.status) ? req.body.status : appt.status;
  const error = ['programada', 'confirmada'].includes(status) ? validate(req, v, appt.id) : !v.starts_at ? 'Indica fecha y hora.' : null;
  if (error) {
    return res.status(400).render('appointment-edit', { title: 'Editar cita', appt: { ...appt, ...v }, contacts: scopedContacts(req.user), users: activeUsers(), properties: propertiesFor(req.user), statuses: APPOINTMENT_STATUSES, error });
  }
  const rescheduled = v.starts_at !== appt.starts_at;
  db.prepare(
    `UPDATE appointments SET contact_id=@contact_id, user_id=@user_id, property_id=@property_id, title=@title, starts_at=@starts_at,
       duration_min=@duration_min, location=@location, notes=@notes, status=@status, reminder_sent_at=@reminder WHERE id=@id`
  ).run({ ...v, status, reminder: rescheduled ? null : appt.reminder_sent_at, id: appt.id });
  if (rescheduled) logActivity(v.contact_id, req.user.id, 'cita', `Cita reprogramada a ${fmtDateTime(v.starts_at)}`);
  req.flash('success', 'Cita actualizada.');
  res.redirect(`/appointments?week=${toDbDate(weekStart(v.starts_at.slice(0, 10)))}`);
});

router.post('/:id/status', (req, res) => {
  const appt = getApptFor(req.user, toInt(req.params.id));
  if (appt && STATUS_KEYS.includes(req.body.status)) {
    db.prepare('UPDATE appointments SET status = ? WHERE id = ?').run(req.body.status, appt.id);
    const label = APPOINTMENT_STATUSES.find((s) => s.key === req.body.status).label;
    logActivity(appt.contact_id, req.user.id, 'cita', `Cita del ${fmtDateTime(appt.starts_at)}: ${label}`);
    if (req.body.status === 'completada') {
      const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(appt.contact_id);
      if (['nuevo', 'contactado', 'cita'].includes(contact.stage)) changeStage(contact, 'propuesta', req.user);
      // Crea tarea de seguimiento automática para el día siguiente.
      db.prepare('INSERT INTO tasks (contact_id, user_id, title, due_at) VALUES (?, ?, ?, ?)').run(
        appt.contact_id,
        appt.user_id || req.user.id,
        'Dar seguimiento después de la cita',
        toDbDateTime(addDays(new Date(), 1)).slice(0, 16) + ':00'
      );
    }
  }
  const ref = req.get('referer') || '';
  res.redirect(ref.startsWith(`${req.protocol}://${req.get('host')}/`) ? ref : '/appointments');
});

router.post('/:id/delete', (req, res) => {
  const appt = getApptFor(req.user, toInt(req.params.id));
  if (appt) {
    db.prepare('DELETE FROM appointments WHERE id = ?').run(appt.id);
    logActivity(appt.contact_id, req.user.id, 'cita', `Cita del ${fmtDateTime(appt.starts_at)} eliminada`);
    req.flash('success', 'Cita eliminada.');
  }
  res.redirect('/appointments');
});

module.exports = router;
