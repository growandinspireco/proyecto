const express = require('express');
const db = require('../db');
const { STAGE_KEYS, LEAD_SOURCES, SMS_TEMPLATES } = require('../constants');
const { isAdmin, contactScope, getContactFor, propertiesFor, activeUsers, canAccessProperty } = require('../access');
const { logActivity, changeStage, sendMessageToContact, templateVars } = require('../services');
const { normalizePhone, str, toInt, toNumber, toDbDateTime, fromInputDateTime, fmtDateTime, renderTemplate } = require('../utils');

const router = express.Router();

function readForm(req) {
  const b = req.body;
  return {
    first_name: str(b.first_name, 100),
    last_name: str(b.last_name, 100),
    phone: normalizePhone(b.phone),
    email: str(b.email, 200),
    source: str(b.source, 60),
    tags: str(b.tags, 300),
    stage: STAGE_KEYS.includes(b.stage) ? b.stage : 'nuevo',
    deal_value: toNumber(b.deal_value) || 0,
    owner_id: toInt(b.owner_id),
    property_id: toInt(b.property_id),
    notes: str(b.notes, 5000),
  };
}

function validate(req, v, currentId) {
  if (!v.first_name) return 'El nombre es obligatorio.';
  if (!v.phone && !v.email) return 'Agrega al menos un teléfono o correo.';
  if (v.phone && !/^\+\d{8,15}$/.test(v.phone)) return 'El teléfono no es válido.';
  if (v.email && !/^\S+@\S+\.\S+$/.test(v.email)) return 'El correo no es válido.';
  if (v.owner_id && !db.prepare('SELECT 1 FROM users WHERE id = ? AND active = 1').get(v.owner_id)) return 'El usuario asignado no es válido.';
  if (v.property_id && !canAccessProperty(req.user, v.property_id)) return 'No tienes acceso a esa propiedad.';
  if (v.phone) {
    const dup = db.prepare('SELECT id, first_name, last_name, owner_id FROM contacts WHERE phone = ? AND id != ?').get(v.phone, currentId || 0);
    if (dup && (isAdmin(req.user) || dup.owner_id === req.user.id)) return `Ya existe un contacto con ese teléfono: ${dup.first_name} ${dup.last_name || ''} (#${dup.id}).`;
    if (dup) return 'Ya existe un contacto con ese teléfono asignado a otro usuario. Pide al administrador que te lo reasigne.';
  }
  return null;
}

function formLocals(req, extra) {
  return { title: 'Contacto', users: activeUsers(), properties: propertiesFor(req.user), sources: LEAD_SOURCES, ...extra };
}

router.get('/', (req, res) => {
  const s = contactScope(req.user);
  const where = [];
  const params = [...s.params];
  const q = str(req.query.q, 100);
  if (q) {
    where.push("(c.first_name || ' ' || COALESCE(c.last_name,'') LIKE ? OR c.phone LIKE ? OR c.email LIKE ? OR c.tags LIKE ?)");
    const like = `%${q}%`;
    params.push(like, `%${q.replace(/\D/g, '') || q}%`, like, like);
  }
  if (STAGE_KEYS.includes(req.query.stage)) {
    where.push('c.stage = ?');
    params.push(req.query.stage);
  }
  if (isAdmin(req.user) && toInt(req.query.owner)) {
    where.push('c.owner_id = ?');
    params.push(toInt(req.query.owner));
  }
  const contacts = db
    .prepare(
      `SELECT c.*, u.name AS owner_name, p.title AS property_title,
         (SELECT MIN(starts_at) FROM appointments a WHERE a.contact_id = c.id AND a.starts_at >= ? AND a.status IN ('programada','confirmada')) AS next_appt
       FROM contacts c LEFT JOIN users u ON u.id = c.owner_id LEFT JOIN properties p ON p.id = c.property_id
       WHERE 1=1 ${s.sql} ${where.length ? ' AND ' + where.join(' AND ') : ''}
       ORDER BY COALESCE(c.last_activity_at, c.created_at) DESC LIMIT 500`
    )
    .all(toDbDateTime(), ...params);
  res.render('contacts/index', { title: 'Contactos', contacts, users: activeUsers(), query: req.query });
});

router.get('/new', (req, res) => {
  res.render('contacts/form', formLocals(req, { title: 'Nuevo contacto', contact: { owner_id: req.user.id, stage: 'nuevo' }, error: null }));
});

router.post('/', (req, res) => {
  const v = readForm(req);
  v.owner_id = isAdmin(req.user) ? v.owner_id || req.user.id : req.user.id;
  const error = validate(req, v);
  if (error) return res.status(400).render('contacts/form', formLocals(req, { title: 'Nuevo contacto', contact: { ...v, phone: req.body.phone }, error }));
  const now = toDbDateTime();
  const info = db
    .prepare(
      `INSERT INTO contacts (first_name, last_name, phone, email, source, tags, stage, deal_value, owner_id, property_id, notes, won_at, last_activity_at)
       VALUES (@first_name, @last_name, @phone, @email, @source, @tags, @stage, @deal_value, @owner_id, @property_id, @notes, @won_at, @now)`
    )
    .run({ ...v, won_at: v.stage === 'ganado' ? now : null, now });
  logActivity(info.lastInsertRowid, req.user.id, 'creado', 'Contacto creado');
  req.flash('success', 'Contacto creado.');
  res.redirect(`/contacts/${info.lastInsertRowid}`);
});

router.get('/:id', (req, res) => {
  const contact = getContactFor(req.user, toInt(req.params.id));
  if (!contact) return res.status(404).render('error', { title: 'No encontrado', message: 'El contacto no existe o no tienes acceso.' });
  const owner = contact.owner_id ? db.prepare('SELECT id, name FROM users WHERE id = ?').get(contact.owner_id) : null;
  const property = contact.property_id ? db.prepare('SELECT * FROM properties WHERE id = ?').get(contact.property_id) : null;
  const appointments = db
    .prepare('SELECT a.*, u.name AS user_name, p.title AS property_title FROM appointments a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN properties p ON p.id = a.property_id WHERE a.contact_id = ? ORDER BY a.starts_at DESC')
    .all(contact.id);
  const tasks = db.prepare('SELECT t.*, u.name AS user_name FROM tasks t LEFT JOIN users u ON u.id = t.user_id WHERE t.contact_id = ? ORDER BY t.done, t.due_at').all(contact.id);
  const activities = db.prepare('SELECT a.*, u.name AS user_name FROM activities a LEFT JOIN users u ON u.id = a.user_id WHERE a.contact_id = ? ORDER BY a.id DESC LIMIT 100').all(contact.id);
  const messages = db.prepare('SELECT * FROM messages WHERE contact_id = ? ORDER BY id DESC LIMIT 5').all(contact.id).reverse();
  const nextAppt = appointments.filter((a) => ['programada', 'confirmada'].includes(a.status) && a.starts_at >= toDbDateTime()).pop();
  const vars = templateVars(contact, req.user, { fecha: nextAppt ? fmtDateTime(nextAppt.starts_at) : '{fecha}', propiedad: property ? property.title : '' });
  const templates = SMS_TEMPLATES.map((t) => ({ name: t.name, body: renderTemplate(t.body, vars) }));
  res.render('contacts/show', {
    title: `${contact.first_name} ${contact.last_name || ''}`,
    contact,
    owner,
    property,
    appointments,
    tasks,
    activities,
    messages,
    templates,
    users: activeUsers(),
    properties: propertiesFor(req.user),
  });
});

router.get('/:id/edit', (req, res) => {
  const contact = getContactFor(req.user, toInt(req.params.id));
  if (!contact) return res.redirect('/contacts');
  res.render('contacts/form', formLocals(req, { title: 'Editar contacto', contact, error: null }));
});

router.post('/:id', (req, res) => {
  const contact = getContactFor(req.user, toInt(req.params.id));
  if (!contact) return res.redirect('/contacts');
  const v = readForm(req);
  if (!isAdmin(req.user)) v.owner_id = contact.owner_id;
  const error = validate(req, v, contact.id);
  if (error) return res.status(400).render('contacts/form', formLocals(req, { title: 'Editar contacto', contact: { ...contact, ...v, phone: req.body.phone }, error }));
  const newStage = v.stage;
  v.stage = contact.stage;
  db.prepare(
    `UPDATE contacts SET first_name=@first_name, last_name=@last_name, phone=@phone, email=@email, source=@source, tags=@tags,
       deal_value=@deal_value, owner_id=@owner_id, property_id=@property_id, notes=@notes, updated_at=@now WHERE id=@id`
  ).run({ ...v, now: toDbDateTime(), id: contact.id });
  if (newStage !== contact.stage) changeStage(contact, newStage, req.user);
  if (v.owner_id !== contact.owner_id) {
    const u = v.owner_id ? db.prepare('SELECT name FROM users WHERE id = ?').get(v.owner_id) : null;
    logActivity(contact.id, req.user.id, 'asignado', `Asignado a ${u ? u.name : 'nadie'}`);
  }
  req.flash('success', 'Contacto actualizado.');
  res.redirect(`/contacts/${contact.id}`);
});

router.post('/:id/delete', (req, res) => {
  const contact = getContactFor(req.user, toInt(req.params.id));
  if (!contact || !isAdmin(req.user)) {
    req.flash('error', 'Solo un administrador puede eliminar contactos.');
    return res.redirect(contact ? `/contacts/${contact.id}` : '/contacts');
  }
  db.prepare('DELETE FROM contacts WHERE id = ?').run(contact.id);
  req.flash('success', 'Contacto eliminado.');
  res.redirect('/contacts');
});

// Cambio de etapa (formulario o fetch desde el pipeline).
router.post('/:id/stage', (req, res) => {
  const contact = getContactFor(req.user, toInt(req.params.id));
  const wantsJson = req.is('json');
  if (!contact || !STAGE_KEYS.includes(req.body.stage)) {
    return wantsJson ? res.status(400).json({ error: 'Solicitud inválida' }) : res.redirect('/contacts');
  }
  changeStage(contact, req.body.stage, req.user, { dealValue: toNumber(req.body.deal_value), lostReason: str(req.body.lost_reason, 300) });
  if (wantsJson) return res.json({ ok: true });
  req.flash('success', 'Etapa actualizada.');
  res.redirect(req.get('referer') && req.get('referer').includes('/pipeline') ? '/pipeline' : `/contacts/${contact.id}`);
});

router.post('/:id/notes', (req, res) => {
  const contact = getContactFor(req.user, toInt(req.params.id));
  const body = str(req.body.body, 5000);
  if (contact && body) {
    const type = ['nota', 'llamada', 'correo'].includes(req.body.type) ? req.body.type : 'nota';
    logActivity(contact.id, req.user.id, type, body);
    if (type === 'llamada' && contact.stage === 'nuevo') changeStage(contact, 'contactado', req.user);
  }
  res.redirect(`/contacts/${req.params.id}#actividad`);
});

router.post('/:id/sms', async (req, res) => {
  const contact = getContactFor(req.user, toInt(req.params.id));
  if (!contact) return res.redirect('/contacts');
  try {
    const r = await sendMessageToContact(req.user, contact, req.body.body);
    if (r.status === 'failed') req.flash('error', `No se pudo enviar: ${r.error}`);
    else req.flash('success', r.status === 'simulado' ? 'SMS guardado (modo simulación).' : 'SMS enviado.');
  } catch (e) {
    req.flash('error', e.message);
  }
  res.redirect(req.body.redirect === 'conversation' ? `/conversations/${contact.id}` : `/contacts/${contact.id}`);
});

router.post('/:id/tasks', (req, res) => {
  const contact = getContactFor(req.user, toInt(req.params.id));
  const title = str(req.body.title, 300);
  if (contact && title) {
    const assignee = isAdmin(req.user) && toInt(req.body.user_id) ? toInt(req.body.user_id) : req.user.id;
    db.prepare('INSERT INTO tasks (contact_id, user_id, title, due_at) VALUES (?, ?, ?, ?)').run(contact.id, assignee, title, fromInputDateTime(req.body.due_at));
    logActivity(contact.id, req.user.id, 'tarea', `Tarea creada: ${title}`);
  }
  res.redirect(`/contacts/${req.params.id}`);
});

module.exports = router;
