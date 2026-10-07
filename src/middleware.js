const crypto = require('crypto');
const db = require('./db');

const getUser = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1');

function loadUser(req, res, next) {
  const user = req.session.userId ? getUser.get(req.session.userId) : null;
  if (req.session.userId && !user) delete req.session.userId; // usuario desactivado o eliminado
  req.user = user || null;
  res.locals.currentUser = req.user;
  res.locals.isAdmin = !!(user && user.role === 'admin');
  res.locals.path = req.path;
  next();
}

function requireAuth(req, res, next) {
  if (req.user) return next();
  if (req.accepts(['html', 'json']) === 'json') return res.status(401).json({ error: 'No autenticado' });
  req.session.returnTo = req.originalUrl;
  res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  res.status(403).render('error', { title: 'Sin permiso', message: 'Esta sección es solo para administradores.' });
}

function flash(req, res, next) {
  res.locals.flash = req.session.flash || [];
  delete req.session.flash;
  req.flash = (type, text) => {
    req.session.flash = req.session.flash || [];
    req.session.flash.push({ type, text });
  };
  next();
}

// Protección CSRF con token por sesión (formularios: campo _csrf; fetch: cabecera x-csrf-token).
function csrf(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.locals.csrfToken = req.session.csrf;
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const token = (req.body && req.body._csrf) || req.get('x-csrf-token') || '';
  const a = Buffer.from(String(token));
  const b = Buffer.from(req.session.csrf);
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
  res.status(403).render('error', { title: 'Sesión expirada', message: 'El formulario expiró. Recarga la página e inténtalo de nuevo.' });
}

module.exports = { loadUser, requireAuth, requireAdmin, flash, csrf };
