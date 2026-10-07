require('dotenv').config({ quiet: true });
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const passport = require('passport');

const db = require('./db');
const SqliteStore = require('./session-store');
const { contactScope } = require('./access');
const { loadUser, requireAuth, flash, csrf } = require('./middleware');
const { viewHelpers } = require('./utils');
const { STAGES } = require('./constants');
const sms = require('./sms');
const { sendAppointmentReminders } = require('./services');

const app = express();
const isProd = process.env.NODE_ENV === 'production';

if (isProd && !process.env.SESSION_SECRET) {
  console.error('Falta SESSION_SECRET en producción. Revisa el archivo .env');
  process.exit(1);
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        'img-src': ["'self'", 'data:', 'https://*.googleusercontent.com'],
        'form-action': ["'self'", 'https://accounts.google.com'],
        'upgrade-insecure-requests': isProd ? [] : null,
      },
    },
    hsts: isProd,
  })
);
app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: isProd ? '1d' : 0 }));
app.use('/vendor/chart.js', express.static(path.join(__dirname, '..', 'node_modules', 'chart.js', 'dist')));

// Webhooks de Twilio: van antes de sesión y CSRF (Twilio no tiene cookie; se validan por firma).
app.use('/webhooks', express.urlencoded({ extended: false }), require('./routes/webhooks'));

app.use(express.urlencoded({ extended: false, limit: '200kb' }));
app.use(express.json({ limit: '200kb' }));
app.use(
  session({
    name: 'crm.sid',
    store: new SqliteStore(),
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { httpOnly: true, sameSite: 'lax', secure: isProd, maxAge: 7 * 24 * 3600 * 1000 },
  })
);
app.use(passport.initialize());
app.use((req, res, next) => {
  Object.assign(res.locals, viewHelpers);
  res.locals.smsLive = sms.isConfigured();
  res.locals.STAGES = STAGES;
  res.locals.appName = process.env.APP_NAME || 'CRM Ventas';
  next();
});
app.use(loadUser);
app.use(flash);
app.use(csrf);

app.use(require('./routes/auth'));
app.use(requireAuth);
app.use((req, res, next) => {
  const s = contactScope(req.user);
  res.locals.unreadCount = db
    .prepare(`SELECT COUNT(*) n FROM messages m JOIN contacts c ON c.id = m.contact_id WHERE m.direction = 'in' AND m.is_read = 0 ${s.sql}`)
    .get(...s.params).n;
  next();
});
app.use('/', require('./routes/dashboard'));
app.use('/contacts', require('./routes/contacts'));
app.use('/pipeline', require('./routes/pipeline'));
app.use('/appointments', require('./routes/appointments'));
app.use('/conversations', require('./routes/conversations'));
app.use('/properties', require('./routes/properties'));
app.use('/analytics', require('./routes/analytics'));
app.use('/users', require('./routes/users'));
app.use('/profile', require('./routes/profile'));
app.use('/tasks', require('./routes/tasks'));

app.use((req, res) => res.status(404).render('error', { title: 'No encontrado', message: 'La página que buscas no existe o no tienes acceso.' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Error', message: 'Ocurrió un error inesperado.' });
});

function start(port = process.env.PORT || 3000) {
  const server = app.listen(port, () => {
    console.log(`CRM listo en http://localhost:${server.address().port}`);
    console.log(sms.isConfigured() ? 'SMS: Twilio conectado.' : 'SMS: modo simulación (configura Twilio en .env para enviar SMS reales).');
  });
  const timer = setInterval(() => sendAppointmentReminders().catch((e) => console.error(e)), 5 * 60 * 1000);
  timer.unref();
  server.on('close', () => clearInterval(timer));
  return server;
}

if (require.main === module) start();

module.exports = { app, start };
