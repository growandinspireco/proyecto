// Etapas del pipeline de ventas (en orden).
const STAGES = [
  { key: 'nuevo', label: 'Nuevo lead', color: '#6366f1' },
  { key: 'contactado', label: 'Contactado', color: '#0ea5e9' },
  { key: 'cita', label: 'Cita agendada', color: '#f59e0b' },
  { key: 'propuesta', label: 'Propuesta / Negociación', color: '#8b5cf6' },
  { key: 'ganado', label: 'Venta cerrada', color: '#16a34a' },
  { key: 'perdido', label: 'Perdido', color: '#dc2626' },
];
const STAGE_KEYS = STAGES.map((s) => s.key);

const APPOINTMENT_STATUSES = [
  { key: 'programada', label: 'Programada' },
  { key: 'confirmada', label: 'Confirmada' },
  { key: 'completada', label: 'Completada' },
  { key: 'no_show', label: 'No asistió' },
  { key: 'cancelada', label: 'Cancelada' },
];

const PROPERTY_STATUSES = [
  { key: 'disponible', label: 'Disponible' },
  { key: 'apartada', label: 'Apartada' },
  { key: 'vendida', label: 'Vendida' },
];

const LEAD_SOURCES = ['Facebook', 'Instagram', 'Google', 'Sitio web', 'Referido', 'SMS entrante', 'Llamada', 'Otro'];

// Plantillas rápidas de SMS. Variables: {nombre}, {agente}, {fecha}, {propiedad}
const SMS_TEMPLATES = [
  { name: 'Primer contacto', body: 'Hola {nombre}, soy {agente}. Gracias por tu interés. ¿Cuándo te queda bien que platiquemos?' },
  { name: 'Confirmar cita', body: 'Hola {nombre}, te confirmo nuestra cita el {fecha}. Responde SI para confirmar o escríbeme si necesitas cambiarla.' },
  { name: 'Recordatorio', body: 'Hola {nombre}, te recuerdo nuestra cita el {fecha}. ¡Nos vemos pronto! - {agente}' },
  { name: 'Seguimiento', body: 'Hola {nombre}, ¿pudiste revisar la información que te envié? Quedo atento a tus dudas. - {agente}' },
  { name: 'No asistió', body: 'Hola {nombre}, te esperábamos hoy. ¿Te gustaría reagendar? Dime qué día te acomoda.' },
];

// Mapea estados de Twilio a etiquetas en español.
const MESSAGE_STATUS_LABELS = {
  simulado: 'Simulado',
  accepted: 'En cola',
  queued: 'En cola',
  sending: 'Enviando',
  sent: 'Enviado',
  delivered: 'Entregado',
  undelivered: 'No entregado',
  failed: 'Fallido',
  received: 'Recibido',
  read: 'Leído',
};

module.exports = {
  STAGES,
  STAGE_KEYS,
  APPOINTMENT_STATUSES,
  PROPERTY_STATUSES,
  LEAD_SOURCES,
  SMS_TEMPLATES,
  MESSAGE_STATUS_LABELS,
};
