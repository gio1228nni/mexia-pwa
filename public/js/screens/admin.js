// Panel interno ADMIN: verificación de credenciales, aprobación de publicaciones, moderación y bitácora.
import { esc, formatDate, VERIFICATION, PROFILE_STATUS, toast, toastError, busy } from '../ui.js';

export default {
  admin: {
    role: 'ADMIN', hideHome: true,
    async render(ctx) {
      const tab = ctx.params.tab || 'verificacion';
      const tabs = [['verificacion', 'Verificación'], ['publicacion', 'Publicaciones'], ['resenas', 'Reseñas'], ['bitacora', 'Bitácora']];
      let body = '';
      if (tab === 'verificacion' || tab === 'publicacion') {
        const filter = ctx.ui.adminFilter || 'PENDING_REVIEW';
        const list = await ctx.api.get(`/admin/professionals${tab === 'verificacion' && filter !== 'ALL' ? '?status=' + filter : ''}`);
        const rows = tab === 'publicacion' ? list.filter((p) => p.profile_status === 'PENDING_REVIEW') : list;
        body = `${tab === 'verificacion' ? `<div class="trusted-tabs">${[['PENDING_REVIEW', 'Pendientes'], ['VERIFIED', 'Verificados'], ['REJECTED', 'Rechazados'], ['SUSPENDED', 'Suspendidos'], ['ALL', 'Todos']].map(([k, l]) => `<button class="${filter === k ? 'active' : ''}" data-filter="${k}">${l}</button>`).join('')}</div>` : '<p class="muted">Perfiles verificados que solicitaron publicar su borrador. Al aprobar, el borrador se copia de forma atómica a la versión pública.</p>'}
          ${rows.map((p) => `<article class="card" style="margin-top:12px"><div class="item-top"><div><strong>${esc(p.name)}</strong><div class="small muted">${esc(p.email)} · ${esc(p.phone || 'sin teléfono')}</div></div><span class="mxa-chip">${esc(VERIFICATION[p.verification_status])}</span></div>
            <p class="small">${esc(p.professional_type === 'ENFERMERIA' ? 'Enfermería' : 'Médico')} · ${esc(p.specialty || '—')} · Cédula <strong>${esc(p.license_number || '—')}</strong>${p.specialty_license ? ` · Cédula esp. <strong>${esc(p.specialty_license)}</strong>` : ''} · ${esc(p.university || '')} · ${p.experience_years ?? '—'} años</p>
            <p class="small muted">Perfil público: ${esc(PROFILE_STATUS[p.profile_status])}${p.published_version ? ` (v${p.published_version})` : ''} · declaró veracidad: ${p.attested_at ? formatDate(p.attested_at) : 'no'}</p>
            <p class="small">${p.credentials.map((c) => `<a class="source-tag" href="/api/admin/media/${c.id}/file" target="_blank" rel="noopener">📎 ${esc(c.original_name || 'documento')}</a>`).join(' ') || '<span class="small muted">Sin documentos adjuntos</span>'}</p>
            <p class="small muted">Valida la cédula en el Registro Nacional de Profesionistas (SEP) antes de aprobar.</p>
            ${tab === 'verificacion' ? `<div class="field"><label for="notes-${p.id}">Observaciones (visibles para el profesional)</label><input id="notes-${p.id}" class="input" maxlength="500" value="${esc(p.verification_notes || '')}"></div>
              <div class="actions"><button class="button primary" data-verify="VERIFIED:${p.id}">Verificar</button><button class="button" data-verify="REJECTED:${p.id}">Rechazar</button><button class="button danger" data-verify="SUSPENDED:${p.id}">Suspender</button></div>`
              : `<div class="actions"><button class="button primary" data-publish="APPROVE:${p.id}">Aprobar publicación</button><button class="button" data-publish="REJECT:${p.id}">Rechazar</button></div>`}
          </article>`).join('') || '<div class="card muted" style="margin-top:12px">No hay registros en esta categoría.</div>'}`;
      } else if (tab === 'resenas') {
        const list = await ctx.api.get('/admin/reviews?status=PENDING');
        body = list.map((r) => `<article class="card" style="margin-top:12px"><strong>${'★'.repeat(r.rating)}</strong> · ${esc(r.professional_name || '')}<p>${esc(r.body || 'Sin comentario')}</p><p class="small muted">${formatDate(r.created_at)}</p><div class="actions"><button class="button primary" data-review="PUBLISHED:${r.id}">Publicar</button><button class="button" data-review="REMOVED:${r.id}">Retirar</button></div></article>`).join('') || '<div class="card muted" style="margin-top:12px">No hay reseñas pendientes.</div>';
      } else {
        const list = await ctx.api.get('/admin/audit');
        body = `<div class="card" style="margin-top:12px;overflow-x:auto"><table class="mxa-table"><thead><tr><th>Fecha (UTC)</th><th>Acción</th><th>Recurso</th><th>Actor</th></tr></thead><tbody>${list.map((a) => `<tr><td>${esc(a.created_at)}</td><td>${esc(a.action)}</td><td>${esc(a.entity_type)} #${esc(a.entity_id ?? '')}</td><td>${esc(a.actor || '—')}</td></tr>`).join('')}</tbody></table></div>`;
      }
      return `<section><div class="badge">MEXIA · Administración interna</div><h2>Panel de administración</h2>
        <div class="trusted-tabs" role="group" aria-label="Secciones">${tabs.map(([k, l]) => `<button class="${tab === k ? 'active' : ''}" data-go="admin" data-tab="${k}">${l}</button>`).join('')}</div>${body}</section>`;
    },
    mount(root, ctx) {
      const act = (btn, fn, ok) => busy(btn, async () => { try { await fn(); toast(ok); ctx.render(); } catch (e) { toastError(e); } });
      root.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => { ctx.ui.adminFilter = b.dataset.filter; ctx.render(); }));
      root.querySelectorAll('[data-verify]').forEach((b) => b.addEventListener('click', () => {
        const [status, id] = b.dataset.verify.split(':');
        if (status !== 'VERIFIED' && !confirm('¿Confirmas esta decisión? El perfil saldrá del directorio si estaba publicado.')) return;
        act(b, () => ctx.api.patch(`/admin/professionals/${id}/verification`, { status, notes: root.querySelector(`#notes-${id}`)?.value || null }), 'Estado actualizado');
      }));
      root.querySelectorAll('[data-publish]').forEach((b) => b.addEventListener('click', () => {
        const [decision, id] = b.dataset.publish.split(':');
        act(b, () => ctx.api.post(`/admin/professionals/${id}/publish`, { decision }), decision === 'APPROVE' ? 'Perfil publicado' : 'Publicación rechazada');
      }));
      root.querySelectorAll('[data-review]').forEach((b) => b.addEventListener('click', () => {
        const [status, id] = b.dataset.review.split(':');
        act(b, () => ctx.api.patch(`/admin/reviews/${id}`, { status }), 'Reseña actualizada');
      }));
    },
  },
};
