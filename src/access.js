const db = require('./db');

// Reglas de acceso:
//  - admin: ve y gestiona todo.
//  - agente: solo sus contactos (owner_id), sus citas y las propiedades a las que tiene acceso.

const isAdmin = (user) => user && user.role === 'admin';

function contactScope(user, alias = 'c') {
  return isAdmin(user) ? { sql: '', params: [] } : { sql: ` AND ${alias}.owner_id = ?`, params: [user.id] };
}

function getContactFor(user, id) {
  const c = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
  if (!c) return null;
  if (!isAdmin(user) && c.owner_id !== user.id) return null;
  return c;
}

function propertyScope(user, alias = 'p') {
  return isAdmin(user)
    ? { sql: '', params: [] }
    : { sql: ` AND ${alias}.id IN (SELECT property_id FROM property_access WHERE user_id = ?)`, params: [user.id] };
}

function canAccessProperty(user, propertyId) {
  if (!propertyId) return true;
  if (isAdmin(user)) return !!db.prepare('SELECT 1 FROM properties WHERE id = ?').get(propertyId);
  return !!db.prepare('SELECT 1 FROM property_access WHERE property_id = ? AND user_id = ?').get(propertyId, user.id);
}

function propertiesFor(user) {
  const s = propertyScope(user);
  return db.prepare(`SELECT p.id, p.title, p.status FROM properties p WHERE 1=1 ${s.sql} ORDER BY p.title`).all(...s.params);
}

function activeUsers() {
  return db.prepare('SELECT id, name, email, role, sms_number FROM users WHERE active = 1 ORDER BY name').all();
}

module.exports = { isAdmin, contactScope, getContactFor, propertyScope, canAccessProperty, propertiesFor, activeUsers };
