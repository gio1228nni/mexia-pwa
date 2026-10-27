// Citas: reserva transaccional, cambios de estado con permisos, mensajes y reseñas.
import { Router } from 'express';
import { q, one, tx } from '../db.js';
import { ah, str, int, oneOf, id, bool, notFound, bad, forbidden, conflict } from '../lib/http.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { isValidSlot, nowLocal, addMinutes, overlaps } from '../lib/schedule.js';
import { VISIBLE_SQL } from '../lib/profiles.js';
import { audit } from '../lib/audit.js';

const r = Router();
r.use(requireAuth);

const DT_RE = /^\d{4}-\d{2}-\d{2}[ T]([01]\d|2[0-3]):[0-5]\d(:00)?$/;
export const STATUS_LABEL = {
  REQUESTED: 'Solicitada', CONFIRMED: 'Confirmada', REJECTED: 'Rechazada', CANCELLED: 'Cancelada',
  COMPLETED: 'Atendida', NO_SHOW: 'No asistió',
};

/** Cita visible solo para sus dos participantes */
async function participantAppointment(req, apptId, conn = null) {
  const sql = `SELECT a.*, p.user_id AS professional_user_id, p.timezone FROM appointments a
    JOIN professionals p ON p.id = a.professional_id WHERE a.id = ?${conn ? ' FOR UPDATE' : ''}`;
  const a = conn ? (await conn.execute(sql, [apptId]))[0][0] : await one(sql, [apptId]);
  if (!a) throw notFound('Cita no encontrada');
  const isPatient = a.patient_user_id === req.user.id;
  const isDoctor = a.professional_user_id === req.user.id;
  if (!isPatient && !isDoctor) throw notFound('Cita no encontrada'); // 404: no revela existencia (IDOR)
  return { a, isPatient, isDoctor };
}

// ---------- Reservar (paciente) ----------
r.post('/', requireRole('PATIENT'), ah(async (req, res) => {
  const b = req.body;
  const professionalId = id(b.professional_id, 'professional_id');
  const rawStart = String(b.start_at || '');
  if (!DT_RE.test(rawStart)) throw bad('Horario inválido');
  const start = rawStart.replace('T', ' ').slice(0, 16) + ':00';
  const mode = oneOf(b.mode, ['PRESENCIAL', 'EN_LINEA'], { field: 'Modalidad', def: 'PRESENCIAL' });
  const reason = str(b.reason, { field: 'Motivo', max: 1000 });
  const idem = str(b.idempotency_key, { field: 'idempotency_key', max: 64 });
  const share = bool(b.share_episode);

  // Idempotencia: si el cliente reintenta la misma solicitud, devolvemos la cita original
  if (idem) {
    const prev = await one('SELECT id FROM appointments WHERE patient_user_id = ? AND idempotency_key = ?', [req.user.id, idem]);
    if (prev) return res.status(200).json(await appointmentView(prev.id, req.user.id));
  }

  let episodeId = null;
  if (b.episode_id) {
    const ep = await one('SELECT id FROM episodes WHERE id = ? AND patient_user_id = ?', [id(b.episode_id), req.user.id]);
    if (!ep) throw notFound('Episodio no encontrado');
    episodeId = ep.id;
  }

  try {
    const apptId = await tx(async (c) => {
      // Bloqueo por profesional: serializa reservas concurrentes del mismo médico
      const [[prof]] = await c.execute(`SELECT p.id, p.timezone, pp.published_json FROM professionals p
          JOIN professional_public_profiles pp ON pp.professional_id = p.id JOIN users u ON u.id = p.user_id
          WHERE p.id = ? AND ${VISIBLE_SQL} FOR UPDATE`, [professionalId]);
      if (!prof) throw notFound('Este profesional no está disponible para reservas');
      const [[service]] = await c.execute('SELECT id, price_mxn, duration_min, mode FROM services WHERE professional_id = ? AND active = 1 ORDER BY id DESC LIMIT 1', [professionalId]);
      if (!service) throw bad('El profesional aún no tiene servicios publicados');
      if (service.mode !== 'AMBAS' && service.mode !== mode) throw bad('Modalidad no disponible para este profesional');
      if (start <= nowLocal(prof.timezone)) throw bad('Ese horario ya pasó');
      const [rules] = await c.execute('SELECT weekday, start_time, end_time, slot_minutes FROM availability_rules WHERE professional_id = ?', [professionalId]);
      if (!isValidSlot({ rules, duration: service.duration_min, start })) throw conflict('Ese horario no está dentro de la agenda del profesional', 'SLOT_INVALID');
      const end = addMinutes(start, service.duration_min);
      const [off] = await c.execute('SELECT 1 FROM time_off WHERE professional_id = ? AND start_at < ? AND end_at > ? LIMIT 1', [professionalId, end, start]);
      if (off.length) throw conflict('El profesional no atiende en esa fecha', 'SLOT_BLOCKED');
      const [busy] = await c.execute(`SELECT start_at, end_at FROM appointments WHERE professional_id = ?
          AND status IN ('REQUESTED','CONFIRMED') AND start_at < ? AND end_at > ?`, [professionalId, end, start]);
      if (busy.some((x) => overlaps(start, end, x.start_at, x.end_at))) throw conflict('Ese horario acaba de ser reservado. Elige otro.', 'SLOT_TAKEN');
      // El paciente tampoco puede tener dos citas que se traslapen
      const [mine] = await c.execute(`SELECT 1 FROM appointments WHERE patient_user_id = ? AND status IN ('REQUESTED','CONFIRMED')
          AND start_at < ? AND end_at > ? LIMIT 1`, [req.user.id, end, start]);
      if (mine.length) throw conflict('Ya tienes otra cita en ese horario', 'PATIENT_BUSY');

      const [ins] = await c.execute(`INSERT INTO appointments (patient_user_id, professional_id, service_id, episode_id, start_at, end_at, mode, price_mxn, reason, idempotency_key)
          VALUES (?,?,?,?,?,?,?,?,?,?)`, [req.user.id, professionalId, service.id, episodeId, start, end, mode, service.price_mxn, reason, idem]);
      await c.execute('INSERT INTO appointment_events (appointment_id, actor_user_id, from_status, to_status) VALUES (?,?,NULL,?)', [ins.insertId, req.user.id, 'REQUESTED']);
      const pub = typeof prof.published_json === 'string' ? JSON.parse(prof.published_json) : prof.published_json;
      await c.execute(`INSERT INTO calendar_events (patient_user_id, episode_id, appointment_id, type, title, event_date, event_time, notes)
          VALUES (?,?,?,?,?,?,?,?)`, [req.user.id, episodeId, ins.insertId, 'Consulta', `Consulta · ${pub.displayName}`.slice(0, 160),
        start.slice(0, 10), start.slice(11, 19), pub.specialty || null]);
      if (share && episodeId) {
        const [g] = await c.execute(`INSERT INTO episode_access_grants (episode_id, professional_id, appointment_id, scope, expires_at)
            VALUES (?,?,?,'SUMMARY', DATE_ADD(?, INTERVAL 7 DAY))`, [episodeId, professionalId, ins.insertId, end]);
        await audit(req, 'GRANT_CREATED', 'episode', episodeId, { grantId: g.insertId, professionalId, scope: 'SUMMARY' }, c);
      }
      await audit(req, 'APPOINTMENT_REQUESTED', 'appointment', ins.insertId, null, c);
      return ins.insertId;
    });
    res.status(201).json(await appointmentView(apptId, req.user.id));
  } catch (e) {
    // Si dos transacciones llegan al mismo tiempo, el índice único uq_appt_slot detiene la segunda
    if (e.code === 'ER_DUP_ENTRY') {
      if (String(e.message).includes('uq_appt_idem')) throw conflict('Solicitud duplicada', 'DUPLICATE');
      throw conflict('Ese horario acaba de ser reservado. Elige otro.', 'SLOT_TAKEN');
    }
    throw e;
  }
}));

async function appointmentView(apptId, viewerId) {
  const a = await one(`SELECT a.id, a.patient_user_id, a.professional_id, a.start_at, a.end_at, a.mode, a.price_mxn, a.reason, a.status,
      a.status_reason, a.version, a.episode_id, a.created_at, p.timezone,
      JSON_UNQUOTE(JSON_EXTRACT(pp.published_json,'$.displayName')) AS professional_name,
      JSON_UNQUOTE(JSON_EXTRACT(pp.published_json,'$.specialty')) AS specialty,
      JSON_UNQUOTE(JSON_EXTRACT(pp.published_json,'$.address')) AS address,
      e.title AS episode_title, u.name AS patient_name,
      (SELECT COUNT(*) FROM reviews rv WHERE rv.appointment_id = a.id) AS reviewed,
      (SELECT COUNT(*) FROM episode_access_grants g WHERE g.appointment_id = a.id AND g.revoked_at IS NULL AND g.expires_at > UTC_TIMESTAMP()) AS shared
    FROM appointments a JOIN professionals p ON p.id = a.professional_id
    LEFT JOIN professional_public_profiles pp ON pp.professional_id = a.professional_id
    LEFT JOIN episodes e ON e.id = a.episode_id
    JOIN users u ON u.id = a.patient_user_id WHERE a.id = ?`, [apptId]);
  if (!a) return null;
  const isPatient = a.patient_user_id === viewerId;
  return { ...a, status_label: STATUS_LABEL[a.status], reviewed: !!a.reviewed, shared: !!a.shared,
    episode_title: isPatient ? a.episode_title : undefined, episode_id: isPatient ? a.episode_id : undefined };
}

r.get('/', requireRole('PATIENT'), ah(async (req, res) => {
  const ids = await q('SELECT id FROM appointments WHERE patient_user_id = ? ORDER BY start_at DESC LIMIT 200', [req.user.id]);
  res.json(await Promise.all(ids.map((x) => appointmentView(x.id, req.user.id))));
}));

r.get('/:id', ah(async (req, res) => {
  const { a } = await participantAppointment(req, id(req.params.id));
  res.json(await appointmentView(a.id, req.user.id));
}));

// ---------- Cambios de estado ----------
const TRANSITIONS = {
  patient: { REQUESTED: ['CANCELLED'], CONFIRMED: ['CANCELLED'] },
  doctor: { REQUESTED: ['CONFIRMED', 'REJECTED'], CONFIRMED: ['CANCELLED', 'COMPLETED', 'NO_SHOW'] },
};

r.patch('/:id/status', ah(async (req, res) => {
  const to = oneOf(req.body.status, Object.keys(STATUS_LABEL), { field: 'Estado', required: true });
  const version = int(req.body.version, { field: 'version', min: 1, required: true });
  const reason = str(req.body.reason, { field: 'Motivo', max: 300 });
  const apptId = id(req.params.id);
  await tx(async (c) => {
    const { a, isPatient } = await participantAppointment(req, apptId, c);
    const allowed = (TRANSITIONS[isPatient ? 'patient' : 'doctor'][a.status] || []);
    if (!allowed.includes(to)) throw forbidden(`No puedes cambiar una cita "${STATUS_LABEL[a.status]}" a "${STATUS_LABEL[to]}"`);
    if (a.version !== version) throw conflict('La cita cambió mientras la veías. Actualiza la pantalla.', 'STALE_VERSION');
    if (['COMPLETED', 'NO_SHOW'].includes(to) && a.start_at > nowLocal(a.timezone)) throw bad('Solo puedes marcarla después de la hora de la cita');
    await c.execute('UPDATE appointments SET status = ?, status_reason = ?, version = version + 1 WHERE id = ?', [to, reason, a.id]);
    await c.execute('INSERT INTO appointment_events (appointment_id, actor_user_id, from_status, to_status) VALUES (?,?,?,?)', [a.id, req.user.id, a.status, to]);
    if (['CANCELLED', 'REJECTED'].includes(to)) {
      // Libera el hueco (slot_lock pasa a NULL), quita la cita del calendario del paciente y revoca el acceso ligado
      await c.execute('DELETE FROM calendar_events WHERE appointment_id = ?', [a.id]);
      await c.execute('UPDATE episode_access_grants SET revoked_at = UTC_TIMESTAMP() WHERE appointment_id = ? AND revoked_at IS NULL', [a.id]);
    }
    await audit(req, 'APPOINTMENT_' + to, 'appointment', a.id, { from: a.status }, c);
  });
  res.json(await appointmentView(apptId, req.user.id));
}));

// ---------- Mensajes ----------
async function chatAllowed(req) {
  const { a, isPatient } = await participantAppointment(req, id(req.params.id));
  if (!['CONFIRMED', 'COMPLETED'].includes(a.status)) throw forbidden('Los mensajes se habilitan cuando la cita está confirmada');
  return { a, isPatient };
}

r.get('/:id/messages', ah(async (req, res) => {
  const { a } = await chatAllowed(req);
  await q('UPDATE messages SET read_at = UTC_TIMESTAMP() WHERE appointment_id = ? AND author_user_id <> ? AND read_at IS NULL', [a.id, req.user.id]);
  const rows = await q(`SELECT m.id, m.body, m.created_at, m.read_at, (m.author_user_id = ?) AS mine, u.role AS author_role
      FROM messages m JOIN users u ON u.id = m.author_user_id WHERE m.appointment_id = ? ORDER BY m.created_at, m.id`, [req.user.id, a.id]);
  res.json(rows.map((m) => ({ ...m, mine: !!m.mine })));
}));

r.post('/:id/messages', ah(async (req, res) => {
  const { a } = await chatAllowed(req);
  const body = str(req.body.body, { field: 'Mensaje', required: true, max: 2000 });
  const result = await q('INSERT INTO messages (appointment_id, author_user_id, body) VALUES (?,?,?)', [a.id, req.user.id, body]);
  res.status(201).json({ id: result.insertId, body, mine: true, created_at: new Date().toISOString() });
}));

// ---------- Reseñas ----------
r.post('/:id/review', requireRole('PATIENT'), ah(async (req, res) => {
  const { a, isPatient } = await participantAppointment(req, id(req.params.id));
  if (!isPatient) throw forbidden();
  if (a.status !== 'COMPLETED') throw forbidden('Solo puedes opinar después de una consulta atendida');
  const rating = int(req.body.rating, { field: 'Calificación', min: 1, max: 5, required: true });
  const body = str(req.body.body, { field: 'Comentario', max: 1000 });
  try {
    await q('INSERT INTO reviews (appointment_id, author_user_id, professional_id, rating, body) VALUES (?,?,?,?,?)',
      [a.id, req.user.id, a.professional_id, rating, body]);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw conflict('Ya enviaste una reseña para esta cita');
    throw e;
  }
  res.status(201).json({ ok: true, moderation_status: 'PENDING' });
}));

export default r;
