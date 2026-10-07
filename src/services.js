const db = require('./db');
const sms = require('./sms');
const { toDbDateTime, fullName, fmtDateTime, renderTemplate, normalizePhone, stage: stageInfo } = require('./utils');

function logActivity(contactId, userId, type, body) {
  db.prepare('INSERT INTO activities (contact_id, user_id, type, body) VALUES (?, ?, ?, ?)').run(contactId, userId || null, type, body || null);
  db.prepare('UPDATE contacts SET last_activity_at = ? WHERE id = ?').run(toDbDateTime(), contactId);
}

// Número desde el que se envía: el del usuario (cada agente tiene el suyo) o el general.
function senderNumber(user) {
  return (user && user.sms_number) || process.env.TWILIO_DEFAULT_NUMBER || null;
}

function templateVars(contact, user, extra = {}) {
  return { nombre: contact.first_name, agente: user ? user.name.split(' ')[0] : '', ...extra };
}

async function sendMessageToContact(user, contact, body) {
  body = String(body || '').trim().slice(0, 1600);
  if (!body) throw new Error('El mensaje está vacío.');
  if (!contact.phone) throw new Error('El contacto no tiene teléfono.');
  if (contact.sms_opt_out) throw new Error('El contacto pidió no recibir SMS (STOP).');

  const from = senderNumber(user);
  const result = await sms.sendSms({ from, to: contact.phone, body });
  const info = db
    .prepare(
      `INSERT INTO messages (contact_id, user_id, direction, body, from_number, to_number, status, provider_sid, error, is_read)
       VALUES (?, ?, 'out', ?, ?, ?, ?, ?, ?, 1)`
    )
    .run(contact.id, user ? user.id : null, body, from, contact.phone, result.status, result.sid, result.error);
  db.prepare('UPDATE contacts SET last_activity_at = ? WHERE id = ?').run(toDbDateTime(), contact.id);
  if (contact.stage === 'nuevo') changeStage(contact, 'contactado', user);
  return { id: info.lastInsertRowid, ...result };
}

// Registra un SMS entrante. Si el número no existe, crea un lead nuevo asignado
// al usuario dueño del número que recibió el mensaje.
function receiveInboundMessage({ from, to, body, sid }) {
  const phone = normalizePhone(from);
  const toNumber = normalizePhone(to);
  if (sid && db.prepare('SELECT 1 FROM messages WHERE provider_sid = ?').get(sid)) return null; // reintento duplicado

  const receiver = toNumber ? db.prepare('SELECT * FROM users WHERE sms_number = ? AND active = 1').get(toNumber) : null;
  let contact = db.prepare('SELECT * FROM contacts WHERE phone = ? ORDER BY id LIMIT 1').get(phone);
  if (!contact) {
    let ownerId = receiver ? receiver.id : null;
    if (!ownerId) {
      const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1").get();
      ownerId = admin ? admin.id : null;
    }
    const info = db
      .prepare("INSERT INTO contacts (first_name, phone, source, owner_id, stage) VALUES (?, ?, 'SMS entrante', ?, 'nuevo')")
      .run(`Nuevo lead ${phone.slice(-4)}`, phone, ownerId);
    contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(info.lastInsertRowid);
    logActivity(contact.id, null, 'creado', 'Contacto creado automáticamente por SMS entrante');
  }

  const text = String(body || '').trim();
  const keyword = text.toUpperCase();
  if (['STOP', 'BAJA', 'CANCELAR', 'UNSUBSCRIBE'].includes(keyword)) {
    db.prepare('UPDATE contacts SET sms_opt_out = 1 WHERE id = ?').run(contact.id);
    logActivity(contact.id, null, 'sms', 'El contacto se dio de baja de SMS');
  } else if (['START', 'ALTA'].includes(keyword)) {
    db.prepare('UPDATE contacts SET sms_opt_out = 0 WHERE id = ?').run(contact.id);
  } else if (['SI', 'SÍ', 'CONFIRMO'].includes(keyword)) {
    // Confirma la próxima cita programada del contacto.
    const appt = db
      .prepare("SELECT * FROM appointments WHERE contact_id = ? AND status = 'programada' AND starts_at >= ? ORDER BY starts_at LIMIT 1")
      .get(contact.id, toDbDateTime());
    if (appt) {
      db.prepare("UPDATE appointments SET status = 'confirmada' WHERE id = ?").run(appt.id);
      logActivity(contact.id, null, 'cita', `Cita del ${fmtDateTime(appt.starts_at)} confirmada por SMS`);
    }
  }

  db.prepare(
    `INSERT INTO messages (contact_id, user_id, direction, body, from_number, to_number, status, provider_sid, is_read)
     VALUES (?, NULL, 'in', ?, ?, ?, 'received', ?, 0)`
  ).run(contact.id, text, phone, toNumber, sid || null);
  db.prepare('UPDATE contacts SET last_activity_at = ? WHERE id = ?').run(toDbDateTime(), contact.id);
  return contact;
}

function changeStage(contact, stage, user, extra = {}) {
  if (contact.stage === stage) return;
  const now = toDbDateTime();
  const sets = ['stage = ?', 'updated_at = ?'];
  const params = [stage, now];
  if (stage === 'ganado') {
    sets.push('won_at = ?', 'lost_at = NULL');
    params.push(now);
  } else if (stage === 'perdido') {
    sets.push('lost_at = ?', 'won_at = NULL', 'lost_reason = ?');
    params.push(now, extra.lostReason || null);
  } else {
    sets.push('won_at = NULL', 'lost_at = NULL');
  }
  if (extra.dealValue != null) {
    sets.push('deal_value = ?');
    params.push(extra.dealValue);
  }
  db.prepare(`UPDATE contacts SET ${sets.join(', ')} WHERE id = ?`).run(...params, contact.id);
  logActivity(contact.id, user && user.id, 'etapa', `Etapa: ${stageInfo(contact.stage).label} → ${stageInfo(stage).label}`);
  contact.stage = stage;
}

// Envía recordatorios SMS de citas próximas (se ejecuta periódicamente).
async function sendAppointmentReminders() {
  const hours = Number(process.env.REMINDER_HOURS || 24);
  const now = new Date();
  const until = new Date(now.getTime() + hours * 3600 * 1000);
  const rows = db
    .prepare(
      `SELECT a.*, c.first_name, c.last_name, c.phone, c.sms_opt_out, c.stage
       FROM appointments a JOIN contacts c ON c.id = a.contact_id
       WHERE a.reminder_sent_at IS NULL AND a.status IN ('programada','confirmada')
         AND a.starts_at > ? AND a.starts_at <= ? AND c.phone IS NOT NULL AND c.sms_opt_out = 0`
    )
    .all(toDbDateTime(now), toDbDateTime(until));
  let sent = 0;
  for (const a of rows) {
    const user = a.user_id ? db.prepare('SELECT * FROM users WHERE id = ?').get(a.user_id) : null;
    const contact = { id: a.contact_id, first_name: a.first_name, last_name: a.last_name, phone: a.phone, sms_opt_out: a.sms_opt_out, stage: a.stage };
    const body = renderTemplate('Hola {nombre}, te recuerdo nuestra cita el {fecha}. Responde SI para confirmar. - {agente}', templateVars(contact, user, { fecha: fmtDateTime(a.starts_at) }));
    db.prepare('UPDATE appointments SET reminder_sent_at = ? WHERE id = ?').run(toDbDateTime(), a.id);
    try {
      await sendMessageToContact(user, contact, body);
      sent++;
    } catch (e) {
      console.error(`Recordatorio de cita ${a.id} falló:`, e.message);
    }
  }
  return sent;
}

module.exports = { logActivity, senderNumber, templateVars, sendMessageToContact, receiveInboundMessage, changeStage, sendAppointmentReminders, fullName };
