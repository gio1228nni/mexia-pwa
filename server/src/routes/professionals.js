// Directorio público y disponibilidad (cualquier usuario con sesión).
import { Router } from 'express';
import { q, one } from '../db.js';
import { ah, str, date, id, num, notFound, bad } from '../lib/http.js';
import { requireAuth } from '../middleware/auth.js';
import { buildPublicProfile, VISIBLE_SQL, MODES } from '../lib/profiles.js';
import { freeSlots, nowLocal, addDays } from '../lib/schedule.js';

const r = Router();
r.use(requireAuth);

r.get('/specialties', ah(async (_req, res) => {
  const rows = await q(`SELECT DISTINCT JSON_UNQUOTE(JSON_EXTRACT(pp.published_json,'$.specialty')) AS s
    FROM professional_public_profiles pp JOIN professionals p ON p.id = pp.professional_id JOIN users u ON u.id = p.user_id
    WHERE ${VISIBLE_SQL} ORDER BY s`);
  res.json(rows.map((x) => x.s).filter(Boolean));
}));

r.get('/', ah(async (req, res) => {
  const text = str(req.query.q, { field: 'búsqueda', max: 80 });
  const specialty = str(req.query.specialty, { field: 'especialidad', max: 100 });
  const city = str(req.query.city, { field: 'ciudad', max: 100 });
  const maxPrice = num(req.query.maxPrice, { field: 'precio', min: 0 });
  const conds = [VISIBLE_SQL], params = [];
  if (specialty && specialty !== 'Todas') { conds.push(`JSON_UNQUOTE(JSON_EXTRACT(pp.published_json,'$.specialty')) = ?`); params.push(specialty); }
  if (city) { conds.push('pp.city LIKE ?'); params.push(`%${city}%`); }
  if (text) {
    conds.push(`(JSON_UNQUOTE(JSON_EXTRACT(pp.published_json,'$.displayName')) LIKE ? OR JSON_UNQUOTE(JSON_EXTRACT(pp.published_json,'$.specialty')) LIKE ?)`);
    params.push(`%${text}%`, `%${text}%`);
  }
  if (maxPrice !== null) { conds.push(`CAST(JSON_EXTRACT(pp.published_json,'$.price') AS DECIMAL(10,2)) <= ?`); params.push(maxPrice); }
  const rows = await q(`SELECT p.id, pp.published_json,
      (SELECT ROUND(AVG(rating),1) FROM reviews rv WHERE rv.professional_id = p.id AND rv.moderation_status='PUBLISHED') AS rating,
      (SELECT COUNT(*) FROM reviews rv WHERE rv.professional_id = p.id AND rv.moderation_status='PUBLISHED') AS review_count
    FROM professionals p JOIN professional_public_profiles pp ON pp.professional_id = p.id JOIN users u ON u.id = p.user_id
    WHERE ${conds.join(' AND ')} ORDER BY pp.published_at DESC LIMIT 100`, params);
  res.json(rows.map((row) => {
    const d = typeof row.published_json === 'string' ? JSON.parse(row.published_json) : row.published_json;
    return { id: row.id, displayName: d.displayName, specialty: d.specialty, city: d.city, price: d.price,
      duration: d.duration, mode: d.mode, modeLabel: MODES[d.mode] || '', rating: row.rating, reviewCount: row.review_count,
      portrait: d.portraitMediaId ? true : false, verified: true };
  }));
}));

async function visibleOr404(professionalId) {
  const ok = await one(`SELECT p.id, p.timezone FROM professionals p JOIN professional_public_profiles pp ON pp.professional_id = p.id
    JOIN users u ON u.id = p.user_id WHERE p.id = ? AND ${VISIBLE_SQL}`, [professionalId]);
  if (!ok) throw notFound('Este perfil no está disponible');
  return ok;
}

/** Perfil público: exactamente la versión publicada */
r.get('/:id', ah(async (req, res) => {
  const pid = id(req.params.id);
  await visibleOr404(pid);
  res.json(await buildPublicProfile(pid, 'published'));
}));

/** Huecos libres calculados en servidor (máx. 31 días) */
r.get('/:id/availability', ah(async (req, res) => {
  const pid = id(req.params.id);
  const prof = await visibleOr404(pid);
  const now = nowLocal(prof.timezone);
  const from = date(req.query.from, { field: 'from' }) || now.slice(0, 10);
  const to = date(req.query.to, { field: 'to' }) || addDays(from, 13);
  if (to < from || (Date.parse(to) - Date.parse(from)) / 86400000 > 31) throw bad('Rango inválido (máximo 31 días)');
  const service = await one('SELECT duration_min FROM services WHERE professional_id = ? AND active = 1 ORDER BY id DESC LIMIT 1', [pid]);
  const [rules, timeOff, busy] = await Promise.all([
    q('SELECT weekday, start_time, end_time, slot_minutes FROM availability_rules WHERE professional_id = ?', [pid]),
    q('SELECT start_at, end_at FROM time_off WHERE professional_id = ? AND end_at >= ? AND start_at <= ?', [pid, from, to + ' 23:59:59']),
    q(`SELECT start_at, end_at FROM appointments WHERE professional_id = ? AND status IN ('REQUESTED','CONFIRMED')
       AND start_at BETWEEN ? AND ?`, [pid, from, to + ' 23:59:59']),
  ]);
  const slots = freeSlots({ rules, timeOff, busy, duration: service?.duration_min || 30, from, to, now });
  res.json({ timezone: prof.timezone, duration: service?.duration_min || 30, slots });
}));

export default r;
