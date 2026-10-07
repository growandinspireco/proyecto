const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { str, normalizePhone } = require('../utils');

const router = express.Router();

router.get('/', (req, res) => res.render('profile', { title: 'Mi perfil', error: null }));

router.post('/', (req, res) => {
  const name = str(req.body.name, 120);
  const phone = normalizePhone(req.body.phone);
  const smsNumber = normalizePhone(req.body.sms_number);
  let error = null;
  if (!name) error = 'El nombre es obligatorio.';
  else if (smsNumber && db.prepare('SELECT 1 FROM users WHERE sms_number = ? AND id != ?').get(smsNumber, req.user.id)) error = 'Ese número SMS ya lo usa otro usuario.';
  if (error) return res.status(400).render('profile', { title: 'Mi perfil', error });
  db.prepare('UPDATE users SET name = ?, phone = ?, sms_number = ? WHERE id = ?').run(name, phone, smsNumber, req.user.id);
  req.flash('success', 'Perfil actualizado.');
  res.redirect('/profile');
});

router.post('/password', async (req, res) => {
  const current = String(req.body.current || '');
  const next = String(req.body.password || '');
  if (req.user.password_hash && !(await bcrypt.compare(current, req.user.password_hash))) {
    return res.status(400).render('profile', { title: 'Mi perfil', error: 'La contraseña actual no es correcta.' });
  }
  if (next.length < 8) return res.status(400).render('profile', { title: 'Mi perfil', error: 'La nueva contraseña debe tener al menos 8 caracteres.' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await bcrypt.hash(next, 12), req.user.id);
  req.flash('success', 'Contraseña actualizada.');
  res.redirect('/profile');
});

module.exports = router;
