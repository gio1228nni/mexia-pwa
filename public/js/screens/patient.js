// Inicio del paciente, Mi salud (expediente), documentos, pulso diario, privacidad y emergencia.
import { esc, nav, localISO, formatDate, calSticker, face, PULSE_LABEL, toast, toastError, readForm, busy } from '../ui.js';

const bottomNav = (active) => `<nav class="bottom-nav" aria-label="Navegación principal">
  <button class="nav-btn ${active === 'home' ? 'active' : ''}" data-go="home"><span>⌂</span>Inicio</button>
  <button class="nav-btn ${active === 'myHealth' ? 'active' : ''}" data-go="myHealth"><span>♡</span>Mi salud</button>
  <button class="nav-btn ${active === 'calendar' ? 'active' : ''}" data-go="calendar"><span>▦</span>Agenda</button>
  <button class="nav-btn ${active === 'myDoctors' ? 'active' : ''}" data-go="myDoctors"><span>✚</span>Mis médicos</button>
</nav>`;
export { bottomNav };

async function savePulse(ctx, value) {
  try {
    await ctx.api.put('/me/pulse', { value, date: localISO() });
    toast(`Registrado: ${PULSE_LABEL[value]}`);
    ctx.render();
  } catch (e) { toastError(e); }
}

const pulseButtons = (selected, cls = 'mx45-pulse-option') => ['bien', 'regular', 'mal'].map((v) =>
  `<button type="button" class="${cls} ${selected === v ? 'chosen' : ''}" data-pulse-answer="${v}" aria-pressed="${selected === v}" aria-label="Me siento ${PULSE_LABEL[v].toLowerCase()}">${face(v)}<span>${PULSE_LABEL[v]}</span></button>`).join('');

export default {
  home: {
    role: 'PATIENT',
    async render(ctx) {
      const today = localISO();
      const [dash, events] = await Promise.all([
        ctx.api.get(`/me/dashboard?today=${today}`),
        ctx.api.get(`/calendar?from=${today}&to=${today}`),
      ]);
      const p = ctx.session.profile || {};
      const name = ctx.session.user.name;
      const first = esc(p.preferred_name || name.split(' ')[0]);
      return `<section>
        <div class="home-shell">
          <div class="home-top">
            <div class="home-user"><div class="avatar">${esc(name.trim().charAt(0).toUpperCase())}</div>
              <div><div class="hello">Hola 👋</div><div class="home-name">${esc(name)}</div></div></div>
            <button class="round-action" data-go="calendar" aria-label="Mi agenda">🔔</button>
          </div>
          <h2 class="home-question">¿Cómo puedo acompañarte hoy, ${first}?</h2>
          <div class="assistant-grid">
            <div class="assistant-card">
              <div class="orb" data-ai-state="idle" role="img" aria-label="Esfera de MEXIA en reposo"></div>
              <strong>Cuéntale a MEXIA</strong>
              <p>Dime cómo te sientes. Organizaremos la información en un nuevo episodio de salud.</p>
              <button class="start-button" data-go="newEpisode">✦ Comenzar</button>
            </div>
            <div class="quick-stack">
              <button class="quick-card" data-go="newEpisode"><div class="quick-icon">✚</div><strong>Nuevo episodio</strong><p>Registra uno o varios síntomas.</p></button>
              <button class="quick-card green" data-go="myHealth"><div class="quick-icon">▤</div><strong>Mi salud</strong><p>Expediente, documentos y privacidad.</p></button>
            </div>
          </div>
          ${!dash.pulseToday ? `<section class="mx45-pulse" aria-label="Registro de bienestar de hoy">
            <div class="mx45-pulse-heading"><div><h3>¿Cómo te sientes hoy?</h3><p>Un momento para ti</p></div><span class="mx45-heart" aria-hidden="true">♡</span></div>
            <div class="mx45-pulse-options" role="group" aria-label="Registrar cómo te sientes hoy">${pulseButtons(null)}</div>
          </section>` : ''}
          <div class="mx42-section-head"><h3>Tu día en MEXIA</h3><button class="mx42-text-action" data-go="calendar">Ver calendario →</button></div>
          <div class="mx42-agenda">
            ${events.slice(0, 4).map((e) => `<button class="mx42-agenda-item" data-go="calendar">${calSticker(e)}<span class="mx42-agenda-copy"><strong>${esc(e.title)}</strong><small>${esc(e.time || 'Sin hora')} · ${esc(e.status)}</small></span><span class="mx42-chevron">›</span></button>`).join('')
              || '<div class="mx42-empty"><span>✓</span><div><strong>Hoy no tienes actividades programadas</strong><p>Consulta tu agenda o agrega una actividad cuando la necesites.</p></div><button class="mini-button" data-go="calendarEvent">Agregar</button></div>'}
            <div class="mx42-agenda-bottom"><span>${events.length} actividad(es) para hoy</span><button class="mx42-text-action" data-go="calendar">Mi agenda →</button></div>
          </div>
          <div class="home-section-title">Resumen de salud</div>
          <div class="dashboard-grid">
            <button class="dash-card" data-go="episodes"><strong>${dash.activeEpisodes}</strong><span>Episodios activos</span></button>
            <button class="dash-card" data-go="appointments"><strong>${dash.upcomingAppointments}</strong><span>Citas próximas</span></button>
            <button class="dash-card" data-go="medicationTracker"><strong>${p.current_medications ? 'Registrado' : 'Pendiente'}</strong><span>Medicamentos actuales</span></button>
            <button class="dash-card" data-go="documents"><strong>${dash.documents}</strong><span>Documentos</span></button>
          </div>
          <div class="urgent-card"><strong>¿Necesitas ayuda urgente?</strong><div class="small muted" style="margin-top:5px">Accede a información de emergencia y a tu contacto registrado.</div><button class="mini-button" data-go="emergency" style="margin-top:10px">Abrir ayuda urgente</button></div>
          <div class="home-section-title">Accesos rápidos</div>
          <div class="home-tools">
            <button class="tool-card" data-go="episodes"><span>📍</span>Episodios</button>
            <button class="tool-card" data-go="medicationTracker"><span>💊</span>Medicamentos</button>
            <button class="tool-card" data-go="doctors"><span>🩺</span>Consultas</button>
            <button class="tool-card" data-go="dailyPulse"><span>♡</span>Pulso diario</button>
          </div>
          <div class="card" style="margin-top:14px;background:rgba(255,255,255,.78)">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap"><strong>Perfil de salud</strong><button type="button" class="mini-button" data-reading aria-pressed="${!!p.easy_reading}">${p.easy_reading ? '✓ Lectura fácil' : 'Aa Lectura fácil'}</button></div>
            <p class="small muted">Alergias: ${esc(p.allergies || 'No registradas')}<br>Medicamentos actuales: ${esc(p.current_medications || 'No registrados')}</p>
            <button class="mini-button" data-go="profile">Editar perfil de salud</button>
          </div>
        </div>
        ${bottomNav('home')}
      </section>`;
    },
    mount(root, ctx) {
      root.querySelectorAll('[data-pulse-answer]').forEach((b) => b.addEventListener('click', () => savePulse(ctx, b.dataset.pulseAnswer)));
      root.querySelector('[data-reading]').addEventListener('click', async () => {
        try { ctx.session.profile = await ctx.api.patch('/me/profile', { easy_reading: !ctx.session.profile.easy_reading }); ctx.render(); } catch (e) { toastError(e); }
      });
    },
  },

  myHealth: {
    role: 'PATIENT',
    async render(ctx) {
      const [episodes, docs] = await Promise.all([ctx.api.get('/episodes'), ctx.api.get('/documents')]);
      const p = ctx.session.profile || {};
      const active = episodes.find((e) => e.status === 'ACTIVE');
      return `<section class="mh-simplified" aria-labelledby="mh-title">
        <div class="mh-heading"><div><div class="badge">MI ESPACIO PERSONAL</div><h2 id="mh-title">Mi Salud</h2><p class="muted">Tu información médica, siempre organizada.</p></div><div class="mh-heart" aria-hidden="true">♡</div></div>
        <section class="mh-followup" aria-label="Tu seguimiento de salud">
          <div class="mh-top"><strong>Tu seguimiento de salud</strong><span class="mh-status">${active ? 'En seguimiento' : episodes.length ? 'Registrado' : 'Por comenzar'}</span></div>
          <p>${active ? 'Continúa donde te quedaste y consulta tu evolución.' : episodes.length ? 'Consulta tus episodios y el historial de tu atención.' : 'Registra cómo te sientes para empezar tu seguimiento.'}</p>
          <button class="mh-feature" type="button" ${active ? `data-go="episode" data-id="${active.id}"` : 'data-go="newEpisode"'}><span class="mh-feature-icon" aria-hidden="true">♡</span><span><strong>${active ? esc(active.title) : 'Comenzar mi seguimiento'}</strong><small>${active ? `${active.symptom_count} síntoma(s) · Ver seguimiento` : 'Registrar mi primer síntoma'}</small></span><span aria-hidden="true">›</span></button>
        </section>
        <div class="mh-label">TU INFORMACIÓN</div>
        <div class="mh-grid">
          <button type="button" class="mh-tile" data-mh-details><span class="mh-tile-icon blue" aria-hidden="true">▤</span><strong>Mi expediente</strong><small>Antecedentes y datos esenciales</small></button>
          <button type="button" class="mh-tile" data-go="medicationTracker"><span class="mh-tile-icon green" aria-hidden="true">✚</span><strong>Medicamentos</strong><small>Tratamientos y tomas</small></button>
          <button type="button" class="mh-tile" data-go="documents"><span class="mh-tile-icon blue" aria-hidden="true">▧</span><strong>Mis estudios</strong><small>${docs.length ? `${docs.length} documento(s)` : 'Documentos y resultados'}</small></button>
          <button type="button" class="mh-tile" data-go="episodes"><span class="mh-tile-icon green" aria-hidden="true">↗</span><strong>Mis episodios</strong><small>${episodes.length} registrado(s)</small></button>
        </div>
        <button type="button" class="mh-privacy" data-go="privacy"><span class="mh-privacy-icon" aria-hidden="true">♧</span><span><strong>Privacidad y permisos</strong><small>Controla quién accede a tu información</small></span><span aria-hidden="true">›</span></button>
        <div class="mh-more"><button type="button" data-mh-more aria-expanded="false" aria-controls="mh-extra">Más opciones de salud <span aria-hidden="true">⌄</span></button><div id="mh-extra" hidden><button class="mh-mini" data-go="dailyPulse">Pulso diario</button><button class="mh-mini" data-go="appointments">Mis citas</button><button class="mh-mini" data-go="emergency">Emergencia</button><button class="mh-mini" data-go="profile">Perfil de salud</button></div></div>
        <form class="mh-essential" id="mh-essential" hidden>
          <h3>Mi expediente personal</h3><p class="muted small">Registra o actualiza tus datos esenciales.</p>
          <div class="field"><label for="bloodType">Grupo sanguíneo</label><select id="bloodType" name="blood_type" class="select"><option value="">No lo sé / No registrado</option>${['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((x) => `<option ${p.blood_type === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
          <div class="field"><label for="allergies2">Alergias</label><input id="allergies2" name="allergies" class="input" maxlength="500" value="${esc(p.allergies)}"></div>
          <div class="field"><label for="meds2">Medicamentos actuales</label><input id="meds2" name="current_medications" class="input" maxlength="500" value="${esc(p.current_medications)}"></div>
          <div class="field"><label for="conditions2">Antecedentes</label><textarea id="conditions2" name="conditions" class="textarea" rows="3" maxlength="4000">${esc(p.conditions)}</textarea></div>
          <div class="field"><label for="surgeries">Cirugías / procedimientos</label><input id="surgeries" name="surgeries" class="input" maxlength="500" value="${esc(p.surgeries)}" placeholder="Opcional"></div>
          <div class="field"><label for="vaccines">Vacunas relevantes</label><input id="vaccines" name="vaccines" class="input" maxlength="500" value="${esc(p.vaccines)}" placeholder="Opcional"></div>
          <div class="field"><label for="emergencyContact">Contacto de emergencia</label><input id="emergencyContact" name="emergency_contact" class="input" maxlength="200" value="${esc(p.emergency_contact)}" placeholder="Nombre y teléfono"></div>
          <button class="button primary full" type="submit" style="margin-top:14px">Guardar datos</button>
          <button class="button full" type="button" data-mh-close style="margin-top:9px">Cerrar expediente</button>
        </form>
        <p class="mh-disclaimer">MEXIA organiza tu información y no sustituye una consulta médica.</p>
        ${bottomNav('myHealth')}
      </section>`;
    },
    mount(root, ctx) {
      const form = root.querySelector('#mh-essential');
      root.querySelector('[data-mh-details]').addEventListener('click', () => { form.hidden = false; form.scrollIntoView({ behavior: 'smooth' }); });
      root.querySelector('[data-mh-close]').addEventListener('click', () => { form.hidden = true; });
      root.querySelector('[data-mh-more]').addEventListener('click', (e) => {
        const box = root.querySelector('#mh-extra'); box.hidden = !box.hidden; e.currentTarget.setAttribute('aria-expanded', String(!box.hidden));
      });
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        busy(form.querySelector('[type=submit]'), async () => {
          try { ctx.session.profile = await ctx.api.patch('/me/profile', readForm(form)); toast('Expediente guardado'); } catch (err) { toastError(err); }
        });
      });
    },
  },

  documents: {
    role: 'PATIENT',
    async render(ctx) {
      const [docs, episodes] = await Promise.all([ctx.api.get('/documents'), ctx.api.get('/episodes')]);
      const filter = ctx.ui.documentFilter || 'Todos';
      const types = ['Laboratorio', 'Receta', 'Imagen / estudio', 'Nota médica', 'Otro'];
      return `<section><div class="badge">Documentos</div><h2>Estudios y archivos médicos</h2><p class="muted">Tus archivos se guardan en almacenamiento privado. Solo tú puedes abrirlos.</p>
        <form class="doc-drop" id="doc-form"><div style="font-size:32px">☁</div><strong>Subir documento</strong><p class="small muted">PDF, JPG, PNG o WEBP · máximo 8 MB.</p>
          <input id="doc-file" name="file" type="file" accept=".pdf,image/jpeg,image/png,image/webp" class="input" required>
          <input name="title" class="input" maxlength="200" placeholder="Título (opcional)" style="margin-top:9px">
          <select name="doc_type" class="select" style="margin-top:9px">${types.map((t) => `<option>${t}</option>`).join('')}</select>
          <input name="doc_date" type="date" class="input" style="margin-top:9px" aria-label="Fecha del estudio">
          <select name="episode_id" class="select" style="margin-top:9px"><option value="">Sin episodio vinculado</option>${episodes.map((e) => `<option value="${e.id}">${esc(e.title)}</option>`).join('')}</select>
          <button class="button primary full" type="submit" style="margin-top:9px">Subir documento</button></form>
        <div class="field"><label for="doc-filter">Filtrar documentos</label><select id="doc-filter" class="select">${['Todos', ...types].map((t) => `<option ${filter === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        ${docs.filter((d) => filter === 'Todos' || d.doc_type === filter).map((d) => `<div class="doc-item"><div><strong>${esc(d.title)}</strong><div class="small muted">${esc(d.doc_type)} · ${d.doc_date ? formatDate(d.doc_date) : formatDate(d.created_at)}</div>${d.has_file ? `<a class="source-tag" href="/api/documents/${d.id}/file" target="_blank" rel="noopener">Abrir archivo</a>` : ''}</div><button class="mini-button danger" data-delete-document="${d.id}">Eliminar</button></div>`).join('') || '<div class="card muted">Aún no tienes documentos.</div>'}
        ${nav('myHealth', null)}
      </section>`;
    },
    mount(root, ctx) {
      root.querySelector('#doc-filter').addEventListener('change', (e) => { ctx.ui.documentFilter = e.target.value; ctx.render(); });
      const form = root.querySelector('#doc-form');
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const file = form.querySelector('#doc-file').files[0];
        if (!file) return toast('Selecciona un archivo', 'error');
        if (file.size > 8 * 1024 * 1024) return toast('El archivo supera 8 MB', 'error');
        busy(form.querySelector('[type=submit]'), async () => {
          try { await ctx.api.upload('/documents', new FormData(form)); toast('Documento guardado'); ctx.render(); } catch (err) { toastError(err); }
        });
      });
      root.querySelectorAll('[data-delete-document]').forEach((b) => b.addEventListener('click', async () => {
        if (!confirm('¿Eliminar este documento de forma permanente?')) return;
        try { await ctx.api.del(`/documents/${b.dataset.deleteDocument}`); toast('Documento eliminado'); ctx.render(); } catch (e) { toastError(e); }
      }));
    },
  },

  dailyPulse: {
    role: 'PATIENT',
    async render(ctx) {
      const list = await ctx.api.get('/me/pulse');
      const today = list.find((x) => x.date === localISO());
      const p = ctx.session.profile || {};
      const counts = { bien: 0, regular: 0, mal: 0 };
      list.forEach((x) => { counts[x.value]++; });
      return `<section class="mx-pulse-screen"><div class="badge">MEXIA · Pulso Diario</div><h2>¿Cómo te sientes hoy?</h2><p class="muted">Un toque para llevar tu bienestar en orden. Puedes cambiar tu respuesta durante el día.</p>
        <div class="card"><div class="mx-pulse-choices">${pulseButtons(today?.value, 'mx-pulse-choice')}</div>${today ? `<p class="small" style="margin-top:14px">✓ Registro de hoy: <strong>${PULSE_LABEL[today.value]}</strong></p>` : ''}<p class="small muted">Este registro no es un diagnóstico ni sustituye una consulta médica.</p></div>
        <form class="card" id="pulse-settings" style="margin-top:12px"><h3>Recordatorio diario</h3><label class="mx-pulse-toggle"><input type="checkbox" name="daily_pulse_enabled" ${p.daily_pulse_enabled ? 'checked' : ''}> Quiero recibir la pregunta diariamente</label><div class="field"><label for="pulse-time">Hora preferida</label><input type="time" class="input" id="pulse-time" name="daily_pulse_time" value="${esc((p.daily_pulse_time || '20:00').slice(0, 5))}"></div><button class="button full" type="submit">Guardar preferencia</button></form>
        <div class="card" style="margin-top:12px"><h3>Tu historial de bienestar</h3><p class="small muted">${list.length} día(s) registrados · 😊 ${counts.bien} · 😐 ${counts.regular} · 😟 ${counts.mal}</p>${list.slice(0, 30).map((x) => `<div class="mx-pulse-history"><span>${formatDate(x.date)}</span><strong>${PULSE_LABEL[x.value]}</strong></div>`).join('') || '<p class="small muted">Todavía no hay registros.</p>'}</div>
        ${nav('home', null)}</section>`;
    },
    mount(root, ctx) {
      root.querySelectorAll('[data-pulse-answer]').forEach((b) => b.addEventListener('click', () => savePulse(ctx, b.dataset.pulseAnswer)));
      const form = root.querySelector('#pulse-settings');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        try { ctx.session.profile = await ctx.api.patch('/me/profile', readForm(form)); toast('Preferencia guardada'); } catch (err) { toastError(err); }
      });
    },
  },

  privacy: {
    role: 'PATIENT',
    async render(ctx) {
      const [grants, log] = await Promise.all([ctx.api.get('/me/grants'), ctx.api.get('/me/access-log')]);
      const ACTION = { EPISODE_VIEWED_BY_PROFESSIONAL: 'Consultó el episodio', GRANT_CREATED: 'Autorizaste acceso', GRANT_REVOKED: 'Revocaste acceso' };
      const active = grants.filter((g) => g.active);
      return `<section><div class="badge">Privacidad</div><h2>Tu información, bajo tu control</h2>
        <div class="card"><h3>Accesos vigentes (${active.length})</h3><p class="small muted">Cada autorización es para un solo episodio, con fecha de vencimiento. Puedes revocarla cuando quieras.</p>
          ${active.map((g) => `<div class="privacy-row"><div><strong>${esc(g.professional_name || 'Profesional')}</strong><div class="small muted">${esc(g.episode_title)} · ${g.scope === 'FULL' ? 'Expediente completo del episodio' : 'Resumen del episodio'} · vence ${formatDate(g.expires_at)}</div></div><button class="mini-button danger" data-revoke="${g.id}" data-episode="${g.episode_id}">Revocar</button></div>`).join('') || '<p class="small muted">No has compartido ningún episodio.</p>'}
        </div>
        <div class="card" style="margin-top:12px"><h3>Bitácora de accesos</h3>${log.slice(0, 30).map((l) => `<div class="privacy-row"><div><strong>${esc(ACTION[l.action] || l.action)}</strong><div class="small muted">${esc(l.professional_name || 'Tú')} · ${formatDate(l.created_at)} ${esc(String(l.created_at).slice(11, 16))} UTC</div></div></div>`).join('') || '<p class="small muted">Sin registros todavía.</p>'}</div>
        <div class="card" style="margin-top:12px"><h3>Mis datos</h3><p class="small muted">Descarga una copia de toda tu información en formato JSON.</p><a class="button full" href="/api/me/export" download>Descargar mis datos</a>
          <button class="button full" style="margin-top:9px" data-logout-all>Cerrar sesión en todos los dispositivos</button></div>
        ${nav('myHealth', null)}</section>`;
    },
    mount(root, ctx) {
      root.querySelectorAll('[data-revoke]').forEach((b) => b.addEventListener('click', async () => {
        if (!confirm('¿Revocar este acceso ahora? El profesional dejará de ver el episodio de inmediato.')) return;
        try { await ctx.api.del(`/episodes/${b.dataset.episode}/grants/${b.dataset.revoke}`); toast('Acceso revocado'); ctx.render(); } catch (e) { toastError(e); }
      }));
      root.querySelector('[data-logout-all]').addEventListener('click', async () => {
        if (!confirm('Se cerrará tu sesión en todos los dispositivos, incluido este.')) return;
        try { await ctx.api.post('/auth/logout-all'); } catch { /* */ }
        ctx.session.user = null; ctx.go('login');
      });
    },
  },

  emergency: {
    role: 'PATIENT',
    render(ctx) {
      const p = ctx.session.profile || {};
      return `<section><div class="badge">Ayuda urgente</div><h2>Información de emergencia</h2>
        <div class="urgent-card"><strong>Si tu vida está en riesgo, llama al 911.</strong><p class="small">MEXIA no sustituye los servicios de emergencia. No esperes a terminar un registro.</p><a class="button primary full" href="tel:911">Llamar al 911</a></div>
        <div class="card" style="margin-top:12px"><h3>Datos clave para el personal de salud</h3>
          <p><strong>Nombre:</strong> ${esc(ctx.session.user.name)}</p>
          <p><strong>Grupo sanguíneo:</strong> ${esc(p.blood_type || 'No registrado')}</p>
          <p><strong>Alergias:</strong> ${esc(p.allergies || 'No registradas')}</p>
          <p><strong>Medicamentos actuales:</strong> ${esc(p.current_medications || 'No registrados')}</p>
          <p><strong>Antecedentes:</strong> ${esc(p.conditions || 'No registrados')}</p>
          <p><strong>Contacto de emergencia:</strong> ${esc(p.emergency_contact || 'No registrado')}</p>
          <button class="button full" data-go="myHealth">Actualizar mi expediente</button></div>
        ${nav('home', null)}</section>`;
    },
  },
};
