const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-test-'));
process.env.DATABASE_PATH = path.join(tmp, 'test.db');
process.env.SESSION_SECRET = 'test-secret';
delete process.env.TWILIO_ACCOUNT_SID;
delete process.env.TWILIO_AUTH_TOKEN;
delete process.env.GOOGLE_CLIENT_ID;

require('../src/seed');
const db = require('../src/db');
const { start } = require('../src/server');
const sms = require('../src/sms');

let server;
let base;

// Cliente HTTP mínimo con cookies y token CSRF.
function client() {
  let cookie = '';
  let csrf = '';
  async function req(method, url, body, headers = {}) {
    const opts = { method, redirect: 'manual', headers: { cookie, ...headers } };
    if (body) {
      if (headers['Content-Type'] === 'application/json') opts.body = JSON.stringify({ ...body });
      else {
        opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
        opts.body = new URLSearchParams({ _csrf: csrf, ...body }).toString();
      }
    }
    const res = await fetch(base + url, opts);
    const set = res.headers.getSetCookie();
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
    const text = await res.text();
    const m = /name="_csrf" value="([a-f0-9]+)"/.exec(text) || /data-csrf="([a-f0-9]+)"/.exec(text);
    if (m) csrf = m[1];
    return { status: res.status, location: res.headers.get('location'), text };
  }
  return {
    get: (u) => req('GET', u),
    post: (u, b) => req('POST', u, b),
    json: (u, b) => req('POST', u, b, { 'Content-Type': 'application/json', 'x-csrf-token': csrf }),
    get csrf() { return csrf; },
    async login(email) {
      await req('GET', '/login');
      return req('POST', '/login', { email, password: 'Demo1234!' });
    },
  };
}

before(async () => {
  server = start(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('redirige a login sin sesión', async () => {
  const c = client();
  const r = await c.get('/contacts');
  assert.equal(r.status, 302);
  assert.equal(r.location, '/login');
});

test('rechaza contraseña incorrecta y POST sin CSRF', async () => {
  const c = client();
  await c.get('/login');
  const bad = await c.post('/login', { email: 'admin@demo.com', password: 'nope' });
  assert.equal(bad.status, 401);
  const res = await fetch(base + '/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'email=admin@demo.com&password=Demo1234!' });
  assert.equal(res.status, 403);
});

test('admin ve todas las secciones', async () => {
  const c = client();
  const login = await c.login('admin@demo.com');
  assert.equal(login.status, 302);
  for (const url of ['/', '/contacts', '/contacts/new', '/contacts/1', '/pipeline', '/appointments', '/conversations/3', '/properties', '/properties/1', '/properties/new', '/analytics', '/analytics?range=7&user=2', '/users', '/users/2/edit', '/profile', '/appointments/1/edit']) {
    const r = await c.get(url);
    assert.equal(r.status, 200, `${url} → ${r.status}`);
    assert.doesNotMatch(r.text, /Ocurrió un error/);
  }
  const analytics = await c.get('/analytics');
  assert.match(analytics.text, /Rendimiento por usuario/);
  assert.match(analytics.text, /Ana López/);
});

test('agente solo ve sus contactos y propiedades asignadas', async () => {
  const c = client();
  await c.login('luis@demo.com');
  const list = await c.get('/contacts');
  assert.match(list.text, /Jorge/);
  assert.doesNotMatch(list.text, /María González/); // de Ana
  const other = await c.get('/contacts/1'); // María, de Ana
  assert.equal(other.status, 404);
  const props = await c.get('/properties');
  assert.match(props.text, /Terreno Las Lomas/);
  assert.doesNotMatch(props.text, /Casa Jardines del Valle/);
  assert.equal((await c.get('/properties/1')).status, 404);
  assert.equal((await c.get('/users')).status, 403);
  assert.equal((await c.get('/properties/new')).status, 403);
  const analytics = await c.get('/analytics?user=2');
  assert.doesNotMatch(analytics.text, /Rendimiento por usuario/);
});

test('flujo de venta: crear contacto, cita con SMS, respuesta SI, cerrar venta', async () => {
  const c = client();
  await c.login('ana@demo.com');
  await c.get('/contacts/new');
  const created = await c.post('/contacts', { first_name: 'Prueba', last_name: 'Cliente', phone: '55 9999 0000', source: 'Facebook', stage: 'nuevo', property_id: '1' });
  assert.equal(created.status, 302);
  const id = Number(created.location.split('/').pop());
  const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
  assert.equal(contact.phone, '+525599990000');
  assert.equal(contact.owner_id, 2);

  const dup = await c.post('/contacts', { first_name: 'Otro', phone: '5599990000' });
  assert.equal(dup.status, 400);
  assert.match(dup.text, /Ya existe un contacto/);

  await c.get(`/contacts/${id}`);
  const d = new Date(Date.now() + 3 * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const appt = await c.post('/appointments', { contact_id: String(id), title: 'Visita', starts_at: local, duration_min: '60', send_sms: 'on', redirect: 'contact' });
  assert.equal(appt.status, 302);
  assert.equal(db.prepare('SELECT stage FROM contacts WHERE id = ?').get(id).stage, 'cita');
  const out = db.prepare("SELECT * FROM messages WHERE contact_id = ? AND direction = 'out'").all(id);
  assert.equal(out.length, 1);
  assert.equal(out[0].status, 'simulado');

  // Choque de horario
  await c.get('/appointments');
  await c.post('/appointments', { contact_id: String(id), starts_at: local, duration_min: '30' });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM appointments WHERE contact_id = ?').get(id).n, 1);

  // Respuesta simulada del cliente confirma la cita
  await c.get(`/conversations/${id}`);
  await c.post(`/conversations/${id}/simulate`, { body: 'SI' });
  assert.equal(db.prepare('SELECT status FROM appointments WHERE contact_id = ?').get(id).status, 'confirmada');

  // Mover a "ganado" desde el pipeline (JSON)
  await c.get('/pipeline');
  const won = await c.json(`/contacts/${id}/stage`, { stage: 'ganado', deal_value: '3450000' });
  assert.equal(won.status, 200);
  const after = db.prepare('SELECT stage, deal_value, won_at FROM contacts WHERE id = ?').get(id);
  assert.equal(after.stage, 'ganado');
  assert.equal(after.deal_value, 3450000);
  assert.ok(after.won_at);
});

test('webhook de Twilio valida firma y crea lead desde SMS entrante', async () => {
  process.env.TWILIO_ACCOUNT_SID = 'ACtest';
  process.env.TWILIO_AUTH_TOKEN = 'secret-token';
  process.env.BASE_URL = base;
  try {
    const params = { From: '+525577778888', To: '+15005550008', Body: 'Hola, me interesa el terreno', MessageSid: 'SM123' };
    const body = new URLSearchParams(params).toString();
    const unsigned = await fetch(base + '/webhooks/twilio/sms', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    assert.equal(unsigned.status, 403);

    const crypto = require('crypto');
    const url = base + '/webhooks/twilio/sms';
    const data = Object.keys(params).sort().reduce((a, k) => a + k + params[k], url);
    const sig = crypto.createHmac('sha1', 'secret-token').update(data).digest('base64');
    assert.ok(sms.validateSignature(url, params, sig));
    const ok = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': sig }, body });
    assert.equal(ok.status, 200);
    const lead = db.prepare('SELECT * FROM contacts WHERE phone = ?').get('+525577778888');
    assert.ok(lead);
    assert.equal(lead.owner_id, 3); // Luis es dueño del número +15005550008
    assert.equal(lead.source, 'SMS entrante');
    // Reintento con el mismo MessageSid no duplica
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': sig }, body });
    assert.equal(db.prepare('SELECT COUNT(*) n FROM messages WHERE contact_id = ?').get(lead.id).n, 1);
  } finally {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
  }
});

test('STOP da de baja al contacto de SMS', async () => {
  const { receiveInboundMessage, sendMessageToContact } = require('../src/services');
  receiveInboundMessage({ from: '+525512345005', to: '+15005550008', body: 'STOP' });
  const c = db.prepare('SELECT * FROM contacts WHERE phone = ?').get('+525512345005');
  assert.equal(c.sms_opt_out, 1);
  await assert.rejects(sendMessageToContact(null, c, 'hola'), /STOP/);
});

test('recordatorios automáticos de citas', async () => {
  const { sendAppointmentReminders } = require('../src/services');
  const sent = await sendAppointmentReminders();
  assert.ok(sent >= 1);
  assert.equal(await sendAppointmentReminders(), 0); // no se repiten
});
