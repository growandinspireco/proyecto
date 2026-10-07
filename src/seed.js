// Carga datos de ejemplo para probar el CRM:  npm run seed
require('dotenv').config({ quiet: true });
const bcrypt = require('bcryptjs');
const db = require('./db');
const { toDbDateTime, addDays } = require('./utils');

if (process.env.NODE_ENV === 'production' && !process.argv.includes('--force')) {
  console.error('Seed bloqueado en producción (borraría tus datos). Usa --force si de verdad quieres hacerlo.');
  process.exit(1);
}

const PASSWORD = 'Demo1234!';
const at = (days, hour = 10, min = 0) => {
  const d = addDays(new Date(), days);
  d.setHours(hour, min, 0, 0);
  return toDbDateTime(d);
};

db.transaction(() => {
  for (const t of ['tasks', 'activities', 'messages', 'appointments', 'contacts', 'property_access', 'properties', 'sessions', 'users']) db.prepare(`DELETE FROM ${t}`).run();
  db.prepare("DELETE FROM sqlite_sequence").run();

  const hash = bcrypt.hashSync(PASSWORD, 10);
  const addUser = db.prepare('INSERT INTO users (name, email, password_hash, role, phone, sms_number) VALUES (?, ?, ?, ?, ?, ?)');
  const admin = addUser.run('Admin Demo', 'admin@demo.com', hash, 'admin', '+525511111111', '+15005550006').lastInsertRowid;
  const ana = addUser.run('Ana López', 'ana@demo.com', hash, 'agent', '+525522222222', '+15005550007').lastInsertRowid;
  const luis = addUser.run('Luis Martínez', 'luis@demo.com', hash, 'agent', '+525533333333', '+15005550008').lastInsertRowid;

  const addProp = db.prepare('INSERT INTO properties (title, kind, address, city, price, bedrooms, bathrooms, area_m2, status, description, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  const props = [
    addProp.run('Casa Jardines del Valle', 'Casa', 'Av. de los Pinos 120', 'Guadalajara', 3450000, 3, 2.5, 180, 'disponible', 'Casa con jardín, cochera para 2 autos y cocina integral.', admin).lastInsertRowid,
    addProp.run('Depto. Torre Central 804', 'Departamento', 'Blvd. Central 500, piso 8', 'Monterrey', 2890000, 2, 2, 95, 'disponible', 'Vista panorámica, amenidades: alberca y gimnasio.', admin).lastInsertRowid,
    addProp.run('Terreno Las Lomas', 'Terreno', 'Camino Real km 4', 'Querétaro', 1200000, null, null, 450, 'disponible', 'Terreno plano con servicios, ideal para casa.', admin).lastInsertRowid,
    addProp.run('Local Plaza Norte', 'Local comercial', 'Plaza Norte, local 12', 'CDMX', 4100000, null, 1, 70, 'apartada', 'Local en esquina con alto flujo peatonal.', admin).lastInsertRowid,
    addProp.run('Casa Residencial Bosques', 'Casa', 'Calle Encino 45', 'Puebla', 5200000, 4, 3.5, 260, 'vendida', 'Residencial con seguridad 24/7.', admin).lastInsertRowid,
  ];
  const access = db.prepare('INSERT INTO property_access (property_id, user_id) VALUES (?, ?)');
  [props[0], props[1], props[4]].forEach((p) => access.run(p, ana));
  [props[1], props[2], props[3]].forEach((p) => access.run(p, luis));

  const addContact = db.prepare(
    `INSERT INTO contacts (first_name, last_name, phone, email, source, tags, stage, deal_value, owner_id, property_id, notes, won_at, lost_at, lost_reason, created_at, updated_at, last_activity_at)
     VALUES (@first_name, @last_name, @phone, @email, @source, @tags, @stage, @deal_value, @owner_id, @property_id, @notes, @won_at, @lost_at, @lost_reason, @created_at, @created_at, @last_activity_at)`
  );
  const people = [
    ['María', 'González', '+525512345001', 'maria@example.com', 'Facebook', 'vip', 'ganado', 3450000, ana, props[0], -40, -8],
    ['Carlos', 'Ramírez', '+525512345002', 'carlos@example.com', 'Google', 'crédito', 'propuesta', 2890000, ana, props[1], -20, -1],
    ['Sofía', 'Hernández', '+525512345003', null, 'Instagram', '', 'cita', 3450000, ana, props[0], -6, 0],
    ['Jorge', 'Torres', '+525512345004', 'jorge@example.com', 'Referido', 'inversionista', 'contactado', 1200000, luis, props[2], -5, -4],
    ['Lucía', 'Flores', '+525512345005', null, 'Sitio web', '', 'nuevo', 0, luis, null, -1, null],
    ['Pedro', 'Sánchez', '+525512345006', 'pedro@example.com', 'Facebook', '', 'perdido', 2890000, luis, props[1], -35, -12],
    ['Valeria', 'Cruz', '+525512345007', 'valeria@example.com', 'Google', 'vip', 'ganado', 5200000, ana, props[4], -55, -25],
    ['Andrés', 'Morales', '+525512345008', null, 'Llamada', '', 'propuesta', 4100000, luis, props[3], -15, -2],
    ['Fernanda', 'Ruiz', '+525512345009', 'fer@example.com', 'Instagram', '', 'nuevo', 0, ana, null, 0, null],
    ['Ricardo', 'Díaz', '+525512345010', null, 'Referido', '', 'ganado', 1200000, luis, props[2], -18, -3],
    ['Daniela', 'Vargas', '+525512345011', 'dani@example.com', 'Facebook', 'crédito', 'contactado', 2890000, admin, props[1], -9, -5],
    ['Miguel', 'Castillo', '+525512345012', null, 'Sitio web', '', 'cita', 3450000, admin, props[0], -3, 0],
  ];
  const ids = people.map(([first_name, last_name, phone, email, source, tags, stage, deal_value, owner_id, property_id, createdDays, closeDays]) =>
    addContact.run({
      first_name, last_name, phone, email, source, tags, stage, deal_value, owner_id, property_id,
      notes: null,
      won_at: stage === 'ganado' ? at(closeDays, 16) : null,
      lost_at: stage === 'perdido' ? at(closeDays, 16) : null,
      lost_reason: stage === 'perdido' ? 'Eligió otra opción más económica' : null,
      created_at: at(createdDays, 9),
      last_activity_at: at(closeDays != null ? closeDays : createdDays, 12),
    }).lastInsertRowid
  );

  const act = db.prepare('INSERT INTO activities (contact_id, user_id, type, body, created_at) VALUES (?,?,?,?,?)');
  ids.forEach((id, i) => act.run(id, people[i][8], 'creado', 'Contacto creado', at(people[i][10], 9)));
  act.run(ids[1], ana, 'llamada', 'Interesado en crédito Infonavit. Pidió cotización detallada.', at(-3, 13));
  act.run(ids[0], ana, 'nota', 'Firmó contrato de compraventa. ¡Venta cerrada!', at(-8, 16));

  const appt = db.prepare('INSERT INTO appointments (contact_id, user_id, property_id, title, starts_at, duration_min, location, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)');
  appt.run(ids[0], ana, props[0], 'Visita a propiedad', at(-12, 11), 60, 'Av. de los Pinos 120', 'completada', at(-15, 10));
  appt.run(ids[1], ana, props[1], 'Visita a propiedad', at(-4, 17), 60, 'Torre Central', 'completada', at(-6, 10));
  appt.run(ids[2], ana, props[0], 'Visita a propiedad', at(0, 16), 60, 'Av. de los Pinos 120', 'confirmada', at(-2, 10));
  appt.run(ids[11], admin, props[0], 'Reunión de ventas', at(1, 10, 30), 60, 'Oficina', 'programada', at(-1, 10));
  appt.run(ids[3], luis, props[2], 'Recorrido terreno', at(2, 12), 90, 'Camino Real km 4', 'programada', at(-1, 11));
  appt.run(ids[5], luis, props[1], 'Visita a propiedad', at(-14, 18), 60, 'Torre Central', 'no_show', at(-16, 10));
  appt.run(ids[7], luis, props[3], 'Presentación de propuesta', at(-2, 13), 60, 'Plaza Norte', 'completada', at(-5, 9));

  const msg = db.prepare('INSERT INTO messages (contact_id, user_id, direction, body, from_number, to_number, status, is_read, created_at) VALUES (?,?,?,?,?,?,?,?,?)');
  msg.run(ids[2], ana, 'out', 'Hola Sofía, soy Ana. Te confirmo tu visita a Casa Jardines del Valle hoy a las 4:00 pm. Responde SI para confirmar.', '+15005550007', people[2][2], 'delivered', 1, at(-1, 18));
  msg.run(ids[2], null, 'in', 'SI, ahí nos vemos. ¿Puedo llevar a mi esposo?', people[2][2], '+15005550007', 'received', 1, at(-1, 18, 20));
  msg.run(ids[2], ana, 'out', '¡Claro que sí! Los espero 😊', '+15005550007', people[2][2], 'delivered', 1, at(-1, 18, 25));
  msg.run(ids[1], ana, 'out', 'Hola Carlos, ya tengo lista la cotización con el crédito. ¿Te la envío por correo?', '+15005550007', people[1][2], 'delivered', 1, at(-1, 10));
  msg.run(ids[1], null, 'in', 'Sí por favor, y ¿aceptan apartado con 50 mil?', people[1][2], '+15005550007', 'received', 0, at(0, 8, 45));
  msg.run(ids[4], null, 'in', 'Hola, vi el anuncio del departamento. ¿Sigue disponible?', people[4][2], '+15005550008', 'received', 0, at(-1, 20));
  msg.run(ids[11], admin, 'out', 'Hola Miguel, te espero mañana a las 10:30 en la oficina.', '+15005550006', people[11][2], 'delivered', 1, at(-1, 12));

  const task = db.prepare('INSERT INTO tasks (contact_id, user_id, title, due_at) VALUES (?,?,?,?)');
  task.run(ids[1], ana, 'Enviar cotización con crédito', at(0, 12));
  task.run(ids[4], luis, 'Llamar a Lucía (lead nuevo)', at(0, 11));
  task.run(ids[7], luis, 'Dar seguimiento a la propuesta del local', at(1, 10));
  task.run(ids[10], admin, 'Revisar documentos de Daniela', at(-1, 17));
})();

console.log('✅ Datos de ejemplo cargados.\n');
console.log('Usuarios (contraseña para todos: ' + PASSWORD + '):');
console.log('  admin@demo.com  → Administrador (ve todo)');
console.log('  ana@demo.com    → Agente');
console.log('  luis@demo.com   → Agente');
