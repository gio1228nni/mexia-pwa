// Construcción ÚNICA del perfil público: la usan el directorio del paciente,
// la ficha pública y la vista previa del médico (mismo formato, misma función).
import { q, one } from '../db.js';

export const MODES = { PRESENCIAL: 'Presencial', EN_LINEA: 'En línea', AMBAS: 'Presencial y en línea' };

const parse = (j) => (j == null ? null : typeof j === 'string' ? JSON.parse(j) : j);

async function mediaFor(ids) {
  const list = (ids || []).map(Number).filter(Boolean);
  if (!list.length) return [];
  const rows = await q(`SELECT id, storage_key FROM media WHERE id IN (${list.map(() => '?').join(',')})
      AND visibility = 'PUBLIC' AND status = 'ACTIVE'`, list);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return list.filter((i) => byId.has(i)).map((i) => ({ id: i, url: '/media/' + byId.get(i).storage_key.replace(/^public\//, '') }));
}

export async function reviewsFor(professionalId) {
  const reviews = await q(`SELECT r.id, r.rating, r.body, r.created_at FROM reviews r
     WHERE r.professional_id = ? AND r.moderation_status = 'PUBLISHED' ORDER BY r.created_at DESC LIMIT 50`, [professionalId]);
  const avg = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : null;
  return { reviews, rating: avg ? Math.round(avg * 10) / 10 : null, reviewCount: reviews.length };
}

/**
 * Normaliza un JSON de perfil (draft o published) al formato público.
 * @param source 'published' | 'draft'
 */
export async function buildPublicProfile(professionalId, source = 'published') {
  const row = await one(`SELECT p.id, p.verification_status, p.experience_years, p.professional_type, p.timezone,
      pp.draft_json, pp.published_json, pp.published_version, pp.status, pp.published_at
    FROM professionals p JOIN professional_public_profiles pp ON pp.professional_id = p.id WHERE p.id = ?`, [professionalId]);
  if (!row) return null;
  const data = parse(source === 'draft' ? row.draft_json : row.published_json);
  if (!data) return null;
  const [portrait] = await mediaFor(data.portraitMediaId ? [data.portraitMediaId] : []);
  const gallery = await mediaFor(data.facilityMediaIds || []);
  const rev = await reviewsFor(professionalId);
  return {
    id: row.id,
    source,
    version: source === 'published' ? row.published_version : null,
    status: row.status,
    verified: row.verification_status === 'VERIFIED',
    verificationStatus: row.verification_status,
    displayName: data.displayName || '',
    specialty: data.specialty || '',
    bio: data.bio || '',
    city: data.city || '',
    address: data.address || '',
    languages: data.languages || 'Español',
    experienceYears: data.experienceYears ?? row.experience_years ?? null,
    mode: data.mode || 'PRESENCIAL',
    modeLabel: MODES[data.mode] || MODES.PRESENCIAL,
    price: data.price ?? null,
    duration: data.duration || 30,
    serviceId: data.serviceId || null,
    timezone: row.timezone,
    portrait: portrait || null,
    gallery,
    ...rev,
  };
}

/** Los perfiles que un paciente puede ver: publicados Y verificados */
export const VISIBLE_SQL = `pp.status = 'PUBLISHED' AND p.verification_status = 'VERIFIED' AND u.status = 'ACTIVE'`;
