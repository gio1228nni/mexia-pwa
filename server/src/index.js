import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import path from 'node:path';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { pool } from './db.js';
import { loadUser, requireAjaxHeader } from './middleware/auth.js';
import { HttpError } from './lib/http.js';

import authRoutes from './routes/auth.js';
import patientRoutes from './routes/patient.js';
import episodeRoutes from './routes/episodes.js';
import calendarRoutes from './routes/calendar.js';
import documentRoutes from './routes/documents.js';
import professionalRoutes from './routes/professionals.js';
import doctorRoutes from './routes/doctor.js';
import appointmentRoutes from './routes/appointments.js';
import adminRoutes from './routes/admin.js';

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'script-src': ["'self'"],
      'style-src': ["'self'", "'unsafe-inline'"],   // el diseño original usa estilos en línea
      'img-src': ["'self'", 'data:', 'blob:'],
      'connect-src': ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
if (config.corsOrigin) app.use(cors({ origin: config.corsOrigin.split(','), credentials: true }));

app.use(express.json({ limit: '200kb' }));

// --- API ---
const api = express.Router();
api.use(rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }));
api.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
api.use(loadUser);
api.use(requireAjaxHeader);
api.get('/health', async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true });
});
api.use('/auth', authRoutes);
api.use('/me', patientRoutes);
api.use('/episodes', episodeRoutes);
api.use('/calendar', calendarRoutes);
api.use('/documents', documentRoutes);
api.use('/professionals', professionalRoutes);
api.use('/doctor', doctorRoutes);
api.use('/appointments', appointmentRoutes);
api.use('/admin', adminRoutes);
api.use((_req, _res, next) => next(new HttpError(404, 'Ruta no encontrada', 'NOT_FOUND')));
app.use('/api', api);

// --- Fotos públicas de perfiles (solo storage/public; nunca documentos privados) ---
app.use('/media', express.static(path.join(config.storageDir, 'public'), { maxAge: '7d', index: false, dotfiles: 'deny' }));

// --- Frontend PWA ---
app.use(express.static(config.publicDir, {
  index: 'index.html',
  setHeaders(res, file) {
    if (file.endsWith('sw.js') || file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  },
}));
app.get(/^\/(?!api|media).*/, (_req, res) => res.sendFile(path.join(config.publicDir, 'index.html')));

// --- Errores ---
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido', code: 'BAD_JSON' });
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `El archivo supera ${config.maxUploadBytes / 1048576} MB`, code: 'FILE_TOO_LARGE' });
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
  // No se registra el cuerpo de la petición: puede contener datos clínicos
  console.error(`[error] ${req.method} ${req.path}:`, err.code || '', err.message);
  res.status(500).json({ error: 'Ocurrió un error inesperado. Intenta de nuevo.', code: 'SERVER_ERROR' });
});

app.listen(config.port, async () => {
  console.log(`MEXIA escuchando en http://localhost:${config.port}`);
  // Diagnóstico de arranque: avisa de inmediato si la BD no está bien configurada
  try {
    await pool.query('SELECT 1 FROM users LIMIT 1');
    console.log(`Base de datos OK (${config.db.user}@${config.db.host}:${config.db.port}/${config.db.database})`);
  } catch (e) {
    const hints = {
      ER_ACCESS_DENIED_ERROR: 'Usuario o contraseña de MySQL incorrectos: revisa DB_USER y DB_PASSWORD en server/.env',
      ER_BAD_DB_ERROR: `La base "${config.db.database}" no existe: ejecuta database/schema.sql`,
      ER_NO_SUCH_TABLE: 'Faltan tablas: ejecuta database/schema.sql',
      ECONNREFUSED: `MySQL no responde en ${config.db.host}:${config.db.port}: verifica que el servicio esté encendido y el puerto (XAMPP a veces usa 3307)`,
      ER_DBACCESS_DENIED_ERROR: `El usuario "${config.db.user}" no tiene permiso sobre "${config.db.database}": ejecuta el GRANT del README`,
    };
    console.error('\n⚠️  NO HAY CONEXIÓN CON LA BASE DE DATOS');
    console.error('   ' + (hints[e.code] || `${e.code || ''} ${e.message}`) + '\n');
  }
});
