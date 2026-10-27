// Portal médico: registro, perfil (borrador/publicación), fotos, agenda, consultas, pacientes y estadísticas.
import { Router } from 'express';
import { q, one, tx } from '../db.js';
import { ah, str, int, num, date, time, oneOf, id, bool, notFound, bad, forbidden, conflict } from '../lib/http.js';
import { requireProfessional } from '../middleware/auth.js';
import { buildPublicProfile } from '../lib/profiles.js';
import { validateRules, nowLocal, addDays, weekdayOf } from '../lib/schedule.js';
import { uploader, saveFile, removeFile, absolutePath } from '../lib/uploads.js';
import { audit } from '../lib/audit.js';

const r = Router();
r.use(requireProfessional);

const LICENSE_RE = /^\d{7,8}$/;   // formato de cédula SEP (7–8 dígitos). El formato NO acredita autenticidad.
const PHONE_RE = /^\d{10}$/;
const parse = (j) => (j == null ? {} : typeof j === 'string' ? JSON.parse(j) : j);

async function loadMe(pid) {
  const p = await one(`SELECT p.*, u.name, u.email FROM professionals p JOIN users u ON u.id = p.user_id WHERE p.id = ?`, [pid]);
  const pp = await one('SELECT * FROM professional_public_profiles WHERE professional_id = ?', [pid]);
  const media = await q(`SELECT id, kind, visibility, status, storage_key, original_name, mime, created_at FROM media
      WHERE owner_user_id = ? AND kind IN ('PORTRAIT','FACILITY','CREDENTIAL') AND status <> 'REMOVED' ORDER BY id`, [p.user_id]);
  const rules = await q('SELECT id, weekday, start_time, end_time, slot_minutes FROM availability_rules WHERE professional_id = ? ORDER BY weekday, start_time', [pid]);
  const draft = parse(pp.draft_json);
  const checklist = [
    { key: 'identity', name: 'Datos de identidad y contacto', detail: 'Nombre completo, correo y teléfono', ready: !!(p.name && p.email && p.phone), target: 'perfil' },
    { key: 'credentials', name: 'Credenciales profesionales declaradas', detail: 'Especialidad, cédula y formación', ready: !!(p.specialty && p.license_number), target: 'perfil' },
    { key: 'practice', name: 'Consultorio y servicios', detail: 'Modalidad, ubicación, duración y tarifa', ready: !!(draft.mode && draft.city && draft.price != null && draft.duration), target: 'perfil' },
    { key: 'agenda', name: 'Disponibilidad de atención', detail: 'Días y horarios de consulta', ready: rules.length > 0, target: 'agenda' },
    { key: 'documents', name: 'Documentos de acreditación', detail: 'Cédula / título (privados, solo revisión)', ready: media.some((m) => m.kind === 'CREDENTIAL'), target: 'verificacion' },
  ];
  return {
    professional: {
      id: p.id, name: p.name, email: p.email, phone: p.phone, professional_type: p.professional_type, specialty: p.specialty,
      license_number: p.license_number, specialty_license: p.specialty_license, university: p.university,
      experience_years: p.experience_years, timezone: p.timezone, registration_step: p.registration_step,
      attested_at: p.attested_at, verification_status: p.verification_status, verification_notes: p.verification_notes, verified_at: p.verified_at,
    },
    publicProfile: { status: pp.status, published_version: pp.published_version, submitted_at: pp.submitted_at, published_at: pp.published_at, draft },
    media: media.map((m) => ({ ...m, url: m.visibility === 'PUBLIC' ? '/media/' + m.storage_key.replace(/^public\//, '') : null, storage_key: undefined })),
    availability: rules,
    checklist,
  };
}

r.get('/me', ah(async (req, res) => res.json(await loadMe(req.professional.id))));

/** Datos de identidad y credenciales (registro paso 1-2 y edición) */
r.patch('/me', ah(async (req, res) => {
  const b = req.body;
  const cur = await one('SELECT * FROM professionals WHERE id = ?', [req.professional.id]);
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
  const next = {
    phone: has('phone') ? str(b.phone, { field: 'Teléfono', max: 20 }) : cur.phone,
    professional_type: has('professional_type') ? oneOf(b.professional_type, ['MEDICO', 'ENFERMERIA'], { field: 'Tipo de profesional', def: 'MEDICO' }) : cur.professional_type,
    specialty: has('specialty') ? str(b.specialty, { field: 'Especialidad', max: 100 }) : cur.specialty,
    license_number: has('license_number') ? str(b.license_number, { field: 'Cédula profesional', max: 20 }) : cur.license_number,
    specialty_license: has('specialty_license') ? str(b.specialty_license, { field: 'Cédula de especialidad', max: 20 }) : cur.specialty_license,
    university: has('university') ? str(b.university, { field: 'Institución formadora', max: 150 }) : cur.university,
    experience_years: has('experience_years') ? int(b.experience_years, { field: 'Años de experiencia', min: 0, max: 70 }) : cur.experience_years,
    registration_step: has('registration_step') ? int(b.registration_step, { field: 'Paso', min: 0, max: 4 }) : cur.registration_step,
  };
  if (next.phone && !PHONE_RE.test(next.phone)) throw bad('El teléfono debe tener 10 dígitos');
  if (next.license_number && !LICENSE_RE.test(next.license_number)) throw bad('La cédula profesional debe tener 7 u 8 dígitos');
  if (next.specialty_license && !LICENSE_RE.test(next.specialty_license)) throw bad('La cédula de especialidad debe tener 7 u 8 dígitos');
  let status = cur.verification_status;
  // Cambiar identidad/credenciales de un perfil verificado exige nueva revisión
  const sensitive = ['specialty', 'license_number', 'specialty_license', 'professional_type'];
  if (status === 'VERIFIED' && sensitive.some((k) => (next[k] ?? null) !== (cur[k] ?? null))) status = 'PENDING_REVIEW';
  await tx(async (c) => {
    await c.execute(`UPDATE professionals SET phone=?, professional_type=?, specialty=?, license_number=?, specialty_license=?,
        university=?, experience_years=?, registration_step=GREATEST(registration_step, ?), verification_status=? WHERE id=?`,
      [next.phone, next.professional_type, next.specialty, next.license_number, next.specialty_license,
        next.university, next.experience_years, next.registration_step, status, cur.id]);
    if (has('name')) {
      await c.execute('UPDATE users SET name = ? WHERE id = ?', [str(b.name, { field: 'Nombre', required: true, min: 3, max: 120 }), req.user.id]);
    }
  });
  if (status !== cur.verification_status) await audit(req, 'VERIFICATION_RESET_BY_EDIT', 'professional', cur.id);
  res.json(await loadMe(cur.id));
}));

/** Borrador del perfil público (no visible para pacientes hasta publicarse) */
r.patch('/me/draft', ah(async (req, res) => {
  const pp = await one('SELECT draft_json FROM professional_public_profiles WHERE professional_id = ?', [req.professional.id]);
  const draft = parse(pp.draft_json);
  const b = req.body;
  const set = (k, v) => { if (Object.prototype.hasOwnProperty.call(b, k)) draft[k] = v(); };
  set('displayName', () => str(b.displayName, { field: 'Nombre público', max: 120 }));
  set('specialty', () => str(b.specialty, { field: 'Especialidad', max: 100 }));
  set('bio', () => str(b.bio, { field: 'Presentación', max: 2000 }));
  set('city', () => str(b.city, { field: 'Ciudad', max: 100 }));
  set('address', () => str(b.address, { field: 'Dirección', max: 250 }));
  set('languages', () => str(b.languages, { field: 'Idiomas', max: 120 }));
  set('mode', () => oneOf(b.mode, ['PRESENCIAL', 'EN_LINEA', 'AMBAS'], { field: 'Modalidad', def: 'PRESENCIAL' }));
  set('price', () => num(b.price, { field: 'Precio', min: 0, max: 100000 }));
  set('duration', () => int(b.duration, { field: 'Duración', min: 10, max: 180 }));
  set('experienceYears', () => int(b.experienceYears, { field: 'Años de experiencia', min: 0, max: 70 }));
  await q('UPDATE professional_public_profiles SET draft_json = ? WHERE professional_id = ?', [JSON.stringify(draft), req.professional.id]);
  res.json(await loadMe(req.professional.id));
}));

/** Vista previa: el MISMO constructor que usa el paciente, aplicado al borrador */
r.get('/me/preview', ah(async (req, res) => {
  res.json(await buildPublicProfile(req.professional.id, 'draft'));
}));

/** Envío de la solicitud de verificación (paso 4 del registro) */
r.post('/me/submit-verification', ah(async (req, res) => {
  if (req.body.attest !== true) throw bad('Debes declarar que la información es verdadera');
  const me = await loadMe(req.professional.id);
  const missing = me.checklist.filter((c) => ['identity', 'credentials', 'practice'].includes(c.key) && !c.ready);
  if (missing.length) throw bad('Completa: ' + missing.map((m) => m.name).join(', '));
  if (['VERIFIED', 'SUSPENDED'].includes(me.professional.verification_status)) throw conflict('Tu estado actual no permite reenviar');
  await q(`UPDATE professionals SET attested_at = UTC_TIMESTAMP(), verification_status = 'PENDING_REVIEW', registration_step = 4 WHERE id = ?`,
    [req.professional.id]);
  await audit(req, 'VERIFICATION_SUBMITTED', 'professional', req.professional.id);
  res.json(await loadMe(req.professional.id));
}));

/** Solicitar publicación del borrador (lo aprueba un ADMIN) */
r.post('/me/publish-request', ah(async (req, res) => {
  const p = await one('SELECT verification_status FROM professionals WHERE id = ?', [req.professional.id]);
  if (p.verification_status !== 'VERIFIED') throw forbidden('Tu perfil podrá publicarse cuando tus credenciales estén verificadas');
  const preview = await buildPublicProfile(req.professional.id, 'draft');
  const missing = [];
  if (!preview.displayName) missing.push('nombre público');
  if (!preview.specialty) missing.push('especialidad');
  if (!preview.bio) missing.push('presentación');
  if (!preview.city) missing.push('ciudad');
  if (preview.price == null) missing.push('precio');
  if (missing.length) throw bad('Para publicar falta: ' + missing.join(', '));
  const rules = await one('SELECT COUNT(*) n FROM availability_rules WHERE professional_id = ?', [req.professional.id]);
  if (!rules.n) throw bad('Configura tu disponibilidad antes de publicar');
  await q(`UPDATE professional_public_profiles SET status = IF(status='PUBLISHED','PUBLISHED','PENDING_REVIEW'), submitted_at = UTC_TIMESTAMP()
      WHERE professional_id = ?`, [req.professional.id]);
  await audit(req, 'PUBLISH_REQUESTED', 'professional', req.professional.id);
  res.json(await loadMe(req.professional.id));
}));

/** Retirar la ficha del directorio */
r.post('/me/withdraw', ah(async (req, res) => {
  await q(`UPDATE professional_public_profiles SET status = 'WITHDRAWN', submitted_at = NULL WHERE professional_id = ?`, [req.professional.id]);
  await audit(req, 'PROFILE_WITHDRAWN', 'professional', req.professional.id);
  res.json(await loadMe(req.professional.id));
}));

// ---------- Fotos y documentos de acreditación ----------
r.post('/me/media', uploader('image'), ah(async (req, res) => {
  const kind = oneOf(req.body.kind, ['PORTRAIT', 'FACILITY', 'CREDENTIAL'], { field: 'Tipo', required: true });
  const visibility = kind === 'CREDENTIAL' ? 'PRIVATE' : 'PUBLIC';
  if (kind === 'FACILITY') {
    const c = await one(`SELECT COUNT(*) n FROM media WHERE owner_user_id = ? AND kind = 'FACILITY' AND status <> 'REMOVED'`, [req.user.id]);
    if (c.n >= 6) throw bad('Máximo 6 fotografías de instalaciones');
  }
  const saved = saveFile(req.file, kind === 'CREDENTIAL' ? 'doc' : 'image', visibility);
  const result = await q(`INSERT INTO media (owner_user_id, kind, visibility, storage_key, original_name, mime, size_bytes) VALUES (?,?,?,?,?,?,?)`,
    [req.user.id, kind, visibility, saved.storageKey, saved.originalName, saved.mime, saved.size]);
  if (kind !== 'CREDENTIAL') {
    const pp = await one('SELECT draft_json FROM professional_public_profiles WHERE professional_id = ?', [req.professional.id]);
    const draft = parse(pp.draft_json);
    if (kind === 'PORTRAIT') draft.portraitMediaId = result.insertId;
    else draft.facilityMediaIds = [...(draft.facilityMediaIds || []), result.insertId];
    await q('UPDATE professional_public_profiles SET draft_json = ? WHERE professional_id = ?', [JSON.stringify(draft), req.professional.id]);
  }
  res.status(201).json(await loadMe(req.professional.id));
}));

/** Eliminar foto: se retira del borrador y también de la versión publicada (no se puede mostrar algo borrado) */
r.delete('/me/media/:id', ah(async (req, res) => {
  const m = await one(`SELECT * FROM media WHERE id = ? AND owner_user_id = ? AND status <> 'REMOVED'`, [id(req.params.id), req.user.id]);
  if (!m) throw notFound('Archivo no encontrado');
  await q(`UPDATE media SET status = 'REMOVED' WHERE id = ?`, [m.id]);
  removeFile(m.storage_key);
  const pp = await one('SELECT draft_json FROM professional_public_profiles WHERE professional_id = ?', [req.professional.id]);
  const draft = parse(pp.draft_json);
  if (draft.portraitMediaId === m.id) delete draft.portraitMediaId;
  draft.facilityMediaIds = (draft.facilityMediaIds || []).filter((x) => x !== m.id);
  await q('UPDATE professional_public_profiles SET draft_json = ? WHERE professional_id = ?', [JSON.stringify(draft), req.professional.id]);
  await audit(req, 'MEDIA_REMOVED', 'media', m.id, { kind: m.kind });
  res.json(await loadMe(req.professional.id));
}));

r.get('/me/media/:id/file', ah(async (req, res) => {
  const m = await one(`SELECT storage_key, mime FROM media WHERE id = ? AND owner_user_id = ? AND status <> 'REMOVED'`, [id(req.params.id), req.user.id]);
  if (!m) throw notFound();
  res.setHeader('Content-Type', m.mime);
  res.setHeader('Cache-Control', 'private, no-store');
  res.sendFile(absolutePath(m.storage_key));
}));

// ---------- Disponibilidad ----------
r.get('/me/availability', ah(async (req, res) => {
  const rules = await q('SELECT id, weekday, start_time, end_time, slot_minutes FROM availability_rules WHERE professional_id = ? ORDER BY weekday, start_time', [req.professional.id]);
  const timeOff = await q('SELECT id, start_at, end_at, reason FROM time_off WHERE professional_id = ? AND end_at >= CURDATE() ORDER BY start_at', [req.professional.id]);
  res.json({ rules, timeOff });
}));

/** Reemplaza todas las franjas semanales */
r.put('/me/availability', ah(async (req, res) => {
  if (!Array.isArray(req.body.rules) || req.body.rules.length > 70) throw bad('Lista de franjas inválida');
  const rules = req.body.rules.map((x) => ({
    weekday: int(x.weekday, { field: 'Día', min: 0, max: 6, required: true }),
    start_time: time(x.start_time, { field: 'Desde', required: true }),
    end_time: time(x.end_time, { field: 'Hasta', required: true }),
    slot_minutes: int(x.slot_minutes, { field: 'Intervalo', min: 10, max: 180 }) || 30,
  }));
  const err = validateRules(rules);
  if (err) throw bad(err);
  await tx(async (c) => {
    await c.execute('DELETE FROM availability_rules WHERE professional_id = ?', [req.professional.id]);
    for (const x of rules) {
      await c.execute('INSERT INTO availability_rules (professional_id, weekday, start_time, end_time, slot_minutes) VALUES (?,?,?,?,?)',
        [req.professional.id, x.weekday, x.start_time, x.end_time, x.slot_minutes]);
    }
  });
  res.json({ ok: true, rules });
}));

r.post('/me/time-off', ah(async (req, res) => {
  const d = date(req.body.date, { field: 'Fecha', required: true });
  const until = date(req.body.until, { field: 'Hasta' }) || d;
  if (until < d) throw bad('Rango inválido');
  const reason = str(req.body.reason, { field: 'Motivo', max: 200 });
  const result = await q('INSERT INTO time_off (professional_id, start_at, end_at, reason) VALUES (?,?,?,?)',
    [req.professional.id, `${d} 00:00:00`, `${until} 23:59:59`, reason]);
  res.status(201).json({ id: result.insertId });
}));

r.delete('/me/time-off/:id', ah(async (req, res) => {
  const result = await q('DELETE FROM time_off WHERE id = ? AND professional_id = ?', [id(req.params.id), req.professional.id]);
  if (!result.affectedRows) throw notFound();
  res.json({ ok: true });
}));

// ---------- Consultas ----------
r.get('/me/appointments', ah(async (req, res) => {
  const conds = ['a.professional_id = ?'], params = [req.professional.id];
  if (req.query.status) { conds.push('a.status = ?'); params.push(oneOf(req.query.status, ['REQUESTED', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'], { field: 'status' })); }
  if (req.query.from) { conds.push('a.start_at >= ?'); params.push(date(req.query.from, { field: 'from' })); }
  if (req.query.to) { conds.push('a.start_at <= ?'); params.push(date(req.query.to, { field: 'to' }) + ' 23:59:59'); }
  // Se muestra el nombre del paciente (relación asistencial) pero NUNCA datos clínicos sin autorización
  const rows = await q(`SELECT a.id, a.start_at, a.end_at, a.status, a.mode, a.price_mxn, a.reason, a.version, a.episode_id,
      u.name AS patient_name,
      (SELECT COUNT(*) FROM episode_access_grants g WHERE g.appointment_id = a.id AND g.revoked_at IS NULL AND g.expires_at > UTC_TIMESTAMP()) AS has_grant
    FROM appointments a JOIN users u ON u.id = a.patient_user_id
    WHERE ${conds.join(' AND ')} ORDER BY a.start_at`, params);
  res.json(rows.map((x) => ({ ...x, has_grant: !!x.has_grant, episode_id: x.has_grant ? x.episode_id : null })));
}));

/** Pacientes con relación asistencial y episodios compartidos vigentes */
r.get('/me/patients', ah(async (req, res) => {
  const patients = await q(`SELECT u.id, u.name, MAX(a.start_at) AS last_appointment, COUNT(*) AS appointments,
      SUM(a.status = 'COMPLETED') AS completed
    FROM appointments a JOIN users u ON u.id = a.patient_user_id
    WHERE a.professional_id = ? AND a.status IN ('REQUESTED','CONFIRMED','COMPLETED','NO_SHOW')
    GROUP BY u.id, u.name ORDER BY last_appointment DESC`, [req.professional.id]);
  const grants = await q(`SELECT g.id, g.episode_id, g.scope, g.expires_at, e.title, e.patient_user_id
    FROM episode_access_grants g JOIN episodes e ON e.id = g.episode_id
    WHERE g.professional_id = ? AND g.revoked_at IS NULL AND g.expires_at > UTC_TIMESTAMP()`, [req.professional.id]);
  res.json(patients.map((p) => ({ ...p, sharedEpisodes: grants.filter((g) => g.patient_user_id === p.id).map(({ patient_user_id, ...g }) => g) })));
}));

/** Lectura de un episodio compartido: requiere autorización vigente y queda en bitácora */
r.get('/episodes/:id', ah(async (req, res) => {
  const epId = id(req.params.id);
  const grant = await one(`SELECT * FROM episode_access_grants WHERE episode_id = ? AND professional_id = ?
      AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP() ORDER BY granted_at DESC LIMIT 1`, [epId, req.professional.id]);
  if (!grant) {
    await audit(req, 'EPISODE_ACCESS_DENIED', 'episode', epId);
    throw forbidden('No tienes una autorización vigente para este episodio');
  }
  const ep = await one(`SELECT e.id, e.title, e.onset_reported, e.start_date, e.end_date, e.status, e.outcome, u.name AS patient_name
     FROM episodes e JOIN users u ON u.id = e.patient_user_id WHERE e.id = ?`, [epId]);
  const symptoms = await q('SELECT name, onset_date, intensity, evolution, location, side, pain_type, notes, active, recorded_at FROM episode_symptoms WHERE episode_id = ?', [epId]);
  const out = { ...ep, scope: grant.scope, expires_at: grant.expires_at, symptoms };
  if (grant.scope === 'FULL') {
    out.followups = await q('SELECT intensity, evolution, note, recorded_at FROM episode_followups WHERE episode_id = ? ORDER BY recorded_at', [epId]);
    out.medications = await q(`SELECT title, event_date, event_time, repeat_mode, repeat_until, notes FROM calendar_events WHERE episode_id = ? AND type = 'Medicamento'`, [epId]);
  } else {
    out.followups = await q('SELECT intensity, evolution, recorded_at FROM episode_followups WHERE episode_id = ? ORDER BY recorded_at DESC LIMIT 5', [epId]);
  }
  await audit(req, 'EPISODE_VIEWED_BY_PROFESSIONAL', 'episode', epId, { grantId: grant.id, scope: grant.scope });
  res.json(out);
}));

/** Estadísticas semanales basadas en estados explícitos */
r.get('/me/stats', ah(async (req, res) => {
  const p = await one('SELECT timezone FROM professionals WHERE id = ?', [req.professional.id]);
  const ref = date(req.query.week, { field: 'week' }) || nowLocal(p.timezone).slice(0, 10);
  const start = addDays(ref, -weekdayOf(ref));     // lunes
  const end = addDays(start, 6);
  const rows = await q(`SELECT DATE(start_at) AS d, status, COUNT(*) n FROM appointments
      WHERE professional_id = ? AND start_at BETWEEN ? AND ? GROUP BY DATE(start_at), status`,
    [req.professional.id, start, end + ' 23:59:59']);
  const days = Array.from({ length: 7 }, (_, i) => ({ date: addDays(start, i), REQUESTED: 0, CONFIRMED: 0, COMPLETED: 0, CANCELLED: 0, REJECTED: 0, NO_SHOW: 0 }));
  for (const x of rows) { const day = days.find((d) => d.date === x.d); if (day) day[x.status] = x.n; }
  const sum = (k) => days.reduce((s, d) => s + d[k], 0);
  const [pending] = await q(`SELECT COUNT(*) n FROM appointments WHERE professional_id = ? AND status = 'REQUESTED'`, [req.professional.id]);
  res.json({ timezone: p.timezone, start, end, days,
    totals: { requested: sum('REQUESTED'), confirmed: sum('CONFIRMED'), completed: sum('COMPLETED'), cancelled: sum('CANCELLED'),
      rejected: sum('REJECTED'), noShow: sum('NO_SHOW') },
    pendingAllDates: pending.n });
}));

export default r;
