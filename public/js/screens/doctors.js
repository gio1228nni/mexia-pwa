// Directorio de profesionales verificados, ficha pública compartida, reserva, citas, mensajes, reseñas y médicos de confianza.
import { esc, nav, localISO, addDaysISO, formatDate, formatDateTime, hhmm, money, statusChip, toast, toastError, readForm, busy } from '../ui.js';
import { idemKey } from '../api.js';
import { bottomNav } from './patient.js';

/**
 * Tarjeta pública ÚNICA (equivalente a mx65SharedPublicCard): la usan la ficha del paciente
 * y la vista previa del médico. Recibe el objeto que devuelve el servidor (buildPublicProfile).
 */
export function publicCard(d, tab = 'galeria') {
  const stars = (n) => '★'.repeat(Math.max(0, Math.min(5, Math.round(n || 0))));
  const badge = d.verified
    ? '<span class="mx64-tag">✓ Credenciales verificadas por MEXIA</span>'
    : '<span class="mx64-tag warn">◷ Credenciales pendientes de verificación</span>';
  return `<div class="mx64-card mx65-shared-profile"><div class="mx64-cover"></div><div class="mx64-main">
    <div class="mx64-identity"><div class="mx64-avatar">${d.portrait ? `<img src="${esc(d.portrait.url)}" alt="Retrato de ${esc(d.displayName)}" loading="lazy">` : '✚'}</div>
      <div class="mx64-identity-copy"><h2>${esc(d.displayName || 'Nombre profesional')}</h2><p>${esc(d.specialty || 'Especialidad por completar')}</p></div></div>
    <div class="mx64-badges">${badge}<span class="mx64-tag">${esc(d.modeLabel || '')}</span></div>
    <div class="mx64-facts"><div class="mx64-fact"><strong>${esc(d.experienceYears ?? '—')}</strong><small>Años de experiencia</small></div><div class="mx64-fact"><strong>${d.rating ?? '—'}</strong><small>${d.reviewCount ? 'Valoración' : 'Sin valoración'}</small></div><div class="mx64-fact"><strong>${d.reviewCount}</strong><small>Reseñas</small></div></div>
    <p>${esc(d.bio || 'El profesional todavía no ha agregado su presentación.')}</p>
    <div class="mx64-tabs" role="tablist" aria-label="Secciones del perfil">${[['galeria', 'Galería'], ['servicios', 'Servicios'], ['resenas', 'Reseñas']].map(([k, l]) => `<button type="button" role="tab" aria-selected="${tab === k}" data-profile-tab="${k}" class="${tab === k ? 'active' : ''}">${l}</button>`).join('')}</div>
    ${tab === 'galeria'
    ? `<div class="mx64-gallery">${d.gallery.length ? d.gallery.map((g, i) => `<div><img src="${esc(g.url)}" alt="Instalaciones ${i + 1}" loading="lazy"></div>`).join('') : '<div>Consultorio</div><div>Recepción</div><div>Instalaciones</div>'}</div><p class="mx49-mini">${d.gallery.length ? 'Fotografías del consultorio.' : 'Sin fotografías disponibles.'}</p>`
    : tab === 'servicios'
      ? `<h3>Consulta profesional</h3><p>${esc(d.specialty)} · ${esc(d.modeLabel)}</p><p><strong>${money(d.price)}</strong> · ${esc(d.duration)} minutos</p><p class="mx49-mini">${esc(d.city || 'Ciudad por definir')} · ${esc(d.address || 'Dirección por definir')}</p><p class="mx49-mini">Idiomas: ${esc(d.languages)}</p>`
      : `<h3>Opiniones de pacientes</h3>${d.reviews.length ? d.reviews.map((r) => `<div class="mx64-review"><strong>${stars(r.rating)}</strong><p>${esc(r.body || 'Sin comentario')}</p><small>Consulta atendida · ${formatDate(r.created_at)}</small></div>`).join('') : '<p class="mx64-empty">Todavía no hay reseñas. No mostramos calificaciones inventadas.</p>'}`}
  </div></div>`;
}

function slotsByDay(slots) {
  const map = new Map();
  for (const s of slots) { const d = s.start_at.slice(0, 10); if (!map.has(d)) map.set(d, []); map.get(d).push(s); }
  return map;
}

export default {
  doctors: {
    role: 'PATIENT',
    async render(ctx) {
      const f = ctx.ui.dir || (ctx.ui.dir = { q: '', specialty: 'Todas', maxPrice: '', city: '' });
      const qs = new URLSearchParams({ ...(f.q && { q: f.q }), ...(f.specialty !== 'Todas' && { specialty: f.specialty }), ...(f.maxPrice && { maxPrice: f.maxPrice }), ...(f.city && { city: f.city }) });
      const [list, specialties] = await Promise.all([ctx.api.get('/professionals?' + qs), ctx.api.get('/professionals/specialties')]);
      return `<section><div class="badge">Directorio médico</div><h2>Encuentra al especialista ideal</h2><p class="muted">Solo mostramos profesionales con credenciales verificadas por MEXIA y perfil publicado.</p>
        <form class="med-search" id="med-search"><span>⌕</span><input id="med-query" name="q" aria-label="Buscar médico o especialidad" placeholder="Especialidad o nombre..." value="${esc(f.q)}"></form>
        <div class="med-cats" aria-label="Especialidades">${['Todas', ...specialties].map((x) => `<button class="med-chip ${f.specialty === x ? 'active' : ''}" data-med-category="${esc(x)}">${esc(x)}</button>`).join('')}</div>
        <div class="med-filters"><input class="input" id="med-city" placeholder="Ciudad" value="${esc(f.city)}" aria-label="Ciudad"><select class="select" id="med-price" aria-label="Precio máximo"><option value="">Cualquier precio</option>${[500, 700, 1000].map((p) => `<option value="${p}" ${String(f.maxPrice) === String(p) ? 'selected' : ''}>Hasta $${p.toLocaleString('es-MX')}</option>`).join('')}</select><button class="button" id="med-reset">Limpiar filtros</button></div>
        <button class="button primary full" data-go="myDoctors" style="margin:10px 0">♡ Mis médicos de confianza</button>
        <button class="button full" data-go="appointments" style="margin:10px 0">📅 Mis citas</button>
        <div class="small muted">${list.length} profesional(es) verificados</div>
        <div class="med-list">${list.map((d) => `<article class="med-card"><div class="med-card-top"><div class="med-avatar">🩺</div><div><strong>${esc(d.displayName)}</strong><div class="small muted">${esc(d.specialty)}</div><div class="small"><span class="med-rating">${d.rating ? '★ ' + d.rating : 'Sin calificaciones'}</span> · ${d.reviewCount} reseña(s)</div></div></div><div class="med-meta"><span>${money(d.price)}</span><span>${esc(d.city || '')}</span><span>${esc(d.modeLabel)}</span></div><div class="small muted">✓ Credenciales verificadas</div><button class="button primary full" data-go="doctorProfile" data-id="${d.id}" style="margin-top:13px">Ver perfil, reseñas y horarios →</button></article>`).join('')
          || '<div class="med-empty">Aún no hay especialistas verificados con esos filtros. Prueba otra especialidad o ciudad.</div>'}</div>
        ${nav('home', null)}</section>`;
    },
    mount(root, ctx) {
      const f = ctx.ui.dir;
      root.querySelector('#med-search').addEventListener('submit', (e) => { e.preventDefault(); f.q = root.querySelector('#med-query').value.trim(); ctx.render(); });
      root.querySelector('#med-query').addEventListener('change', (e) => { f.q = e.target.value.trim(); ctx.render(); });
      root.querySelector('#med-city').addEventListener('change', (e) => { f.city = e.target.value.trim(); ctx.render(); });
      root.querySelector('#med-price').addEventListener('change', (e) => { f.maxPrice = e.target.value; ctx.render(); });
      root.querySelectorAll('[data-med-category]').forEach((b) => b.addEventListener('click', () => { f.specialty = b.dataset.medCategory; ctx.render(); }));
      root.querySelector('#med-reset').addEventListener('click', () => { Object.assign(f, { q: '', specialty: 'Todas', maxPrice: '', city: '' }); ctx.render(); });
    },
  },

  doctorProfile: {
    role: 'PATIENT',
    async render(ctx) {
      const id = ctx.params.id;
      const tab = ctx.ui.patientProfileTab || 'galeria';
      let d;
      try { d = await ctx.api.get(`/professionals/${id}`); } catch (e) {
        if (e.status === 404) return `<section><div class="badge">Perfil médico</div><h2>Perfil no disponible</h2><div class="card">Este profesional ya no está disponible en el directorio (retirado o en revisión).</div>${nav('doctors', null)}</section>`;
        throw e;
      }
      const from = ctx.ui.slotFrom || localISO();
      const [av, trusted] = await Promise.all([ctx.api.get(`/professionals/${id}/availability?from=${from}&to=${addDaysISO(from, 13)}`), ctx.api.get('/me/trusted-doctors')]);
      const saved = trusted.find((t) => String(t.professional_id) === String(id));
      const days = slotsByDay(av.slots);
      const sel = ctx.ui.selectedSlot;
      return `<section class="mx65-patient-profile"><div class="badge">Perfil público médico</div><div class="mx64-profile"><div class="mx64-layout"><div>${publicCard(d, tab)}
        <div class="card med-profile-section" style="margin-top:14px"><button class="button full" data-trust="${saved ? 'remove:' + saved.id : 'add'}">${saved ? '♡ Quitar de mis médicos' : '♡ Guardar en mis médicos'}</button><p class="small muted">Guardar como favorito no comparte datos médicos.</p></div></div>
        <aside><div class="mx64-card mx64-book"><h3>Agenda una consulta</h3><p class="mx49-mini">${esc(d.city || 'Ubicación por definir')} · ${esc(d.modeLabel)}</p><p><strong>${money(d.price)}</strong> por consulta · ${d.duration} min</p>
          <div class="actions" style="margin:6px 0"><button class="button" data-slot-move="-14" ${from <= localISO() ? 'disabled' : ''}>‹ Anteriores</button><button class="button" data-slot-move="14">Siguientes ›</button></div>
          ${days.size ? (() => {
            const dayKeys = [...days.keys()];
            const cur = days.has(ctx.ui.slotDay) ? ctx.ui.slotDay : dayKeys[0];
            return `<div class="med-slots" role="group" aria-label="Elige un día">${dayKeys.map((d) => `<button class="med-slot ${d === cur ? 'active' : ''}" data-slot-day="${d}">${formatDate(d, { weekday: true }).split(' de ').slice(0, 2).join(' ')}</button>`).join('')}</div>
              <p class="mx49-mini" style="margin:12px 0 4px"><strong>${formatDate(cur, { weekday: true })}</strong></p>
              <div class="med-slots">${days.get(cur).map((s) => `<button class="med-slot ${sel === s.start_at ? 'active' : ''}" data-slot="${esc(s.start_at)}">${hhmm(s.start_at)}</button>`).join('')}</div>`;
          })() : '<p class="mx64-empty">No hay horarios disponibles en estas dos semanas.</p>'}
          <button class="button primary full" data-request style="margin-top:15px" ${sel ? '' : 'disabled'}>Solicitar cita${sel ? ' · ' + hhmm(sel) : ''}</button>
          <p class="mx49-mini">Horario del consultorio (${esc(av.timezone)}). El médico confirmará tu solicitud.</p></div></aside></div></div>
        <button class="button full" data-go="appointments" style="margin-top:12px">Mis citas</button>${nav('doctors', null)}</section>`;
    },
    mount(root, ctx) {
      const id = ctx.params.id;
      root.querySelectorAll('[data-profile-tab]').forEach((b) => b.addEventListener('click', () => { ctx.ui.patientProfileTab = b.dataset.profileTab; ctx.render(); }));
      root.querySelectorAll('[data-slot-day]').forEach((b) => b.addEventListener('click', () => { ctx.ui.slotDay = b.dataset.slotDay; ctx.render(); }));
      root.querySelectorAll('[data-slot]').forEach((b) => b.addEventListener('click', () => { ctx.ui.selectedSlot = b.dataset.slot; ctx.render(); }));
      root.querySelectorAll('[data-slot-move]').forEach((b) => b.addEventListener('click', () => {
        const next = addDaysISO(ctx.ui.slotFrom || localISO(), Number(b.dataset.slotMove));
        ctx.ui.slotFrom = next < localISO() ? localISO() : next; ctx.render();
      }));
      root.querySelector('[data-request]')?.addEventListener('click', () => {
        ctx.ui.booking = { professional_id: id, start_at: ctx.ui.selectedSlot, key: idemKey() };
        ctx.go('appointmentConfirm');
      });
      root.querySelector('[data-trust]')?.addEventListener('click', async (e) => {
        const v = e.currentTarget.dataset.trust;
        try {
          if (v === 'add') await ctx.api.post('/me/trusted-doctors', { professional_id: id });
          else await ctx.api.del(`/me/trusted-doctors/${v.split(':')[1]}`);
          ctx.render();
        } catch (err) { toastError(err); }
      });
    },
  },

  appointmentConfirm: {
    role: 'PATIENT',
    async render(ctx) {
      const b = ctx.ui.booking;
      if (!b) return `<section><h2>No hay una solicitud seleccionada</h2>${nav('doctors', null)}</section>`;
      const [d, episodes] = await Promise.all([ctx.api.get(`/professionals/${b.professional_id}`), ctx.api.get('/episodes')]);
      const modes = d.mode === 'AMBAS' ? ['PRESENCIAL', 'EN_LINEA'] : [d.mode];
      return `<section><div class="badge">Citas médicas</div><h2>Confirma tu solicitud</h2><p class="muted">Elige un episodio relacionado y decide si deseas compartirlo con este médico.</p>
        <form class="card" id="confirm-form"><h3>${esc(d.displayName)}</h3><p class="muted">${esc(d.specialty)} · ${money(d.price)} · ${d.duration} min</p>
          <p><strong>${formatDateTime(b.start_at)}</strong></p>
          <div class="field"><label for="appt-mode">Modalidad</label><select id="appt-mode" name="mode" class="select">${modes.map((m) => `<option value="${m}">${m === 'EN_LINEA' ? 'En línea' : 'Presencial'}</option>`).join('')}</select></div>
          <div class="field"><label for="appt-episode">Episodio para esta consulta</label><select id="appt-episode" name="episode_id" class="select"><option value="">Sin episodio · No compartir información</option>${episodes.filter((e) => e.status === 'ACTIVE').map((e) => `<option value="${e.id}">${esc(e.title)}</option>`).join('')}</select><p class="small muted">Elige solo el episodio relacionado. No es necesario enviar todo tu expediente.</p></div>
          <div id="share-controls" class="card" hidden><h3>Privacidad de este episodio</h3><label style="display:flex;align-items:flex-start;gap:10px"><input name="share_episode" type="checkbox"><span>Autorizo compartir el resumen de este episodio con este médico hasta 7 días después de la consulta.</span></label><p class="small muted">Puedes revocarlo en cualquier momento desde Privacidad.</p></div>
          <div class="field"><label for="appt-reason">Motivo de consulta (opcional)</label><textarea id="appt-reason" name="reason" class="textarea" rows="3" maxlength="1000" placeholder="Describe brevemente el motivo"></textarea></div>
          <button class="button primary full" type="submit" style="margin-top:18px">Solicitar cita</button></form>
        ${nav(`doctorProfile/${b.professional_id}`, null)}</section>`.replace(`data-go="doctorProfile/${b.professional_id}"`, `data-go="doctorProfile" data-id="${b.professional_id}"`);
    },
    mount(root, ctx) {
      const form = root.querySelector('#confirm-form');
      if (!form) return;
      const ep = form.querySelector('#appt-episode');
      ep.addEventListener('change', () => { form.querySelector('#share-controls').hidden = !ep.value; });
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        busy(form.querySelector('[type=submit]'), async () => {
          const b = ctx.ui.booking;
          try {
            const appt = await ctx.api.post('/appointments', { ...readForm(form), professional_id: b.professional_id, start_at: b.start_at, idempotency_key: b.key });
            ctx.ui.booking = null; ctx.ui.selectedSlot = null;
            toast('Solicitud enviada al médico');
            ctx.go('appointment', { id: appt.id });
          } catch (err) {
            toastError(err);
            if (['SLOT_TAKEN', 'SLOT_INVALID', 'SLOT_BLOCKED'].includes(err.code)) { ctx.ui.selectedSlot = null; ctx.go('doctorProfile', { id: b.professional_id }); }
          }
        });
      });
    },
  },

  appointments: {
    role: 'PATIENT',
    async render(ctx) {
      const list = await ctx.api.get('/appointments');
      const now = localISO();
      const upcoming = list.filter((a) => ['REQUESTED', 'CONFIRMED'].includes(a.status) && a.start_at.slice(0, 10) >= now).reverse();
      const past = list.filter((a) => !upcoming.includes(a));
      const card = (a) => `<article class="card" style="margin-top:12px"><div class="item-top"><div><strong>🩺 ${esc(a.professional_name)}</strong><div class="small muted">${esc(a.specialty)} · ${formatDateTime(a.start_at)}</div></div>${statusChip(a.status)}</div><p class="small muted">${money(a.price_mxn)} · ${a.mode === 'EN_LINEA' ? 'En línea' : 'Presencial'}${a.episode_title ? ` · 📋 ${esc(a.episode_title)}${a.shared ? ' (compartido)' : ''}` : ''}</p><div class="actions"><button class="button" data-go="appointment" data-id="${a.id}">Ver detalle</button></div></article>`;
      return `<section><div class="badge">Mis citas</div><h2>Consultas y citas</h2><p class="muted">Las citas activas aparecen también en tu calendario. El estado se actualiza cuando el médico responde.</p>
        <div class="actions"><button class="button primary" data-go="myDoctors">♡ Mis médicos</button><button class="button" data-go="doctors">+ Buscar especialista</button><button class="button" data-go="calendar">Ver calendario</button></div>
        <h3 style="margin-top:24px">Próximas citas (${upcoming.length})</h3>${upcoming.map(card).join('') || '<div class="card muted">Aún no tienes citas próximas. Busca un especialista para empezar.</div>'}
        ${past.length ? `<h3 style="margin-top:24px">Historial</h3>${past.map(card).join('')}` : ''}
        ${nav('home', null)}</section>`;
    },
  },

  appointment: {
    role: 'ANY',
    async render(ctx) {
      const a = await ctx.api.get(`/appointments/${ctx.params.id}`);
      const isPatient = ctx.session.user.role === 'PATIENT';
      const chatOpen = ['CONFIRMED', 'COMPLETED'].includes(a.status);
      const messages = chatOpen ? await ctx.api.get(`/appointments/${a.id}/messages`) : [];
      const canCancel = ['REQUESTED', 'CONFIRMED'].includes(a.status);
      return `<section><div class="badge">Comprobante de cita</div><h2>${isPatient ? esc(a.professional_name) : esc(a.patient_name)}</h2>
        <div class="card"><div class="item-top"><strong>${formatDateTime(a.start_at)}</strong>${statusChip(a.status)}</div>
          <p class="small muted">Folio MX-${String(a.id).padStart(6, '0')} · ${esc(a.specialty || '')} · ${money(a.price_mxn)} · ${a.mode === 'EN_LINEA' ? 'En línea' : 'Presencial'}</p>
          ${a.address && a.mode !== 'EN_LINEA' ? `<p class="small">📍 ${esc(a.address)}</p>` : ''}
          ${a.reason ? `<p class="small"><strong>Motivo:</strong> ${esc(a.reason)}</p>` : ''}
          ${isPatient && a.episode_title ? `<p class="small">📋 Episodio: <button class="mx-link" data-go="episode" data-id="${a.episode_id}">${esc(a.episode_title)}</button> · ${a.shared ? 'compartido con el médico' : 'no compartido'}</p>` : ''}
          ${a.status_reason ? `<p class="small muted">Nota: ${esc(a.status_reason)}</p>` : ''}
          <div class="actions">${canCancel ? '<button class="button danger" data-cancel>Cancelar cita</button>' : ''}<button class="button" data-print>Imprimir comprobante</button></div>
          <p class="small muted">Para reprogramar, cancela esta cita y elige un nuevo horario; así el hueco se libera para otros pacientes.</p></div>
        <div class="mx63-panel" style="margin-top:14px"><h3>Mensajes</h3>
          ${chatOpen ? `<p class="mx49-mini">Los mensajes no sustituyen una consulta ni atienden urgencias. En una emergencia llama al 911.</p>
            <div class="mx63-chat-log">${messages.map((m) => `<div class="mx63-chat-bubble ${m.mine ? 'mxa-mine' : ''}"><small>${m.mine ? 'Tú' : m.author_role === 'DOCTOR' ? 'Médico' : 'Paciente'} · ${formatDate(m.created_at)} ${esc(String(m.created_at).slice(11, 16))}</small><p>${esc(m.body)}</p></div>`).join('') || '<p class="mx49-mini">Todavía no hay mensajes.</p>'}</div>
            <form id="msg-form"><label for="msg-body">Mensaje</label><textarea id="msg-body" name="body" class="textarea" rows="2" maxlength="2000" required></textarea><button class="button primary" type="submit" style="margin-top:8px">Enviar</button></form>`
            : '<p class="mx49-mini">Los mensajes se habilitan cuando el médico confirma la cita.</p>'}
        </div>
        ${isPatient && a.status === 'COMPLETED' ? (a.reviewed ? '<div class="card" style="margin-top:14px">✓ Gracias por tu reseña. Se publicará tras moderación.</div>' : `<form class="card" id="review-form" style="margin-top:14px"><h3>¿Cómo fue tu consulta?</h3><div class="field"><label for="rv-rating">Calificación</label><select id="rv-rating" name="rating" class="select">${[5, 4, 3, 2, 1].map((n) => `<option value="${n}">${'★'.repeat(n)}</option>`).join('')}</select></div><div class="field"><label for="rv-body">Comentario (opcional)</label><textarea id="rv-body" name="body" class="textarea" rows="3" maxlength="1000"></textarea></div><button class="button primary full" type="submit">Enviar reseña</button></form>`) : ''}
        ${nav(isPatient ? 'appointments' : 'portal', null)}</section>`;
    },
    mount(root, ctx) {
      const id = ctx.params.id;
      root.querySelector('[data-print]').addEventListener('click', () => window.print());
      root.querySelector('[data-cancel]')?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
        if (!confirm('¿Cancelar esta cita? El horario quedará libre para otros pacientes.')) return;
        try {
          const a = await ctx.api.get(`/appointments/${id}`);
          await ctx.api.patch(`/appointments/${id}/status`, { status: 'CANCELLED', version: a.version });
          toast('Cita cancelada'); ctx.render();
        } catch (err) { toastError(err); }
      }));
      const msg = root.querySelector('#msg-form');
      msg?.addEventListener('submit', (e) => {
        e.preventDefault();
        busy(msg.querySelector('[type=submit]'), async () => {
          try { await ctx.api.post(`/appointments/${id}/messages`, readForm(msg)); ctx.render(); } catch (err) { toastError(err); }
        });
      });
      const rv = root.querySelector('#review-form');
      rv?.addEventListener('submit', (e) => {
        e.preventDefault();
        busy(rv.querySelector('[type=submit]'), async () => {
          try { await ctx.api.post(`/appointments/${id}/review`, readForm(rv)); toast('Reseña enviada'); ctx.render(); } catch (err) { toastError(err); }
        });
      });
    },
  },

  myDoctors: {
    role: 'PATIENT',
    async render(ctx) {
      const tab = ctx.ui.doctorsTab || 'guardados';
      const [trusted, appts] = await Promise.all([ctx.api.get('/me/trusted-doctors'), ctx.api.get('/appointments')]);
      const history = appts.filter((a) => a.status === 'COMPLETED');
      return `<section class="trusted-doctors"><div class="badge">Tu equipo de salud</div><h2>Mis médicos de confianza</h2><p class="muted">Guarda a los profesionales que deseas volver a consultar. Solo tú decides quién aparece aquí.</p>
        <div class="trusted-tabs" role="group" aria-label="Secciones de mis médicos"><button class="${tab === 'guardados' ? 'active' : ''}" data-trust-tab="guardados">♡ Guardados</button><button class="${tab === 'historial' ? 'active' : ''}" data-trust-tab="historial">Historial</button><button data-go="doctors">Explorar</button></div>
        ${tab === 'guardados' ? `<h3>Profesionales que guardaste (${trusted.length})</h3>
          ${trusted.map((t) => `<article class="card"><div class="item-top"><div><strong>${esc(t.name || 'Profesional')}</strong><div class="small muted">${esc(t.specialty || '')}${t.contact ? ' · ' + esc(t.contact) : ''}</div></div><span class="mxa-chip mxa-chip--${t.professional_id ? (t.verification_status === 'VERIFIED' ? 'ok' : 'warn') : 'off'}">${t.professional_id ? (t.verification_status === 'VERIFIED' ? 'En MEXIA · verificado' : 'En MEXIA') : 'Agregado por ti'}</span></div><div class="actions">${t.professional_id ? `<button class="button primary" data-go="doctorProfile" data-id="${t.professional_id}">Ver perfil y agendar</button>` : ''}<button class="button" data-trust-del="${t.id}">Quitar</button></div></article>`).join('') || '<div class="card"><strong>Aún no has guardado médicos</strong><p class="small muted">Puedes agregar al médico que ya conoces, aunque todavía no forme parte de MEXIA.</p></div>'}
          <form class="card" id="trust-form"><h3>+ Agregar un médico que conozco</h3><p class="small muted">Los datos los introduces tú. MEXIA no verifica identidad, especialidad ni disponibilidad de médicos externos.</p><div class="field"><label for="trust-name">Nombre del profesional</label><input class="input" id="trust-name" name="name" maxlength="100" required placeholder="Ej. Dra. Ana Martínez"></div><div class="field"><label for="trust-specialty">Especialidad</label><input class="input" id="trust-specialty" name="specialty" maxlength="90" placeholder="Ej. Medicina general"></div><div class="field"><label for="trust-contact">Contacto (opcional)</label><input class="input" id="trust-contact" name="contact" maxlength="120" placeholder="Teléfono o medio de contacto"></div><button class="button primary full" type="submit">Guardar médico</button></form>`
        : `<h3>Consultas atendidas</h3>${history.map((a) => `<article class="card"><strong>${esc(a.professional_name)}</strong><p class="small muted">${esc(a.specialty)} · ${formatDateTime(a.start_at)}</p><button class="button" data-go="appointment" data-id="${a.id}">Ver detalle</button></article>`).join('') || '<div class="card muted">Aún no tienes consultas atendidas.</div>'}`}
        ${bottomNav('myDoctors')}</section>`;
    },
    mount(root, ctx) {
      root.querySelectorAll('[data-trust-tab]').forEach((b) => b.addEventListener('click', () => { ctx.ui.doctorsTab = b.dataset.trustTab; ctx.render(); }));
      root.querySelectorAll('[data-trust-del]').forEach((b) => b.addEventListener('click', async () => {
        try { await ctx.api.del(`/me/trusted-doctors/${b.dataset.trustDel}`); ctx.render(); } catch (e) { toastError(e); }
      }));
      const form = root.querySelector('#trust-form');
      form?.addEventListener('submit', (e) => {
        e.preventDefault();
        busy(form.querySelector('[type=submit]'), async () => {
          try { await ctx.api.post('/me/trusted-doctors', readForm(form)); toast('Médico guardado'); ctx.render(); } catch (err) { toastError(err); }
        });
      });
    },
  },
};
