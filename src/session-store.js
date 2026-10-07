const session = require('express-session');
const db = require('./db');

const DAY = 24 * 60 * 60 * 1000;

// Almacén de sesiones sobre SQLite para que las sesiones sobrevivan reinicios.
class SqliteStore extends session.Store {
  constructor() {
    super();
    this.getStmt = db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expires_at > ?');
    this.setStmt = db.prepare(
      'INSERT INTO sessions (sid, sess, expires_at) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires_at = excluded.expires_at'
    );
    this.delStmt = db.prepare('DELETE FROM sessions WHERE sid = ?');
    this.touchStmt = db.prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?');
    this.purgeStmt = db.prepare('DELETE FROM sessions WHERE expires_at <= ?');
  }
  expiry(sess) {
    const maxAge = sess && sess.cookie && sess.cookie.maxAge;
    return Date.now() + (typeof maxAge === 'number' ? maxAge : DAY);
  }
  get(sid, cb) {
    try {
      const row = this.getStmt.get(sid, Date.now());
      cb(null, row ? JSON.parse(row.sess) : null);
    } catch (e) {
      cb(e);
    }
  }
  set(sid, sess, cb = () => {}) {
    try {
      this.setStmt.run(sid, JSON.stringify(sess), this.expiry(sess));
      if (Math.random() < 0.01) this.purgeStmt.run(Date.now());
      cb(null);
    } catch (e) {
      cb(e);
    }
  }
  destroy(sid, cb = () => {}) {
    try {
      this.delStmt.run(sid);
      cb(null);
    } catch (e) {
      cb(e);
    }
  }
  touch(sid, sess, cb = () => {}) {
    try {
      this.touchStmt.run(this.expiry(sess), sid);
      cb(null);
    } catch (e) {
      cb(e);
    }
  }
}

module.exports = SqliteStore;
