// Calendario del paciente: actividades, recordatorios de medicamento y su estado por día.
import { Router } from 'express';
import { q, one } from '../db.js';
import { ah, str, date, time, oneOf, id, notFound, bad } from '../lib/http.js';
import { requireRole } from '../middleware/auth.js';

const r = Router();
r.use(requireRole('PATIENT'));

export const CAL_TYPES = ['Medicamento', 'Consulta', 'Estudio', 'Terapia', 'Vacunación', 'Ejercicio', 'Alimentación', 'Sueño', 'Hidratación', 'Seguimiento', 'Otro'];

const addDays = (iso, n) => {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Expande eventos recurrentes a ocurrencias concretas dentro de [from, to] */
export function expand(events, statuses, from, to) {
  const st = new Map(statuses.map((s) => [`${s.event_id}|${s.occurrence_date}`, s.status]));
  const out = [];
  for (const ev of events) {
    const step = ev.repeat_mode === 'daily' ? 1 : ev.repeat_mode === 'weekly' ? 7 : 0;
    const last = step ? (ev.repeat_until && ev.repeat_until < to ? ev.repeat_until : to) : ev.event_date;
    let d = ev.event_date;
    if (step && d < from) {
      const diff = Math.floor((Date.parse(from) - Date.parse(d)) / 86400000);
      d = addDays(d, Math.floor(diff / step) * step);
      if (d < from) d = addDays(d, step);
    }
    let guard = 0;
    while (d <= last && guard++ < 800) {
      if (d >= from && d <= to) {
        out.push({ ...ev, id: ev.id, date: d, time: ev.event_time ? ev.event_time.slice(0, 5) : null,
          status: st.get(`${ev.id}|${d}`) || 'Pendiente', recurring: !!step });
      }
      if (!step) break;
      d = addDays(d, step);
    }
  }
  return out.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
}

r.get('/', ah(async (req, res) => {
  const from = date(req.query.from, { field: 'from', required: true });
  const to = date(req.query.to, { field: 'to', required: true });
  if (to < from) throw bad('Rango inválido');
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > 400) throw bad('El rango máximo es de 400 días');
  const events = await q(`SELECT * FROM calendar_events WHERE patient_user_id = ?
      AND event_date <= ? AND (event_date >= ? OR (repeat_mode <> 'none' AND (repeat_until IS NULL OR repeat_until >= ?)))`,
    [req.user.id, to, from, from]);
  const ids = events.map((e) => e.id);
  const statuses = ids.length
    ? await q(`SELECT event_id, occurrence_date, status FROM calendar_event_status WHERE event_id IN (${ids.map(() => '?').join(',')}) AND occurrence_date BETWEEN ? AND ?`, [...ids, from, to])
    : [];
  res.json(expand(events, statuses, from, to));
}));

function fields(b) {
  const f = {
    type: oneOf(b.type, CAL_TYPES, { field: 'Tipo', required: true }),
    title: str(b.title, { field: 'Título', required: true, max: 160 }),
    event_date: date(b.event_date, { field: 'Fecha', required: true }),
    event_time: time(b.event_time, { field: 'Hora' }),
    notes: str(b.notes, { field: 'Notas', max: 1000 }),
    repeat_mode: oneOf(b.repeat_mode, ['none', 'daily', 'weekly'], { field: 'Repetición', def: 'none' }),
    repeat_until: date(b.repeat_until, { field: 'Repetir hasta' }),
  };
  if (f.repeat_until && f.repeat_until < f.event_date) throw bad('"Repetir hasta" debe ser posterior a la fecha');
  if (f.repeat_mode === 'none') f.repeat_until = null;
  return f;
}

async function episodeIdFor(req, raw) {
  if (!raw) return null;
  const ep = await one('SELECT id FROM episodes WHERE id = ? AND patient_user_id = ?', [id(raw), req.user.id]);
  if (!ep) throw notFound('Episodio no encontrado');
  return ep.id;
}

r.post('/', ah(async (req, res) => {
  const f = fields(req.body);
  const episodeId = await episodeIdFor(req, req.body.episode_id);
  const result = await q(`INSERT INTO calendar_events (patient_user_id, episode_id, type, title, event_date, event_time, notes, repeat_mode, repeat_until)
    VALUES (?,?,?,?,?,?,?,?,?)`, [req.user.id, episodeId, f.type, f.title, f.event_date, f.event_time, f.notes, f.repeat_mode, f.repeat_until]);
  res.status(201).json(await one('SELECT * FROM calendar_events WHERE id = ?', [result.insertId]));
}));

async function ownEvent(req) {
  const ev = await one('SELECT * FROM calendar_events WHERE id = ? AND patient_user_id = ?', [id(req.params.id), req.user.id]);
  if (!ev) throw notFound('Actividad no encontrada');
  return ev;
}

r.get('/:id', ah(async (req, res) => {
  res.json(await ownEvent(req));
}));

r.patch('/:id', ah(async (req, res) => {
  const ev = await ownEvent(req);
  if (ev.appointment_id) throw bad('Las consultas se gestionan desde "Mis citas"');
  const f = fields({ ...ev, event_time: ev.event_time?.slice(0, 5), ...req.body });
  const episodeId = req.body.episode_id !== undefined ? await episodeIdFor(req, req.body.episode_id) : ev.episode_id;
  await q(`UPDATE calendar_events SET episode_id=?, type=?, title=?, event_date=?, event_time=?, notes=?, repeat_mode=?, repeat_until=? WHERE id=?`,
    [episodeId, f.type, f.title, f.event_date, f.event_time, f.notes, f.repeat_mode, f.repeat_until, ev.id]);
  res.json(await one('SELECT * FROM calendar_events WHERE id = ?', [ev.id]));
}));

r.delete('/:id', ah(async (req, res) => {
  const ev = await ownEvent(req);
  if (ev.appointment_id) throw bad('Cancela la cita desde "Mis citas"');
  await q('DELETE FROM calendar_events WHERE id = ?', [ev.id]);
  res.json({ ok: true });
}));

/** Marca una ocurrencia como Pendiente / Completada / Omitida */
r.put('/:id/status', ah(async (req, res) => {
  const ev = await ownEvent(req);
  const d = date(req.body.date, { field: 'Fecha', required: true });
  const status = oneOf(req.body.status, ['Pendiente', 'Completada', 'Omitida'], { field: 'Estado', required: true });
  const occurs = expand([ev], [], d, d).length > 0;
  if (!occurs) throw bad('La actividad no ocurre en esa fecha');
  await q(`INSERT INTO calendar_event_status (event_id, occurrence_date, status) VALUES (?,?,?)
    ON DUPLICATE KEY UPDATE status = VALUES(status)`, [ev.id, d, status]);
  res.json({ event_id: ev.id, date: d, status });
}));

export default r;
