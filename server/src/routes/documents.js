// Documentos clínicos privados del paciente (PDF / imagen).
import { Router } from 'express';
import { q, one, tx } from '../db.js';
import { ah, str, date, oneOf, id, notFound } from '../lib/http.js';
import { requireRole } from '../middleware/auth.js';
import { uploader, saveFile, absolutePath, removeFile } from '../lib/uploads.js';
import { audit } from '../lib/audit.js';

const r = Router();
r.use(requireRole('PATIENT'));

export const DOC_TYPES = ['Laboratorio', 'Receta', 'Imagen / estudio', 'Nota médica', 'Otro'];

r.get('/', ah(async (req, res) => {
  res.json(await q(`SELECT d.id, d.doc_type, d.title, d.doc_date, d.episode_id, d.created_at, m.mime, m.size_bytes, (m.id IS NOT NULL) AS has_file
    FROM documents d LEFT JOIN media m ON m.id = d.media_id
    WHERE d.patient_user_id = ? ORDER BY d.created_at DESC`, [req.user.id]));
}));

r.post('/', uploader('doc'), ah(async (req, res) => {
  const docType = oneOf(req.body.doc_type, DOC_TYPES, { field: 'Tipo', def: 'Otro' });
  const docDate = date(req.body.doc_date, { field: 'Fecha' });
  let episodeId = null;
  if (req.body.episode_id) {
    const ep = await one('SELECT id FROM episodes WHERE id = ? AND patient_user_id = ?', [id(req.body.episode_id), req.user.id]);
    if (!ep) throw notFound('Episodio no encontrado');
    episodeId = ep.id;
  }
  const saved = saveFile(req.file, 'doc', 'PRIVATE');
  const title = str(req.body.title, { field: 'Título', max: 200 }) || saved.originalName || 'Documento';
  try {
    const docId = await tx(async (c) => {
      const [m] = await c.execute(`INSERT INTO media (owner_user_id, kind, visibility, storage_key, original_name, mime, size_bytes)
        VALUES (?,?,?,?,?,?,?)`, [req.user.id, 'CLINICAL_DOC', 'PRIVATE', saved.storageKey, saved.originalName, saved.mime, saved.size]);
      const [d] = await c.execute('INSERT INTO documents (patient_user_id, episode_id, media_id, doc_type, title, doc_date) VALUES (?,?,?,?,?,?)',
        [req.user.id, episodeId, m.insertId, docType, title, docDate]);
      return d.insertId;
    });
    res.status(201).json(await one('SELECT id, doc_type, title, doc_date, episode_id, created_at FROM documents WHERE id = ?', [docId]));
  } catch (e) {
    removeFile(saved.storageKey);
    throw e;
  }
}));

/** Descarga: solo el titular. */
r.get('/:id/file', ah(async (req, res) => {
  const d = await one(`SELECT d.title, m.storage_key, m.mime FROM documents d JOIN media m ON m.id = d.media_id
    WHERE d.id = ? AND d.patient_user_id = ?`, [id(req.params.id), req.user.id]);
  if (!d) throw notFound('Documento no encontrado');
  res.setHeader('Content-Type', d.mime);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Disposition', `inline; filename="documento${d.mime === 'application/pdf' ? '.pdf' : ''}"`);
  res.sendFile(absolutePath(d.storage_key));
}));

r.delete('/:id', ah(async (req, res) => {
  const d = await one(`SELECT d.id, d.media_id, m.storage_key FROM documents d LEFT JOIN media m ON m.id = d.media_id
    WHERE d.id = ? AND d.patient_user_id = ?`, [id(req.params.id), req.user.id]);
  if (!d) throw notFound('Documento no encontrado');
  await tx(async (c) => {
    await c.execute('DELETE FROM documents WHERE id = ?', [d.id]);
    if (d.media_id) await c.execute('DELETE FROM media WHERE id = ?', [d.media_id]);
  });
  if (d.storage_key) removeFile(d.storage_key);
  await audit(req, 'DOCUMENT_DELETED', 'document', d.id);
  res.json({ ok: true });
}));

export default r;
