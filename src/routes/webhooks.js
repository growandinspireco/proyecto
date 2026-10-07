const express = require('express');
const db = require('../db');
const sms = require('../sms');
const { receiveInboundMessage } = require('../services');

const router = express.Router();

// Solo aceptamos peticiones firmadas por Twilio.
function verifyTwilio(req, res, next) {
  if (!sms.isConfigured()) return res.status(403).send('Twilio no está configurado');
  const url = sms.baseUrl() + req.originalUrl;
  if (!sms.validateSignature(url, req.body || {}, req.get('x-twilio-signature'))) return res.status(403).send('Firma inválida');
  next();
}

// Configura en Twilio (número > Messaging > "A message comes in"): POST {BASE_URL}/webhooks/twilio/sms
router.post('/twilio/sms', verifyTwilio, (req, res) => {
  const { From, To, Body, MessageSid } = req.body;
  if (From) receiveInboundMessage({ from: From, to: To, body: Body, sid: MessageSid });
  res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
});

// Actualizaciones de estado de mensajes enviados (entregado, fallido, etc.)
router.post('/twilio/status', verifyTwilio, (req, res) => {
  const { MessageSid, MessageStatus, ErrorCode } = req.body;
  if (MessageSid && MessageStatus) {
    db.prepare('UPDATE messages SET status = ?, error = COALESCE(?, error) WHERE provider_sid = ?').run(MessageStatus, ErrorCode ? `Código ${ErrorCode}` : null, MessageSid);
  }
  res.sendStatus(204);
});

module.exports = router;
