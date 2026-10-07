const express = require('express');
const bcrypt = require('bcryptjs');
const passport = require('passport');
const rateLimit = require('express-rate-limit');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const db = require('../db');
const { toDbDateTime, str } = require('../utils');
const { baseUrl } = require('../sms');

const router = express.Router();

const googleEnabled = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const userCount = () => db.prepare('SELECT COUNT(*) n FROM users').get().n;
const signupOpen = () => userCount() === 0 || process.env.ALLOW_SIGNUP === 'true';

if (googleEnabled) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: `${baseUrl()}/auth/google/callback`,
      },
      (accessToken, refreshToken, profile, done) => {
        const email = profile.emails && profile.emails.find((e) => e.verified !== false);
        if (!email) return done(null, false, { message: 'Tu cuenta de Google no tiene un correo verificado.' });
        let user = db.prepare('SELECT * FROM users WHERE google_id = ?').get(profile.id) || db.prepare('SELECT * FROM users WHERE email = ?').get(email.value);
        if (!user) {
          if (!signupOpen()) return done(null, false, { message: `El correo ${email.value} no está autorizado. Pide al administrador que te dé de alta.` });
          const role = userCount() === 0 ? 'admin' : 'agent';
          const info = db.prepare('INSERT INTO users (name, email, google_id, role) VALUES (?, ?, ?, ?)').run(profile.displayName || email.value, email.value, profile.id, role);
          user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
        }
        if (!user.active) return done(null, false, { message: 'Tu usuario está desactivado.' });
        if (!user.google_id) db.prepare('UPDATE users SET google_id = ? WHERE id = ?').run(profile.id, user.id);
        done(null, user);
      }
    )
  );
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res) => res.status(429).render('login', { googleEnabled, signupOpen: signupOpen(), email: req.body.email || '', error: 'Demasiados intentos. Espera 15 minutos.' }),
});

// Regenera la sesión al iniciar sesión (evita fijación de sesión).
function startSession(req, res, user) {
  const returnTo = req.session.returnTo;
  req.session.regenerate((err) => {
    if (err) return res.status(500).render('error', { title: 'Error', message: 'No se pudo iniciar sesión.' });
    req.session.userId = user.id;
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(toDbDateTime(), user.id);
    const target = returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/';
    req.session.save(() => res.redirect(target));
  });
}

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { googleEnabled, signupOpen: signupOpen(), email: '', error: req.query.error || null });
});

router.post('/login', loginLimiter, async (req, res) => {
  const email = str(req.body.email, 200) || '';
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const ok = user && user.password_hash && (await bcrypt.compare(String(req.body.password || ''), user.password_hash));
  if (!ok || !user.active) {
    return res.status(401).render('login', { googleEnabled, signupOpen: signupOpen(), email, error: !ok ? 'Correo o contraseña incorrectos.' : 'Tu usuario está desactivado.' });
  }
  startSession(req, res, user);
});

router.get('/register', (req, res) => {
  if (!signupOpen()) return res.redirect('/login');
  res.render('register', { firstUser: userCount() === 0, values: {}, error: null });
});

router.post('/register', async (req, res) => {
  if (!signupOpen()) return res.redirect('/login');
  const values = { name: str(req.body.name, 120), email: str(req.body.email, 200) };
  const password = String(req.body.password || '');
  let error = null;
  if (!values.name || !values.email || !/^\S+@\S+\.\S+$/.test(values.email)) error = 'Escribe tu nombre y un correo válido.';
  else if (password.length < 8) error = 'La contraseña debe tener al menos 8 caracteres.';
  else if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(values.email)) error = 'Ese correo ya está registrado.';
  if (error) return res.status(400).render('register', { firstUser: userCount() === 0, values, error });

  const role = userCount() === 0 ? 'admin' : 'agent';
  const hash = await bcrypt.hash(password, 12);
  const info = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)').run(values.name, values.email, hash, role);
  startSession(req, res, db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid));
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('crm.sid');
    res.redirect('/login');
  });
});

if (googleEnabled) {
  router.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'], session: false, prompt: 'select_account' }));
  router.get('/auth/google/callback', (req, res, next) => {
    passport.authenticate('google', { session: false }, (err, user, info) => {
      if (err) return next(err);
      if (!user) return res.redirect('/login?error=' + encodeURIComponent((info && info.message) || 'No se pudo iniciar sesión con Google.'));
      startSession(req, res, user);
    })(req, res, next);
  });
}

module.exports = router;
