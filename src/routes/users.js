const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAdmin } = require('../middleware');
const { str, toInt, normalizePhone } = require('../utils');
const { activeUsers } = require('../access');

const router = express.Router();
router.use(requireAdmin);

function readForm(b) {
  return {
    name: str(b.name, 120),
    email: str(b.email, 200),
    role: b.role === 'admin' ? 'admin' : 'agent',
    phone: normalizePhone(b.phone),
    sms_number: normalizePhone(b.sms_number),
  };
}

function validate(v, id = 0) {
  if (!v.name || !v.email || !/^\S+@\S+\.\S+$/.test(v.email)) return 'Nombre y correo válido son obligatorios.';
  if (db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').get(v.email, id)) return 'Ese correo ya está en uso.';
  if (v.sms_number && db.prepare('SELECT 1 FROM users WHERE sms_number = ? AND id != ?').get(v.sms_number, id)) return 'Ese número SMS ya está asignado a otro usuario.';
  return null;
}

const adminCount = () => db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'admin' AND active = 1").get().n;

function list(req, res, extra = {}) {
  const users = db
    .prepare(
      `SELECT u.*, (SELECT COUNT(*) FROM contacts WHERE owner_id = u.id) AS contacts,
         (SELECT COUNT(*) FROM property_access WHERE user_id = u.id) AS properties
       FROM users u ORDER BY u.active DESC, u.name`
    )
    .all();
  res.render('users/index', { title: 'Usuarios', users, values: {}, error: null, ...extra });
}

router.get('/', list);

router.post('/', async (req, res) => {
  const v = readForm(req.body);
  const password = String(req.body.password || '');
  let error = validate(v);
  if (!error && password && password.length < 8) error = 'La contraseña debe tener al menos 8 caracteres.';
  if (error) return list(req, res.status(400), { values: { ...v, phone: req.body.phone, sms_number: req.body.sms_number }, error });
  const hash = password ? await bcrypt.hash(password, 12) : null;
  const info = db.prepare('INSERT INTO users (name, email, password_hash, role, phone, sms_number) VALUES (?, ?, ?, ?, ?, ?)').run(v.name, v.email, hash, v.role, v.phone, v.sms_number);
  if (req.body.all_properties === 'on') {
    db.prepare('INSERT OR IGNORE INTO property_access (property_id, user_id) SELECT id, ? FROM properties').run(info.lastInsertRowid);
  }
  req.flash('success', `Usuario ${v.name} creado. ${hash ? 'Ya puede entrar con su correo y contraseña.' : 'Podrá entrar con Google usando ese correo.'}`);
  res.redirect('/users');
});

router.get('/:id/edit', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(toInt(req.params.id));
  if (!user) return res.redirect('/users');
  const properties = db.prepare('SELECT p.id, p.title, p.status, pa.user_id IS NOT NULL AS has_access FROM properties p LEFT JOIN property_access pa ON pa.property_id = p.id AND pa.user_id = ? ORDER BY p.title').all(user.id);
  res.render('users/edit', { title: `Editar ${user.name}`, user, properties, otherUsers: activeUsers().filter((u) => u.id !== user.id), error: null });
});

router.post('/:id', async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(toInt(req.params.id));
  if (!user) return res.redirect('/users');
  const v = readForm(req.body);
  const active = req.body.active === 'on' ? 1 : 0;
  const password = String(req.body.password || '');
  let error = validate(v, user.id);
  if (!error && password && password.length < 8) error = 'La contraseña debe tener al menos 8 caracteres.';
  const losingAdmin = user.role === 'admin' && user.active && (v.role !== 'admin' || !active);
  if (!error && losingAdmin && adminCount() <= 1) error = 'Debe existir al menos un administrador activo.';
  if (error) {
    const properties = db.prepare('SELECT p.id, p.title, p.status, pa.user_id IS NOT NULL AS has_access FROM properties p LEFT JOIN property_access pa ON pa.property_id = p.id AND pa.user_id = ? ORDER BY p.title').all(user.id);
    return res.status(400).render('users/edit', { title: `Editar ${user.name}`, user: { ...user, ...v, active }, properties, otherUsers: activeUsers().filter((u) => u.id !== user.id), error });
  }
  const tx = db.transaction(() => {
    db.prepare('UPDATE users SET name=?, email=?, role=?, phone=?, sms_number=?, active=? WHERE id=?').run(v.name, v.email, v.role, v.phone, v.sms_number, active, user.id);
    db.prepare('DELETE FROM property_access WHERE user_id = ?').run(user.id);
    const ids = (req.body.properties == null ? [] : [].concat(req.body.properties)).map(toInt).filter(Boolean);
    const ins = db.prepare('INSERT OR IGNORE INTO property_access (property_id, user_id) SELECT id, ? FROM properties WHERE id = ?');
    for (const id of ids) ins.run(user.id, id);
  });
  tx();
  if (password) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await bcrypt.hash(password, 12), user.id);
  req.flash('success', 'Usuario actualizado.');
  res.redirect('/users');
});

// Reasigna todos los contactos de un usuario a otro (útil cuando alguien deja el equipo).
router.post('/:id/reassign', (req, res) => {
  const from = toInt(req.params.id);
  const to = toInt(req.body.to_user);
  if (from && to && from !== to && db.prepare('SELECT 1 FROM users WHERE id = ? AND active = 1').get(to)) {
    const n = db.prepare('UPDATE contacts SET owner_id = ? WHERE owner_id = ?').run(to, from).changes;
    db.prepare("UPDATE appointments SET user_id = ? WHERE user_id = ? AND status IN ('programada','confirmada')").run(to, from);
    req.flash('success', `${n} contactos reasignados.`);
  }
  res.redirect('/users');
});

module.exports = router;
