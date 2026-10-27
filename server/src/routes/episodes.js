// Episodios de salud, síntomas, seguimientos y autorizaciones por episodio (solo el titular).
import { Router } from 'express';
import { q, one, tx } from '../db.js';
import { ah, str, int, date, oneOf, id, notFound, bad } from '../lib/http.js';
import { requireRole } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';

const r = Router();
r.use(requireRole('PATIENT'));

const EVOLUTIONS = ['Está mejorando', 'Está igual', 'Está empeorando', 'Va y viene'];

/** Verifica titularidad: un paciente solo puede tocar SUS episodios */
async function ownEpisode(req, epId) {
  const ep = await one('SELECT * FROM episodes WHERE id = ? AND patient_user_id = ?', [id(epId), req.user.id]);
  if (!ep) throw notFound('Episodio no encontrado');
  return ep;
}

function symptomFields(b) {
  return {
    name: str(b.name, { field: 'Síntoma', required: true, max: 160 }),
    onset_date: date(b.onset_date, { field: 'Fecha de inicio' }),
    intensity: int(b.intensity, { field: 'Intensidad', min: 0, max: 10 }),
    evolution: b.evolution ? oneOf(b.evolution, EVOLUTIONS, { field: 'Evolución' }) : null,
    location: str(b.location, { field: 'Ubicación', max: 60 }),
    side: str(b.side, { field: 'Lado', max: 20 }),
    pain_type: str(b.pain_type, { field: 'Tipo de molestia', max: 60 }),
    notes: str(b.notes, { field: 'Notas', max: 1000 }),
  };
}

r.get('/', ah(async (req, res) => {
  const rows = await q(`SELECT e.*,
      (SELECT COUNT(*) FROM episode_symptoms s WHERE s.episode_id = e.id) AS symptom_count,
      (SELECT COUNT(*) FROM episode_followups f WHERE f.episode_id = e.id) AS followup_count,
      (SELECT intensity FROM episode_followups f WHERE f.episode_id = e.id AND intensity IS NOT NULL ORDER BY recorded_at DESC LIMIT 1) AS last_intensity
    FROM episodes e WHERE e.patient_user_id = ? ORDER BY e.status = 'ACTIVE' DESC, e.start_date DESC, e.id DESC`, [req.user.id]);
  res.json(rows);
}));

/** Crea un episodio con su primer síntoma (flujo guiado "Nuevo episodio") */
r.post('/', ah(async (req, res) => {
  const b = req.body;
  const title = str(b.title, { field: 'Título', required: true, max: 160 });
  const startDate = date(b.start_date, { field: 'Fecha de inicio' }) || new Date().toISOString().slice(0, 10);
  const onsetReported = str(b.onset_reported, { field: 'Inicio', max: 60 });
  const approx = b.onset_approximate === false ? 0 : 1;
  const symptom = b.symptom ? symptomFields({ ...b.symptom, onset_date: b.symptom.onset_date || startDate }) : null;

  const epId = await tx(async (c) => {
    const [e] = await c.execute(
      'INSERT INTO episodes (patient_user_id, title, onset_reported, onset_approximate, start_date) VALUES (?,?,?,?,?)',
      [req.user.id, title, onsetReported, approx, startDate]);
    if (symptom) {
      const [s] = await c.execute(`INSERT INTO episode_symptoms (episode_id, name, onset_date, intensity, evolution, location, side, pain_type, notes)
        VALUES (?,?,?,?,?,?,?,?,?)`, [e.insertId, ...Object.values(symptom)]);
      if (symptom.intensity !== null) {
        await c.execute('INSERT INTO episode_followups (episode_id, symptom_id, intensity, evolution, note) VALUES (?,?,?,?,?)',
          [e.insertId, s.insertId, symptom.intensity, symptom.evolution, 'Registro inicial']);
      }
    }
    return e.insertId;
  });
  res.status(201).json(await one('SELECT * FROM episodes WHERE id = ?', [epId]));
}));

/** Detalle completo del episodio (vista del paciente) */
r.get('/:id', ah(async (req, res) => {
  const ep = await ownEpisode(req, req.params.id);
  const [symptoms, followups, activities, appointments, grants, documents] = await Promise.all([
    q('SELECT * FROM episode_symptoms WHERE episode_id = ? ORDER BY recorded_at', [ep.id]),
    q('SELECT * FROM episode_followups WHERE episode_id = ? ORDER BY recorded_at', [ep.id]),
    q('SELECT * FROM calendar_events WHERE episode_id = ? ORDER BY event_date, event_time', [ep.id]),
    q(`SELECT a.id, a.start_at, a.status, a.mode, JSON_UNQUOTE(JSON_EXTRACT(pp.published_json,'$.displayName')) AS professional_name
       FROM appointments a LEFT JOIN professional_public_profiles pp ON pp.professional_id = a.professional_id
       WHERE a.episode_id = ? AND a.patient_user_id = ? ORDER BY a.start_at`, [ep.id, req.user.id]),
    q(`SELECT g.*, JSON_UNQUOTE(JSON_EXTRACT(pp.published_json,'$.displayName')) AS professional_name,
         (g.revoked_at IS NULL AND g.expires_at > UTC_TIMESTAMP()) AS active
       FROM episode_access_grants g LEFT JOIN professional_public_profiles pp ON pp.professional_id = g.professional_id
       WHERE g.episode_id = ? ORDER BY g.granted_at DESC`, [ep.id]),
    q('SELECT id, doc_type, title, doc_date FROM documents WHERE episode_id = ?', [ep.id]),
  ]);
  res.json({ ...ep, symptoms, followups, activities, appointments, grants, documents });
}));

r.patch('/:id', ah(async (req, res) => {
  const ep = await ownEpisode(req, req.params.id);
  const b = req.body;
  const title = b.title !== undefined ? str(b.title, { field: 'Título', required: true, max: 160 }) : ep.title;
  let status = ep.status, endDate = ep.end_date, outcome = ep.outcome, note = ep.closing_note;
  if (b.status === 'CLOSED') {
    status = 'CLOSED';
    endDate = date(b.end_date, { field: 'Fecha de cierre' }) || new Date().toISOString().slice(0, 10);
    if (endDate < ep.start_date) throw bad('La fecha de cierre no puede ser anterior al inicio');
    outcome = str(b.outcome, { field: 'Resultado', max: 60 });
    note = str(b.closing_note, { field: 'Nota de cierre', max: 1000 });
  } else if (b.status === 'ACTIVE') {
    status = 'ACTIVE'; endDate = null;
  }
  await q('UPDATE episodes SET title=?, status=?, end_date=?, outcome=?, closing_note=? WHERE id=?',
    [title, status, endDate, outcome, note, ep.id]);
  res.json(await one('SELECT * FROM episodes WHERE id = ?', [ep.id]));
}));

r.delete('/:id', ah(async (req, res) => {
  const ep = await ownEpisode(req, req.params.id);
  await q('DELETE FROM episodes WHERE id = ?', [ep.id]);
  await audit(req, 'EPISODE_DELETED', 'episode', ep.id);
  res.json({ ok: true });
}));

// ---------- Síntomas ----------
r.post('/:id/symptoms', ah(async (req, res) => {
  const ep = await ownEpisode(req, req.params.id);
  const f = symptomFields(req.body);
  const result = await q(`INSERT INTO episode_symptoms (episode_id, name, onset_date, intensity, evolution, location, side, pain_type, notes)
    VALUES (?,?,?,?,?,?,?,?,?)`, [ep.id, ...Object.values(f)]);
  res.status(201).json(await one('SELECT * FROM episode_symptoms WHERE id = ?', [result.insertId]));
}));

r.patch('/:id/symptoms/:sid', ah(async (req, res) => {
  const ep = await ownEpisode(req, req.params.id);
  const s = await one('SELECT * FROM episode_symptoms WHERE id = ? AND episode_id = ?', [id(req.params.sid), ep.id]);
  if (!s) throw notFound('Síntoma no encontrado');
  const f = symptomFields({ ...s, ...req.body, onset_date: req.body.onset_date ?? s.onset_date });
  const active = req.body.active === undefined ? s.active : (req.body.active ? 1 : 0);
  await q(`UPDATE episode_symptoms SET name=?, onset_date=?, intensity=?, evolution=?, location=?, side=?, pain_type=?, notes=?, active=? WHERE id=?`,
    [...Object.values(f), active, s.id]);
  res.json(await one('SELECT * FROM episode_symptoms WHERE id = ?', [s.id]));
}));

r.delete('/:id/symptoms/:sid', ah(async (req, res) => {
  const ep = await ownEpisode(req, req.params.id);
  const result = await q('DELETE FROM episode_symptoms WHERE id = ? AND episode_id = ?', [id(req.params.sid), ep.id]);
  if (!result.affectedRows) throw notFound();
  res.json({ ok: true });
}));

// ---------- Seguimientos ----------
r.post('/:id/followups', ah(async (req, res) => {
  const ep = await ownEpisode(req, req.params.id);
  const b = req.body;
  let symptomId = null;
  if (b.symptom_id) {
    const s = await one('SELECT id FROM episode_symptoms WHERE id = ? AND episode_id = ?', [id(b.symptom_id), ep.id]);
    if (!s) throw notFound('Síntoma no encontrado');
    symptomId = s.id;
  }
  const intensity = int(b.intensity, { field: 'Intensidad', min: 0, max: 10 });
  const evolution = b.evolution ? oneOf(b.evolution, EVOLUTIONS, { field: 'Evolución' }) : null;
  const note = str(b.note, { field: 'Nota', max: 1000 });
  if (intensity === null && !evolution && !note) throw bad('Registra intensidad, evolución o una nota');
  const result = await q('INSERT INTO episode_followups (episode_id, symptom_id, intensity, evolution, note) VALUES (?,?,?,?,?)',
    [ep.id, symptomId, intensity, evolution, note]);
  res.status(201).json(await one('SELECT * FROM episode_followups WHERE id = ?', [result.insertId]));
}));

r.delete('/:id/followups/:fid', ah(async (req, res) => {
  const ep = await ownEpisode(req, req.params.id);
  const result = await q('DELETE FROM episode_followups WHERE id = ? AND episode_id = ?', [id(req.params.fid), ep.id]);
  if (!result.affectedRows) throw notFound();
  res.json({ ok: true });
}));

// ---------- Autorizaciones (compartir episodio con un profesional) ----------
r.post('/:id/grants', ah(async (req, res) => {
  const ep = await ownEpisode(req, req.params.id);
  const professionalId = id(req.body.professional_id, 'professional_id');
  const scope = oneOf(req.body.scope, ['SUMMARY', 'FULL'], { field: 'Alcance', def: 'SUMMARY' });
  const days = int(req.body.days, { field: 'Vigencia (días)', min: 1, max: 90 }) || 7;
  // Solo se comparte con profesionales con los que existe una relación asistencial (cita no rechazada/cancelada)
  const rel = await one(`SELECT id FROM appointments WHERE patient_user_id = ? AND professional_id = ?
      AND status IN ('REQUESTED','CONFIRMED','COMPLETED') ORDER BY start_at DESC LIMIT 1`, [req.user.id, professionalId]);
  if (!rel) throw bad('Solo puedes compartir con un profesional con el que tengas una cita');
  const appointmentId = req.body.appointment_id ? id(req.body.appointment_id) : rel.id;
  const gid = await tx(async (c) => {
    // Revoca autorizaciones vigentes anteriores del mismo episodio/profesional para no duplicar
    await c.execute(`UPDATE episode_access_grants SET revoked_at = UTC_TIMESTAMP()
      WHERE episode_id = ? AND professional_id = ? AND revoked_at IS NULL`, [ep.id, professionalId]);
    const [g] = await c.execute(`INSERT INTO episode_access_grants (episode_id, professional_id, appointment_id, scope, expires_at)
      VALUES (?,?,?,?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY))`, [ep.id, professionalId, appointmentId, scope, days]);
    await audit(req, 'GRANT_CREATED', 'episode', ep.id, { grantId: g.insertId, professionalId, scope, days }, c);
    return g.insertId;
  });
  res.status(201).json(await one('SELECT * FROM episode_access_grants WHERE id = ?', [gid]));
}));

r.delete('/:id/grants/:gid', ah(async (req, res) => {
  const ep = await ownEpisode(req, req.params.id);
  const result = await q(`UPDATE episode_access_grants SET revoked_at = UTC_TIMESTAMP()
     WHERE id = ? AND episode_id = ? AND revoked_at IS NULL`, [id(req.params.gid), ep.id]);
  if (!result.affectedRows) throw notFound('Autorización no encontrada o ya revocada');
  await audit(req, 'GRANT_REVOKED', 'episode', ep.id, { grantId: Number(req.params.gid) });
  res.json({ ok: true });
}));

export default r;
