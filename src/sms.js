const crypto = require('crypto');

// Integración con Twilio vía su API REST (sin SDK). Si no hay credenciales,
// el CRM funciona en "modo simulación": los mensajes se guardan pero no se envían.

function isConfigured() {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
}

function baseUrl() {
  return (process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
}

async function sendSms({ from, to, body }) {
  if (!isConfigured()) return { status: 'simulado', sid: null, error: null };
  if (!from) return { status: 'failed', sid: null, error: 'No hay número de envío configurado (perfil del usuario o TWILIO_DEFAULT_NUMBER).' };

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const params = new URLSearchParams({ From: from, To: to, Body: body });
  if (baseUrl().startsWith('https://')) params.set('StatusCallback', `${baseUrl()}/webhooks/twilio/status`);
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { status: 'failed', sid: null, error: data.message || `Error HTTP ${res.status}` };
    return { status: data.status || 'queued', sid: data.sid || null, error: null };
  } catch (e) {
    return { status: 'failed', sid: null, error: e.message };
  }
}

// Verifica la firma X-Twilio-Signature (https://www.twilio.com/docs/usage/security).
function validateSignature(url, params, signature) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token || !signature) return false;
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  const expected = crypto.createHmac('sha1', token).update(Buffer.from(data, 'utf-8')).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { isConfigured, sendSms, validateSignature, baseUrl };
