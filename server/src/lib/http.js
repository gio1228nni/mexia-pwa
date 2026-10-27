// Utilidades HTTP: errores, validación ligera y envoltorio async.

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const bad = (msg, code = 'VALIDATION') => new HttpError(400, msg, code);
export const forbidden = (msg = 'No tienes permiso para esta acción') => new HttpError(403, msg, 'FORBIDDEN');
export const notFound = (msg = 'No encontrado') => new HttpError(404, msg, 'NOT_FOUND');
export const conflict = (msg, code = 'CONFLICT') => new HttpError(409, msg, code);

/** Envuelve un handler async para que los errores lleguen a Express */
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------- Validación ----------
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export function str(v, { field, max = 255, min = 0, required = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`${field} es obligatorio`);
    return null;
  }
  if (typeof v !== 'string' && typeof v !== 'number') throw bad(`${field} no es válido`);
  const s = String(v).trim();
  if (required && !s) throw bad(`${field} es obligatorio`);
  if (s.length < min) throw bad(`${field} debe tener al menos ${min} caracteres`);
  if (s.length > max) throw bad(`${field} excede ${max} caracteres`);
  return s || null;
}

export function int(v, { field, min = -Infinity, max = Infinity, required = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`${field} es obligatorio`);
    return null;
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${field} debe ser un entero entre ${min} y ${max}`);
  return n;
}

export function num(v, { field, min = -Infinity, max = Infinity, required = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`${field} es obligatorio`);
    return null;
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw bad(`${field} fuera de rango`);
  return n;
}

export function date(v, { field, required = false } = {}) {
  if (!v) { if (required) throw bad(`${field} es obligatorio`); return null; }
  if (!DATE_RE.test(v) || Number.isNaN(Date.parse(v + 'T00:00:00Z'))) throw bad(`${field} debe tener formato AAAA-MM-DD`);
  return v;
}

export function time(v, { field, required = false } = {}) {
  if (!v) { if (required) throw bad(`${field} es obligatorio`); return null; }
  if (!TIME_RE.test(v)) throw bad(`${field} debe tener formato HH:MM`);
  return v.length === 5 ? v + ':00' : v;
}

export function oneOf(v, list, { field, required = false, def = null } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`${field} es obligatorio`);
    return def;
  }
  if (!list.includes(v)) throw bad(`${field} no es válido`);
  return v;
}

export function bool(v) {
  return v === true || v === 1 || v === '1' || v === 'true';
}

export function id(v, field = 'id') {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw bad(`${field} no es válido`);
  return n;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
