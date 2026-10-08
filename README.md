# CRM Ventas (estilo GoHighLevel)

CRM multiusuario para dar seguimiento a clientes desde el primer contacto hasta la venta.

## Qué incluye

| Módulo | Qué hace |
|---|---|
| **Inicio** | Resumen del mes, citas de hoy (marcar "Asistió" / "No vino" con un clic), mensajes sin leer, tareas y leads que llevan 3+ días sin seguimiento. |
| **Contactos** | Nombre, teléfono, correo, fuente, etiquetas, valor de venta, propiedad de interés y responsable. Detecta teléfonos duplicados. Ficha con historial (notas, llamadas, SMS, citas, cambios de etapa) y tareas. |
| **Pipeline** | Tablero Kanban: Nuevo lead → Contactado → Cita agendada → Propuesta → Venta cerrada / Perdido. Arrastra tarjetas; al cerrar pide el monto y al perder pide el motivo. |
| **Citas** | Calendario semanal, detección de choques de horario, SMS de confirmación al agendar, **recordatorio automático por SMS** (24 h antes) y el cliente puede responder **SI** para confirmar. |
| **Conversaciones SMS** | Bandeja tipo chat por cliente, plantillas rápidas, mensajes nuevos en tiempo real. Cada usuario tiene **su propio número**; los SMS entrantes de números desconocidos crean un lead automáticamente. Respeta **STOP** (baja). |
| **Propiedades** | El admin agrega propiedades manualmente (precio, estado, recámaras, m²…) y elige **qué usuarios tienen acceso** a cada una. |
| **Analíticas** | Generales y **por usuario**: leads, citas, asistencia, ventas, ingresos, conversión, SMS, embudo y fuentes. Filtros por periodo. |
| **Usuarios y accesos** | Roles **Administrador** (ve todo) y **Agente** (solo sus contactos, citas y propiedades asignadas). Activar/desactivar, reasignar contactos. |
| **Seguridad** | Login con correo + contraseña (bcrypt) y/o **Google**. Solo el admin da de alta usuarios. Sesiones seguras, protección CSRF, límite de intentos de login, cabeceras de seguridad. |

## Publicarlo en internet (link para abrir desde cualquier lugar)

1. Crea una cuenta gratis en [render.com](https://render.com) (puedes entrar con tu GitHub).
2. **New → Blueprint** → conecta GitHub y elige el repositorio `proyecto`.
3. Clic en **Apply**. En unos 3–5 minutos Render te da un link tipo `https://crm-ventas-xxxx.onrender.com`.

Viene en modo demo (`DEMO_MODE=true`) con los usuarios de ejemplo. Plan gratis: el sitio "se duerme" tras 15 min sin uso (la primera carga tarda ~1 min) y los datos se reinician cuando se reinicia el servidor; para uso real agrega un disco persistente (plan de pago) con `DATABASE_PATH=/var/data/crm.db` y pon `DEMO_MODE=false`.

## Probarlo en tu computadora

Requisitos: [Node.js 20+](https://nodejs.org).

```bash
npm install
npm run seed     # carga datos de ejemplo
npm start        # abre http://localhost:3000
```

Usuarios de ejemplo (contraseña `Demo1234!`):

- `admin@demo.com` — Administrador
- `ana@demo.com` — Agente
- `luis@demo.com` — Agente

Entra con Ana y luego con Luis para ver que cada uno solo ve lo suyo.

**Prueba de SMS sin Twilio:** sin credenciales el CRM funciona en *modo simulación*. Abre **Conversaciones**, envía un mensaje y usa el recuadro amarillo "Simular respuesta" para fingir que el cliente contesta (escribe `SI` para confirmar su cita).

## Configuración real

Copia `.env.example` a `.env` y completa:

1. **`SESSION_SECRET`**: una cadena aleatoria larga (obligatoria en producción).
2. **Google (opcional)**: en [Google Cloud Console](https://console.cloud.google.com/apis/credentials) crea un *ID de cliente OAuth* tipo "Aplicación web" con la URI de redirección `{BASE_URL}/auth/google/callback`. Pon `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`. Solo pueden entrar correos que el admin haya dado de alta.
3. **Twilio (SMS reales)**:
   - Crea una cuenta en [twilio.com](https://www.twilio.com), compra uno o varios números con SMS.
   - Pon `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` y (opcional) `TWILIO_DEFAULT_NUMBER`.
   - En cada número, en *Messaging → A message comes in*, configura `POST {BASE_URL}/webhooks/twilio/sms`.
   - Asigna a cada usuario su número en **Usuarios** (o cada quien en **Mi perfil**). Los SMS que lleguen a ese número entran a sus conversaciones.
   - `BASE_URL` debe ser la URL pública con `https://` (los webhooks se validan con la firma de Twilio).

### Primer arranque sin datos de ejemplo

Si no corres `npm run seed`, la primera persona que se registre en `/register` queda como **Administrador**; después el registro se cierra y el admin agrega al resto del equipo desde **Usuarios y accesos**.

## Pruebas

```bash
npm test
```

Cubre login, CSRF, permisos por rol, el flujo completo de venta (contacto → cita con SMS → confirmación SI → venta cerrada), webhooks de Twilio con firma, STOP y recordatorios.

## Tecnología

Node.js + Express, SQLite (`better-sqlite3`, archivo en `data/crm.db`), vistas EJS, Chart.js. Sin servicios externos obligatorios. Para producción, colócalo detrás de HTTPS (Railway, Render, un VPS con Nginx, etc.) con `NODE_ENV=production` y respalda `data/crm.db`.
