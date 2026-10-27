import { pool } from '../db.js';

/**
 * Registra un evento de auditoría. NUNCA incluir contenido clínico en meta:
 * solo identificadores y datos operativos.
 */
export async function audit(req, action, entityType, entityId = null, meta = null, conn = pool) {
  try {
    await conn.execute(
      'INSERT INTO audit_events (actor_user_id, action, entity_type, entity_id, meta, ip) VALUES (?,?,?,?,?,?)',
      [req?.user?.id || null, action, entityType, entityId, meta ? JSON.stringify(meta) : null, req?.ip || null]
    );
  } catch (e) {
    // La auditoría no debe tumbar la petición, pero sí dejar rastro en el log del servidor.
    console.error('[audit] no se pudo registrar', action, e.message);
  }
}
