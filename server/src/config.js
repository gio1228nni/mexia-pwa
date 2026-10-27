import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name} (revisa server/.env)`);
  return v;
}

export const config = {
  port: Number(process.env.PORT || 3000),
  env: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || '',
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: required('DB_USER'),
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'mexia',
  },
  jwtSecret: required('JWT_SECRET'),
  sessionHours: Number(process.env.SESSION_HOURS || 12),
  cookieSecure: String(process.env.COOKIE_SECURE) === 'true',
  storageDir: path.resolve(root, process.env.STORAGE_DIR || './storage'),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 8) * 1024 * 1024,
  publicDir: path.resolve(root, '../public'),
};

if (config.env === 'production' && config.jwtSecret.length < 32) {
  throw new Error('JWT_SECRET debe tener al menos 32 caracteres en producción');
}
