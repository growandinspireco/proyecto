const { STAGES, APPOINTMENT_STATUSES, PROPERTY_STATUSES, MESSAGE_STATUS_LABELS } = require('./constants');

const pad = (n) => String(n).padStart(2, '0');

// Fechas en hora local con formato 'YYYY-MM-DD HH:MM:SS' (mismo formato que SQLite localtime).
function toDbDateTime(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function toDbDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
// Convierte el valor de un <input type="datetime-local"> a formato de BD.
function fromInputDateTime(v) {
  if (!v || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return null;
  return v.slice(0, 16).replace('T', ' ') + ':00';
}
function toInputDateTime(v) {
  return v ? v.slice(0, 16).replace(' ', 'T') : '';
}
function parseDbDate(v) {
  if (!v) return null;
  const [date, time = '00:00:00'] = v.split(' ');
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm, ss] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh || 0, mm || 0, ss || 0);
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

function fmtDate(v) {
  const d = parseDbDate(v);
  return d ? `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : '';
}
function fmtTime(v) {
  const d = parseDbDate(v);
  if (!d) return '';
  const h = d.getHours() % 12 || 12;
  return `${h}:${pad(d.getMinutes())} ${d.getHours() < 12 ? 'am' : 'pm'}`;
}
function fmtDateTime(v) {
  return v ? `${fmtDate(v)}, ${fmtTime(v)}` : '';
}
function fmtRelative(v) {
  const d = parseDbDate(v);
  if (!d) return '';
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'ahora';
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  if (diff < 86400 * 7) return `hace ${Math.floor(diff / 86400)} d`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
function fmtMoney(n) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: process.env.CURRENCY || 'MXN', maximumFractionDigits: 0 }).format(n || 0);
}
function fmtPercent(n) {
  return `${Math.round((n || 0) * 100)}%`;
}

// Normaliza teléfonos a formato E.164 (+521234567890). Si el número viene sin
// código de país se usa DEFAULT_COUNTRY_CODE (52 = México por defecto).
function normalizePhone(input) {
  if (!input) return null;
  const raw = String(input).trim();
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  if (raw.startsWith('+')) return `+${digits}`;
  if (raw.startsWith('00')) return `+${digits.slice(2)}`;
  const cc = (process.env.DEFAULT_COUNTRY_CODE || '52').replace(/\D/g, '');
  if (digits.length === 10) return `+${cc}${digits}`;
  return `+${digits}`;
}
function fmtPhone(p) {
  if (!p) return '';
  const mx = /^\+52(1?)(\d{2})(\d{4})(\d{4})$/.exec(p);
  if (mx) return `+52 ${mx[1]}${mx[2]} ${mx[3]} ${mx[4]}`;
  const m = /^\+(\d{1,3})(\d{3})(\d{3})(\d{4})$/.exec(p);
  return m ? `+${m[1]} ${m[2]} ${m[3]} ${m[4]}` : p;
}

function fullName(c) {
  return [c.first_name, c.last_name].filter(Boolean).join(' ');
}
function initials(name) {
  return (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

const stageMap = Object.fromEntries(STAGES.map((s) => [s.key, s]));
const apptStatusMap = Object.fromEntries(APPOINTMENT_STATUSES.map((s) => [s.key, s.label]));
const propStatusMap = Object.fromEntries(PROPERTY_STATUSES.map((s) => [s.key, s.label]));

function renderTemplate(text, vars) {
  return String(text).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
}

function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}
function toNumber(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}
function str(v, max = 2000) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

const viewHelpers = {
  fmtDate,
  fmtTime,
  fmtDateTime,
  fmtRelative,
  fmtMoney,
  fmtPercent,
  fmtPhone,
  fullName,
  initials,
  toInputDateTime,
  stage: (k) => stageMap[k] || { key: k, label: k, color: '#64748b' },
  apptStatus: (k) => apptStatusMap[k] || k,
  propStatus: (k) => propStatusMap[k] || k,
  msgStatus: (k) => MESSAGE_STATUS_LABELS[k] || k || '',
};

module.exports = {
  ...viewHelpers,
  viewHelpers,
  toDbDateTime,
  toDbDate,
  addDays,
  fromInputDateTime,
  parseDbDate,
  normalizePhone,
  renderTemplate,
  toInt,
  toNumber,
  str,
};
