import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { one, tx, q } from '../db.js';
import { ah, bad, conflict, str, oneOf, EMAIL_RE, HttpError } from '../lib/http.js';
import { issueSession, clearSession, requireAuth } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';

const r = Router();

// Freno a fuerza bruta: 20 intentos por 15 min por IP
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera unos minutos.', code: 'RATE_LIMIT' } });

function checkPassword(p) {
  if (typeof p !== 'string' || p.length < 8) throw bad('La contraseña debe tener al menos 8 caracteres');
  if (p.length > 128) throw bad('La contraseña es demasiado larga');
  if (!/[A-Za-zÁÉÍÓÚáéíóúñÑ]/.test(p) || !/\d/.test(p)) throw bad('La contraseña debe combinar letras y números');
}

/** Datos de sesión que consume el frontend */
export async function sessionPayload(userId) {
  const user = await one('SELECT id, role, email, name, created_at FROM users WHERE id = ?', [userId]);
  if (!user) return null;
  const out = { user };
  if (user.role === 'PATIENT') {
    out.profile = await one('SELECT * FROM patient_profiles WHERE user_id = ?', [userId]);
  }
  if (user.role === 'DOCTOR') {
    out.professional = await one(
      'SELECT id, verification_status, registration_step, specialty FROM professionals WHERE user_id = ?', [userId]);
  }
  return out;
}

r.post('/register', authLimiter, ah(async (req, res) => {
  const role = oneOf(req.body.role, ['PATIENT', 'DOCTOR'], { field: 'Tipo de cuenta', def: 'PATIENT' });
  // ADMIN jamás se crea por registro público: cualquier otro valor es rechazado arriba.
  const name = str(req.body.name, { field: 'Nombre', required: true, min: 2, max: 120 });
  const email = str(req.body.email, { field: 'Correo', required: true, max: 190 }).toLowerCase();
  if (!EMAIL_RE.test(email)) throw bad('Correo electrónico no válido');
  checkPassword(req.body.password);
  if (req.body.consent !== true) throw bad('Debes aceptar los términos y el aviso de privacidad');

  const exists = await one('SELECT id FROM users WHERE email = ?', [email]);
  if (exists) throw conflict('Ya existe una cuenta con ese correo', 'EMAIL_TAKEN');

  const hash = await bcrypt.hash(req.body.password, 12);
  const userId = await tx(async (c) => {
    const [u] = await c.execute(
      'INSERT INTO users (role, email, password_hash, name, consent_at) VALUES (?,?,?,?, UTC_TIMESTAMP())',
      [role, email, hash, name]);
    if (role === 'PATIENT') {
      await c.execute('INSERT INTO patient_profiles (user_id) VALUES (?)', [u.insertId]);
    } else {
      const [p] = await c.execute('INSERT INTO professionals (user_id) VALUES (?)', [u.insertId]);
      await c.execute('INSERT INTO professional_public_profiles (professional_id, draft_json) VALUES (?, ?)',
        [p.insertId, JSON.stringify({ displayName: name })]);
    }
    return u.insertId;
  });

  const user = await one('SELECT id, role, token_version FROM users WHERE id = ?', [userId]);
  issueSession(res, user);
  req.user = { id: userId };
  await audit(req, 'USER_REGISTERED', 'user', userId, { role });
  res.status(201).json(await sessionPayload(userId));
}));

r.post('/login', authLimiter, ah(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = await one('SELECT id, role, status, password_hash, token_version FROM users WHERE email = ?', [email]);
  // Mismo mensaje para correo inexistente o contraseña errónea (no revela cuentas)
  const ok = user && await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    await audit(req, 'LOGIN_FAILED', 'user', user?.id || null);
    throw new HttpError(401, 'Correo o contraseña incorrectos', 'BAD_CREDENTIALS');
  }
  if (user.status !== 'ACTIVE') throw new HttpError(403, 'La cuenta no está activa', 'INACTIVE');
  await q('UPDATE users SET last_login_at = UTC_TIMESTAMP() WHERE id = ?', [user.id]);
  issueSession(res, user);
  req.user = { id: user.id };
  await audit(req, 'LOGIN', 'user', user.id);
  res.json(await sessionPayload(user.id));
}));

r.post('/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

/** Cierra la sesión en todos los dispositivos */
r.post('/logout-all', requireAuth, ah(async (req, res) => {
  await q('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [req.user.id]);
  clearSession(res);
  await audit(req, 'LOGOUT_ALL', 'user', req.user.id);
  res.json({ ok: true });
}));

r.get('/me', ah(async (req, res) => {
  if (!req.user) return res.json({ user: null });
  res.json(await sessionPayload(req.user.id));
}));

r.post('/change-password', requireAuth, authLimiter, ah(async (req, res) => {
  const u = await one('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  if (!(await bcrypt.compare(String(req.body.current || ''), u.password_hash))) throw bad('La contraseña actual no coincide');
  checkPassword(req.body.next);
  const hash = await bcrypt.hash(req.body.next, 12);
  await q('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?', [hash, req.user.id]);
  const user = await one('SELECT id, role, token_version FROM users WHERE id = ?', [req.user.id]);
  issueSession(res, user);
  await audit(req, 'PASSWORD_CHANGED', 'user', req.user.id);
  res.json({ ok: true });
}));

export default r;
