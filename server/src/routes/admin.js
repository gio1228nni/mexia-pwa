// Administración interna: verificación de profesionales, aprobación de publicación y moderación de reseñas.
import { Router } from 'express';
import { q, one, tx } from '../db.js';
import { ah, str, oneOf, id, notFound, bad } from '../lib/http.js';
import { requireRole } from '../middleware/auth.js';
import { absolutePath } from '../lib/uploads.js';
import { audit } from '../lib/audit.js';

const r = Router();
r.use(requireRole('ADMIN'));

r.get('/professionals', ah(async (req, res) => {
  const status = req.query.status ? oneOf(req.query.status, ['DRAFT', 'PENDING_REVIEW', 'VERIFIED', 'REJECTED', 'SUSPENDED'], { field: 'status' }) : null;
  const rows = await q(`SELECT p.id, u.name, u.email, p.phone, p.professional_type, p.specialty, p.license_number, p.specialty_license,
      p.university, p.experience_years, p.verification_status, p.verification_notes, p.attested_at, p.updated_at,
      pp.status AS profile_status, pp.submitted_at, pp.published_version
    FROM professionals p JOIN users u ON u.id = p.user_id JOIN professional_public_profiles pp ON pp.professional_id = p.id
    ${status ? 'WHERE p.verification_status = ?' : ''} ORDER BY p.updated_at DESC LIMIT 200`, status ? [status] : []);
  for (const row of rows) {
    row.credentials = await q(`SELECT m.id, m.original_name, m.mime FROM media m JOIN professionals p ON p.user_id = m.owner_user_id
      WHERE p.id = ? AND m.kind = 'CREDENTIAL' AND m.status <> 'REMOVED'`, [row.id]);
  }
  res.json(rows);
}));

r.get('/media/:id/file', ah(async (req, res) => {
  const m = await one(`SELECT storage_key, mime FROM media WHERE id = ? AND kind = 'CREDENTIAL' AND status <> 'REMOVED'`, [id(req.params.id)]);
  if (!m) throw notFound();
  await audit(req, 'CREDENTIAL_VIEWED', 'media', Number(req.params.id));
  res.setHeader('Content-Type', m.mime);
  res.setHeader('Cache-Control', 'private, no-store');
  res.sendFile(absolutePath(m.storage_key));
}));

r.patch('/professionals/:id/verification', ah(async (req, res) => {
  const pid = id(req.params.id);
  const status = oneOf(req.body.status, ['VERIFIED', 'REJECTED', 'SUSPENDED', 'PENDING_REVIEW'], { field: 'Estado', required: true });
  const notes = str(req.body.notes, { field: 'Notas', max: 500 });
  const p = await one('SELECT id FROM professionals WHERE id = ?', [pid]);
  if (!p) throw notFound();
  await tx(async (c) => {
    await c.execute(`UPDATE professionals SET verification_status = ?, verification_notes = ?,
        verified_at = IF(? = 'VERIFIED', UTC_TIMESTAMP(), verified_at), verified_by = IF(? = 'VERIFIED', ?, verified_by) WHERE id = ?`,
    [status, notes, status, status, req.user.id, pid]);
    // Un profesional suspendido o rechazado sale del directorio de inmediato
    if (status === 'SUSPENDED' || status === 'REJECTED') {
      await c.execute(`UPDATE professional_public_profiles SET status = 'WITHDRAWN' WHERE professional_id = ? AND status = 'PUBLISHED'`, [pid]);
    }
    await audit(req, 'VERIFICATION_' + status, 'professional', pid, null, c);
  });
  res.json({ ok: true });
}));

/** Aprueba/rechaza la publicación: copia atómica del borrador a la versión publicada */
r.post('/professionals/:id/publish', ah(async (req, res) => {
  const pid = id(req.params.id);
  const decision = oneOf(req.body.decision, ['APPROVE', 'REJECT'], { field: 'Decisión', required: true });
  await tx(async (c) => {
    const [[row]] = await c.execute(`SELECT p.verification_status, pp.draft_json, pp.status FROM professionals p
        JOIN professional_public_profiles pp ON pp.professional_id = p.id WHERE p.id = ? FOR UPDATE`, [pid]);
    if (!row) throw notFound();
    if (decision === 'REJECT') {
      await c.execute(`UPDATE professional_public_profiles SET status = IF(published_version > 0, status, 'DRAFT'), submitted_at = NULL WHERE professional_id = ?`, [pid]);
      await audit(req, 'PUBLISH_REJECTED', 'professional', pid, null, c);
      return;
    }
    if (row.verification_status !== 'VERIFIED') throw bad('Primero verifica las credenciales del profesional');
    const draft = typeof row.draft_json === 'string' ? JSON.parse(row.draft_json) : (row.draft_json || {});
    // El servicio publicado refleja exactamente precio/duración/modalidad de la versión publicada
    await c.execute('UPDATE services SET active = 0 WHERE professional_id = ?', [pid]);
    const [s] = await c.execute('INSERT INTO services (professional_id, name, price_mxn, duration_min, mode) VALUES (?,?,?,?,?)',
      [pid, 'Consulta', Number(draft.price || 0), Number(draft.duration || 30), draft.mode || 'PRESENCIAL']);
    const published = { ...draft, serviceId: s.insertId };
    await c.execute(`UPDATE professional_public_profiles SET published_json = ?, published_version = published_version + 1,
        status = 'PUBLISHED', city = ?, published_at = UTC_TIMESTAMP(), submitted_at = NULL WHERE professional_id = ?`,
    [JSON.stringify(published), draft.city || null, pid]);
    await audit(req, 'PUBLISH_APPROVED', 'professional', pid, null, c);
  });
  res.json({ ok: true });
}));

r.get('/reviews', ah(async (req, res) => {
  const status = oneOf(req.query.status, ['PENDING', 'PUBLISHED', 'REMOVED'], { field: 'status', def: 'PENDING' });
  res.json(await q(`SELECT r.id, r.rating, r.body, r.created_at, r.moderation_status,
      JSON_UNQUOTE(JSON_EXTRACT(pp.published_json,'$.displayName')) AS professional_name
    FROM reviews r LEFT JOIN professional_public_profiles pp ON pp.professional_id = r.professional_id
    WHERE r.moderation_status = ? ORDER BY r.created_at DESC LIMIT 200`, [status]));
}));

r.patch('/reviews/:id', ah(async (req, res) => {
  const status = oneOf(req.body.status, ['PUBLISHED', 'REMOVED'], { field: 'Estado', required: true });
  const result = await q('UPDATE reviews SET moderation_status = ? WHERE id = ?', [status, id(req.params.id)]);
  if (!result.affectedRows) throw notFound();
  await audit(req, 'REVIEW_' + status, 'review', Number(req.params.id));
  res.json({ ok: true });
}));

r.get('/audit', ah(async (req, res) => {
  res.json(await q(`SELECT a.id, a.action, a.entity_type, a.entity_id, a.created_at, u.email AS actor
    FROM audit_events a LEFT JOIN users u ON u.id = a.actor_user_id ORDER BY a.id DESC LIMIT 300`));
}));

export default r;
