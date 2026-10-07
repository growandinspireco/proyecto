const express = require('express');
const db = require('../db');
const { PROPERTY_STATUSES } = require('../constants');
const { requireAdmin } = require('../middleware');
const { isAdmin, propertyScope, activeUsers } = require('../access');
const { str, toInt, toNumber, toDbDateTime } = require('../utils');

const router = express.Router();
const STATUS_KEYS = PROPERTY_STATUSES.map((s) => s.key);

function readForm(b) {
  return {
    title: str(b.title, 200),
    kind: str(b.kind, 60),
    address: str(b.address, 300),
    city: str(b.city, 100),
    price: toNumber(b.price) || 0,
    bedrooms: toInt(b.bedrooms),
    bathrooms: toNumber(b.bathrooms),
    area_m2: toNumber(b.area_m2),
    status: STATUS_KEYS.includes(b.status) ? b.status : 'disponible',
    description: str(b.description, 5000),
  };
}

function accessIds(b) {
  const raw = b.access == null ? [] : Array.isArray(b.access) ? b.access : [b.access];
  const valid = new Set(activeUsers().map((u) => u.id));
  return [...new Set(raw.map(toInt).filter((id) => valid.has(id)))];
}

const saveAccess = db.transaction((propertyId, ids) => {
  db.prepare('DELETE FROM property_access WHERE property_id = ?').run(propertyId);
  const ins = db.prepare('INSERT INTO property_access (property_id, user_id) VALUES (?, ?)');
  for (const id of ids) ins.run(propertyId, id);
});

router.get('/', (req, res) => {
  const s = propertyScope(req.user);
  const params = [...s.params];
  let filter = '';
  if (STATUS_KEYS.includes(req.query.status)) {
    filter += ' AND p.status = ?';
    params.push(req.query.status);
  }
  const q = str(req.query.q, 100);
  if (q) {
    filter += ' AND (p.title LIKE ? OR p.address LIKE ? OR p.city LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const properties = db
    .prepare(
      `SELECT p.*,
         (SELECT GROUP_CONCAT(u.name, ', ') FROM property_access pa JOIN users u ON u.id = pa.user_id WHERE pa.property_id = p.id) AS access_names,
         (SELECT COUNT(*) FROM contacts c WHERE c.property_id = p.id) AS interested
       FROM properties p WHERE 1=1 ${s.sql} ${filter} ORDER BY p.status = 'vendida', p.created_at DESC`
    )
    .all(...params);
  res.render('properties/index', { title: 'Propiedades', properties, statuses: PROPERTY_STATUSES, query: req.query });
});

router.get('/new', requireAdmin, (req, res) => {
  res.render('properties/form', { title: 'Nueva propiedad', property: { status: 'disponible' }, access: activeUsers().map((u) => u.id), users: activeUsers(), statuses: PROPERTY_STATUSES, error: null });
});

router.post('/', requireAdmin, (req, res) => {
  const v = readForm(req.body);
  const access = accessIds(req.body);
  if (!v.title) return res.status(400).render('properties/form', { title: 'Nueva propiedad', property: v, access, users: activeUsers(), statuses: PROPERTY_STATUSES, error: 'El nombre es obligatorio.' });
  const info = db
    .prepare('INSERT INTO properties (title, kind, address, city, price, bedrooms, bathrooms, area_m2, status, description, created_by) VALUES (@title, @kind, @address, @city, @price, @bedrooms, @bathrooms, @area_m2, @status, @description, @created_by)')
    .run({ ...v, created_by: req.user.id });
  saveAccess(info.lastInsertRowid, access);
  req.flash('success', 'Propiedad agregada.');
  res.redirect('/properties');
});

router.get('/:id', (req, res) => {
  const s = propertyScope(req.user);
  const property = db.prepare(`SELECT p.* FROM properties p WHERE p.id = ? ${s.sql}`).get(toInt(req.params.id), ...s.params);
  if (!property) return res.status(404).render('error', { title: 'No encontrado', message: 'La propiedad no existe o no tienes acceso.' });
  const access = db.prepare('SELECT u.id, u.name, u.role FROM property_access pa JOIN users u ON u.id = pa.user_id WHERE pa.property_id = ? ORDER BY u.name').all(property.id);
  const cs = isAdmin(req.user) ? { sql: '', params: [] } : { sql: ' AND c.owner_id = ?', params: [req.user.id] };
  const interested = db.prepare(`SELECT c.*, u.name AS owner_name FROM contacts c LEFT JOIN users u ON u.id = c.owner_id WHERE c.property_id = ? ${cs.sql} ORDER BY c.updated_at DESC`).all(property.id, ...cs.params);
  res.render('properties/show', { title: property.title, property, access, interested });
});

router.get('/:id/edit', requireAdmin, (req, res) => {
  const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(toInt(req.params.id));
  if (!property) return res.redirect('/properties');
  const access = db.prepare('SELECT user_id FROM property_access WHERE property_id = ?').all(property.id).map((r) => r.user_id);
  res.render('properties/form', { title: 'Editar propiedad', property, access, users: activeUsers(), statuses: PROPERTY_STATUSES, error: null });
});

router.post('/:id', requireAdmin, (req, res) => {
  const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(toInt(req.params.id));
  if (!property) return res.redirect('/properties');
  const v = readForm(req.body);
  const access = accessIds(req.body);
  if (!v.title) return res.status(400).render('properties/form', { title: 'Editar propiedad', property: { ...property, ...v }, access, users: activeUsers(), statuses: PROPERTY_STATUSES, error: 'El nombre es obligatorio.' });
  db.prepare(
    'UPDATE properties SET title=@title, kind=@kind, address=@address, city=@city, price=@price, bedrooms=@bedrooms, bathrooms=@bathrooms, area_m2=@area_m2, status=@status, description=@description, updated_at=@now WHERE id=@id'
  ).run({ ...v, now: toDbDateTime(), id: property.id });
  saveAccess(property.id, access);
  req.flash('success', 'Propiedad actualizada.');
  res.redirect(`/properties/${property.id}`);
});

router.post('/:id/delete', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM properties WHERE id = ?').run(toInt(req.params.id));
  req.flash('success', 'Propiedad eliminada.');
  res.redirect('/properties');
});

module.exports = router;
