import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { one } from '../db.js';
import { HttpError, forbidden } from '../lib/http.js';

export const COOKIE = 'mexia_session';

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function issueSession(res, user) {
  const token = jwt.sign(
    { sub: String(user.id), role: user.role, tv: user.token_version },
    config.jwtSecret,
    { expiresIn: `${config.sessionHours}h` }
  );
  res.cookie(COOKIE, token, {
    httpOnly: true,                 // inaccesible desde JavaScript (mitiga XSS)
    sameSite: 'strict',             // no viaja en peticiones de otros sitios (mitiga CSRF)
    secure: config.cookieSecure,
    maxAge: config.sessionHours * 3600 * 1000,
    path: '/',
  });
}

export function clearSession(res) {
  res.clearCookie(COOKIE, { path: '/', sameSite: 'strict', secure: config.cookieSecure, httpOnly: true });
}

/**
 * Carga req.user si hay sesión válida. El rol SIEMPRE se lee de la BD,
 * nunca del frontend ni solo del token.
 */
export async function loadUser(req, _res, next) {
  try {
    const token = readCookie(req, COOKIE);
    if (!token) return next();
    let payload;
    try { payload = jwt.verify(token, config.jwtSecret); } catch { return next(); }
    const user = await one(
      'SELECT id, role, status, email, name, token_version FROM users WHERE id = ?',
      [Number(payload.sub)]
    );
    if (!user || user.status !== 'ACTIVE' || user.token_version !== payload.tv) return next();
    req.user = user;
    if (user.role === 'DOCTOR') {
      const p = await one('SELECT id, verification_status FROM professionals WHERE user_id = ?', [user.id]);
      req.professional = p || null;
    }
    next();
  } catch (e) { next(e); }
}

/** Defensa CSRF adicional: toda petición que modifica datos debe traer este encabezado */
export function requireAjaxHeader(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Requested-With') !== 'mexia') return next(new HttpError(403, 'Petición no permitida', 'CSRF'));
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Inicia sesión para continuar', 'UNAUTHENTICATED'));
  next();
}

export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'Inicia sesión para continuar', 'UNAUTHENTICATED'));
  if (!roles.includes(req.user.role)) return next(forbidden());
  next();
};

/** Para rutas del portal médico: exige registro profesional creado */
export function requireProfessional(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Inicia sesión para continuar', 'UNAUTHENTICATED'));
  if (req.user.role !== 'DOCTOR' || !req.professional) return next(forbidden('Solo para cuentas profesionales'));
  next();
}
