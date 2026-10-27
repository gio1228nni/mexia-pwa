// Perfil de salud, panel de inicio, pulso diario y médicos de confianza (solo PATIENT).
import { Router } from 'express';
import { q, one } from '../db.js';
import { ah, str, date, time, oneOf, bool, id, notFound, bad, conflict } from '../lib/http.js';
import { requireRole } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';

const r = Router();
r.use(requireRole('PATIENT'));

const today = () => new Date().toISOString().slice(0, 10);

r.get('/profile', ah(async (req, res) => {
  res.json(await one('SELECT * FROM patient_profiles WHERE user_id = ?', [req.user.id]));
}));

r.patch('/profile', ah(async (req, res) => {
  const b = req.body;
  const fields = {
    preferred_name: () => str(b.preferred_name, { field: 'Nombre preferido', max: 80 }),
    birth_date: () => date(b.birth_date, { field: 'Fecha de nacimiento' }),
    biological_sex: () => str(b.biological_sex, { field: 'Sexo biológico', max: 40 }),
    allergies: () => str(b.allergies, { field: 'Alergias', max: 500 }),
    current_medications: () => str(b.current_medications, { field: 'Medicamentos', max: 500 }),
    conditions: () => str(b.conditions, { field: 'Antecedentes', max: 4000 }),
    blood_type: () => oneOf(b.blood_type || null, ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'], { field: 'Grupo sanguíneo' }),
    surgeries: () => str(b.surgeries, { field: 'Cirugías', max: 500 }),
    vaccines: () => str(b.vaccines, { field: 'Vacunas', max: 500 }),
    emergency_contact: () => str(b.emergency_contact, { field: 'Contacto de emergencia', max: 200 }),
    onboarding_done: () => (bool(b.onboarding_done) ? 1 : 0),
    easy_reading: () => (bool(b.easy_reading) ? 1 : 0),
    daily_pulse_enabled: () => (bool(b.daily_pulse_enabled) ? 1 : 0),
    daily_pulse_time: () => time(b.daily_pulse_time, { field: 'Hora del pulso' }),
  };
  const sets = [], vals = [];
  for (const [k, fn] of Object.entries(fields)) {
    if (Object.prototype.hasOwnProperty.call(b, k)) { sets.push(`${k} = ?`); vals.push(fn()); }
  }
  if (sets.length) await q(`UPDATE patient_profiles SET ${sets.join(', ')} WHERE user_id = ?`, [...vals, req.user.id]);
  if (typeof b.name === 'string' && b.name.trim()) {
    await q('UPDATE users SET name = ? WHERE id = ?', [str(b.name, { field: 'Nombre', max: 120, min: 2 }), req.user.id]);
  }
  res.json(await one('SELECT * FROM patient_profiles WHERE user_id = ?', [req.user.id]));
}));

/** Contadores de la pantalla de inicio */
r.get('/dashboard', ah(async (req, res) => {
  const uid = req.user.id;
  const t = String(req.query.today || today()).slice(0, 10);
  const [ep] = await q("SELECT COUNT(*) n FROM episodes WHERE patient_user_id = ? AND status = 'ACTIVE'", [uid]);
  const [docs] = await q('SELECT COUNT(*) n FROM documents WHERE patient_user_id = ?', [uid]);
  const [ev] = await q(`SELECT COUNT(*) n FROM calendar_events WHERE patient_user_id = ?
      AND (event_date >= ? OR (repeat_mode <> 'none' AND (repeat_until IS NULL OR repeat_until >= ?)))`, [uid, t, t]);
  const [ap] = await q(`SELECT COUNT(*) n FROM appointments WHERE patient_user_id = ?
      AND status IN ('REQUESTED','CONFIRMED') AND start_at >= ?`, [uid, t]);
  const pulse = await one('SELECT value FROM daily_pulse WHERE patient_user_id = ? AND pulse_date = ?', [uid, t]);
  res.json({ activeEpisodes: ep.n, documents: docs.n, upcomingActivities: ev.n, upcomingAppointments: ap.n,
    pulseToday: pulse?.value || null });
}));

// ---------- Pulso diario ----------
r.get('/pulse', ah(async (req, res) => {
  res.json(await q('SELECT pulse_date AS date, value FROM daily_pulse WHERE patient_user_id = ? ORDER BY pulse_date DESC LIMIT 90', [req.user.id]));
}));

r.put('/pulse', ah(async (req, res) => {
  const d = date(req.body.date, { field: 'Fecha' }) || today();
  const value = oneOf(req.body.value, ['bien', 'regular', 'mal'], { field: 'Respuesta', required: true });
  await q(`INSERT INTO daily_pulse (patient_user_id, pulse_date, value) VALUES (?,?,?)
           ON DUPLICATE KEY UPDATE value = VALUES(value)`, [req.user.id, d, value]);
  res.json({ date: d, value });
}));

// ---------- Médicos de confianza ----------
r.get('/trusted-doctors', ah(async (req, res) => {
  const rows = await q(`SELECT t.id, t.professional_id, t.created_at,
      COALESCE(t.name, JSON_UNQUOTE(JSON_EXTRACT(pp.published_json,'$.displayName'))) AS name,
      COALESCE(t.specialty, JSON_UNQUOTE(JSON_EXTRACT(pp.published_json,'$.specialty'))) AS specialty,
      t.contact, p.verification_status
    FROM trusted_doctors t
    LEFT JOIN professionals p ON p.id = t.professional_id
    LEFT JOIN professional_public_profiles pp ON pp.professional_id = t.professional_id
    WHERE t.patient_user_id = ? ORDER BY t.created_at DESC`, [req.user.id]);
  res.json(rows);
}));

r.post('/trusted-doctors', ah(async (req, res) => {
  const professionalId = req.body.professional_id ? id(req.body.professional_id, 'professional_id') : null;
  if (professionalId) {
    const p = await one(`SELECT 1 FROM professional_public_profiles WHERE professional_id = ? AND status = 'PUBLISHED'`, [professionalId]);
    if (!p) throw notFound('Perfil no disponible');
    const dup = await one('SELECT id FROM trusted_doctors WHERE patient_user_id = ? AND professional_id = ?', [req.user.id, professionalId]);
    if (dup) throw conflict('Ya está en tus médicos');
    const r2 = await q('INSERT INTO trusted_doctors (patient_user_id, professional_id) VALUES (?,?)', [req.user.id, professionalId]);
    return res.status(201).json({ id: r2.insertId });
  }
  const name = str(req.body.name, { field: 'Nombre del profesional', required: true, max: 100 });
  const specialty = str(req.body.specialty, { field: 'Especialidad', max: 90 });
  const contact = str(req.body.contact, { field: 'Contacto', max: 120 });
  const r2 = await q('INSERT INTO trusted_doctors (patient_user_id, name, specialty, contact) VALUES (?,?,?,?)',
    [req.user.id, name, specialty, contact]);
  res.status(201).json({ id: r2.insertId });
}));

r.delete('/trusted-doctors/:id', ah(async (req, res) => {
  const result = await q('DELETE FROM trusted_doctors WHERE id = ? AND patient_user_id = ?', [id(req.params.id), req.user.id]);
  if (!result.affectedRows) throw notFound();
  res.json({ ok: true });
}));

/** Accesos otorgados por el paciente (todas sus autorizaciones por episodio) */
r.get('/grants', ah(async (req, res) => {
  const rows = await q(`SELECT g.id, g.episode_id, e.title AS episode_title, g.scope, g.granted_at, g.expires_at, g.revoked_at,
      JSON_UNQUOTE(JSON_EXTRACT(pp.published_json,'$.displayName')) AS professional_name,
      (g.revoked_at IS NULL AND g.expires_at > UTC_TIMESTAMP()) AS active
    FROM episode_access_grants g
    JOIN episodes e ON e.id = g.episode_id AND e.patient_user_id = ?
    LEFT JOIN professional_public_profiles pp ON pp.professional_id = g.professional_id
    ORDER BY g.granted_at DESC`, [req.user.id]);
  res.json(rows);
}));

/** Bitácora: quién consultó mis episodios */
r.get('/access-log', ah(async (req, res) => {
  const rows = await q(`SELECT a.action, a.entity_id AS episode_id, a.created_at,
      JSON_UNQUOTE(JSON_EXTRACT(pp.published_json,'$.displayName')) AS professional_name
    FROM audit_events a
    JOIN episodes e ON e.id = a.entity_id AND a.entity_type = 'episode' AND e.patient_user_id = ?
    LEFT JOIN professionals p ON p.user_id = a.actor_user_id
    LEFT JOIN professional_public_profiles pp ON pp.professional_id = p.id
    WHERE a.action IN ('EPISODE_VIEWED_BY_PROFESSIONAL','GRANT_CREATED','GRANT_REVOKED')
    ORDER BY a.created_at DESC LIMIT 100`, [req.user.id]);
  res.json(rows);
}));

/** Exportación de mis datos (derecho de acceso) */
r.get('/export', ah(async (req, res) => {
  const uid = req.user.id;
  const data = {
    profile: await one('SELECT * FROM patient_profiles WHERE user_id = ?', [uid]),
    episodes: await q('SELECT * FROM episodes WHERE patient_user_id = ?', [uid]),
    symptoms: await q('SELECT s.* FROM episode_symptoms s JOIN episodes e ON e.id = s.episode_id WHERE e.patient_user_id = ?', [uid]),
    followups: await q('SELECT f.* FROM episode_followups f JOIN episodes e ON e.id = f.episode_id WHERE e.patient_user_id = ?', [uid]),
    calendar: await q('SELECT * FROM calendar_events WHERE patient_user_id = ?', [uid]),
    appointments: await q('SELECT id, professional_id, start_at, end_at, status, mode, price_mxn FROM appointments WHERE patient_user_id = ?', [uid]),
    pulse: await q('SELECT pulse_date, value FROM daily_pulse WHERE patient_user_id = ?', [uid]),
    documents: await q('SELECT id, doc_type, title, doc_date, created_at FROM documents WHERE patient_user_id = ?', [uid]),
  };
  await audit(req, 'DATA_EXPORTED', 'user', uid);
  res.setHeader('Content-Disposition', 'attachment; filename="mexia-mis-datos.json"');
  res.json(data);
}));

export default r;
