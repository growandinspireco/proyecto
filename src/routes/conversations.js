const express = require('express');
const db = require('../db');
const sms = require('../sms');
const { SMS_TEMPLATES } = require('../constants');
const { contactScope, getContactFor } = require('../access');
const { receiveInboundMessage, templateVars } = require('../services');
const { toInt, str, renderTemplate, fmtDateTime, toDbDateTime } = require('../utils');

const router = express.Router();

function threadList(user, q) {
  const s = contactScope(user);
  const params = [...s.params];
  let filter = '';
  if (q) {
    filter = " AND (c.first_name || ' ' || COALESCE(c.last_name,'') LIKE ? OR c.phone LIKE ?)";
    params.push(`%${q}%`, `%${q}%`);
  }
  return db
    .prepare(
      `SELECT c.id, c.first_name, c.last_name, c.phone, c.stage,
         m.body AS last_body, m.direction AS last_direction, m.created_at AS last_at,
         (SELECT COUNT(*) FROM messages WHERE contact_id = c.id AND direction = 'in' AND is_read = 0) AS unread
       FROM contacts c JOIN messages m ON m.id = (SELECT MAX(id) FROM messages WHERE contact_id = c.id)
       WHERE 1=1 ${s.sql} ${filter} ORDER BY m.id DESC LIMIT 200`
    )
    .all(...params);
}

function messagesFor(contactId, afterId = 0) {
  return db
    .prepare('SELECT m.*, u.name AS user_name FROM messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.contact_id = ? AND m.id > ? ORDER BY m.id')
    .all(contactId, afterId);
}

router.get('/', (req, res) => {
  const threads = threadList(req.user, str(req.query.q, 100));
  if (threads.length && !req.query.q) return res.redirect(`/conversations/${threads[0].id}`);
  res.render('conversations', { title: 'Conversaciones', threads, active: null, messages: [], templates: [], q: req.query.q || '', contacts: newConvContacts(req.user) });
});

function newConvContacts(user) {
  const s = contactScope(user);
  return db.prepare(`SELECT c.id, c.first_name, c.last_name, c.phone FROM contacts c WHERE c.phone IS NOT NULL ${s.sql} ORDER BY c.first_name`).all(...s.params);
}

router.get('/new', (req, res) => res.redirect(`/conversations/${toInt(req.query.contact) || ''}`));

router.get('/:id', (req, res) => {
  const contact = getContactFor(req.user, toInt(req.params.id));
  if (!contact) return res.redirect('/conversations');
  db.prepare("UPDATE messages SET is_read = 1 WHERE contact_id = ? AND direction = 'in' AND is_read = 0").run(contact.id);
  const next = db
    .prepare("SELECT starts_at FROM appointments WHERE contact_id = ? AND status IN ('programada','confirmada') AND starts_at >= ? ORDER BY starts_at LIMIT 1")
    .get(contact.id, toDbDateTime());
  const vars = templateVars(contact, req.user, { fecha: next ? fmtDateTime(next.starts_at) : '{fecha}' });
  res.render('conversations', {
    title: 'Conversaciones',
    threads: threadList(req.user, str(req.query.q, 100)),
    active: contact,
    messages: messagesFor(contact.id),
    templates: SMS_TEMPLATES.map((t) => ({ name: t.name, body: renderTemplate(t.body, vars) })),
    q: req.query.q || '',
    contacts: newConvContacts(req.user),
    fromNumber: req.user.sms_number || process.env.TWILIO_DEFAULT_NUMBER || null,
  });
});

// Mensajes nuevos (polling cada pocos segundos desde la vista).
router.get('/:id/messages.json', (req, res) => {
  const contact = getContactFor(req.user, toInt(req.params.id));
  if (!contact) return res.status(404).json({ error: 'No encontrado' });
  const msgs = messagesFor(contact.id, toInt(req.query.after) || 0);
  if (msgs.length) db.prepare("UPDATE messages SET is_read = 1 WHERE contact_id = ? AND direction = 'in' AND is_read = 0").run(contact.id);
  res.json({ messages: msgs.map((m) => ({ id: m.id, direction: m.direction, body: m.body, status: m.status, created_at: m.created_at, user_name: m.user_name })) });
});

// Solo en modo simulación: permite probar una respuesta del cliente sin Twilio.
router.post('/:id/simulate', (req, res) => {
  const contact = getContactFor(req.user, toInt(req.params.id));
  if (!contact || sms.isConfigured()) return res.redirect('/conversations');
  const body = str(req.body.body, 1600);
  if (body && contact.phone) receiveInboundMessage({ from: contact.phone, to: req.user.sms_number || process.env.TWILIO_DEFAULT_NUMBER || '', body, sid: null });
  db.prepare("UPDATE messages SET is_read = 1 WHERE contact_id = ? AND direction = 'in'").run(contact.id);
  res.redirect(`/conversations/${contact.id}`);
});

module.exports = router;
