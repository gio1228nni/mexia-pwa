// Calendario de salud, alta/edición de actividades y seguimiento de tomas de medicamentos.
import { esc, nav, localISO, addDaysISO, formatDate, monthLabel, calSticker, CAL_TYPES, toast, toastError, readForm, busy } from '../ui.js';
import { bottomNav } from './patient.js';

function monthRange(y, m) {
  const first = new Date(y, m, 1);
  const offset = (first.getDay() + 6) % 7;             // lunes primero
  const start = localISO(new Date(y, m, 1 - offset));
  return { start, end: addDaysISO(start, 41) };
}

export default {
  calendar: {
    role: 'PATIENT',
    async render(ctx) {
      const now = new Date();
      const cal = ctx.ui.cal || (ctx.ui.cal = { y: now.getFullYear(), m: now.getMonth(), sel: localISO(), filter: 'Todas' });
      const { start, end } = monthRange(cal.y, cal.m);
      const [events, episodes] = await Promise.all([ctx.api.get(`/calendar?from=${start}&to=${end}`), ctx.api.get('/episodes')]);
      const today = localISO();
      const byDay = new Map();
      events.forEach((e) => { if (!byDay.has(e.date)) byDay.set(e.date, []); byDay.get(e.date).push(e); });
      const cells = Array.from({ length: 42 }, (_, i) => {
        const iso = addDaysISO(start, i);
        const d = new Date(iso + 'T12:00:00');
        const dayEvents = byDay.get(iso) || [];
        const starts = episodes.filter((e) => e.start_date === iso).length;
        const ends = episodes.filter((e) => e.end_date === iso).length;
        const ongoing = episodes.some((e) => e.start_date <= iso && (!e.end_date || e.end_date >= iso));
        return { iso, n: d.getDate(), muted: d.getMonth() !== cal.m, dayEvents, starts, ends, ongoing };
      });
      const selected = (byDay.get(cal.sel) || []).filter((e) => cal.filter === 'Todas' || e.type === cal.filter);
      const epOnDay = episodes.filter((ep) => ep.start_date <= cal.sel && (!ep.end_date || ep.end_date >= cal.sel));
      const nextCount = events.filter((e) => e.date >= today && e.date <= addDaysISO(today, 30)).length;
      return `<section class="mexia-calendar cal-simple">
        <div class="cal-hero"><div><div class="cal-eyebrow">✦ MI AGENDA DE SALUD</div><h2>Calendario</h2><p>Tu atención organizada en un solo lugar.</p></div><div class="cal-hero-mark" aria-hidden="true">🗓️</div></div>
        <div class="cal-layout"><div class="cal-surface">
          <div class="calendar-toolbar">
            <button type="button" class="cal-arrow" data-cal-move="-1" aria-label="Mes anterior">‹</button>
            <strong style="text-transform:capitalize" aria-live="polite">${monthLabel(cal.y, cal.m)}</strong>
            <button type="button" class="cal-arrow" data-cal-move="1" aria-label="Mes siguiente">›</button>
            <button type="button" class="cal-today" data-cal-today>Hoy</button>
          </div>
          <div class="calendar-grid" role="group" aria-label="Seleccionar día">${['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d) => `<div class="calendar-head">${d}</div>`).join('')}${cells.map((c) => `<button type="button" aria-label="${formatDate(c.iso)}${c.dayEvents.length ? `, ${c.dayEvents.length} actividades` : ''}" aria-pressed="${c.iso === cal.sel}" class="calendar-day ${c.muted ? 'muted-day' : ''} ${c.iso === today ? 'today' : ''} ${c.iso === cal.sel ? 'selected' : ''} ${c.ongoing ? 'ep-range' : ''} ${c.starts ? 'ep-start' : ''} ${c.ends ? 'ep-end' : ''}" data-calendar-date="${c.iso}"><div class="calendar-number">${c.n}</div><div class="ep-markers">${c.starts ? '<span class="ep-marker start" title="Inicio del episodio">I</span>' : ''}${c.ends ? '<span class="ep-marker end" title="Fin del episodio">F</span>' : ''}${c.dayEvents.length ? `<span class="mx-day-stickers">${c.dayEvents.slice(0, 2).map((e) => calSticker(e, true)).join('')}${c.dayEvents.length > 2 ? `<span class="mx-sticker-more">+${c.dayEvents.length - 2}</span>` : ''}</span>` : ''}</div></button>`).join('')}</div>
          <div class="cal-hint"><span class="ep-legend"><b class="ep-marker start">I</b> Inicio <b class="ep-marker end">F</b> Final</span><span>· ${nextCount} actividades en los próximos 30 días</span></div>
        </div><div class="cal-surface">
          <div class="ep-day-panel">
            <div class="ep-day-title"><strong>Seguimiento de episodios</strong><small>Inicio · evolución · cierre</small></div>
            ${epOnDay.map((ep) => `<div class="ep-active-card"><div><strong>${esc(ep.title)}</strong><small>${formatDate(ep.start_date)} → ${ep.end_date ? formatDate(ep.end_date) : 'En seguimiento'} · ${ep.symptom_count} síntoma(s)</small></div><button type="button" data-go="episode" data-id="${ep.id}">Ver</button></div>`).join('') || '<p class="ep-empty-label">Sin episodios en esta fecha.</p>'}
            <button type="button" class="ep-new-btn" data-go="newEpisode">＋ Iniciar episodio</button>
          </div>
          <div class="mx-agenda-tools"><label for="mx-cal-filter">Filtrar actividades</label><select id="mx-cal-filter" class="select"><option value="Todas">Todas</option>${CAL_TYPES.map((t) => `<option ${cal.filter === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
          <div class="cal-day-header"><div><strong>${formatDate(cal.sel, { weekday: true })}</strong><div class="small muted">${selected.length === 0 ? 'Sin actividades' : selected.length === 1 ? '1 actividad' : `${selected.length} actividades`}</div></div></div>
          ${selected.map((ev) => `<div class="mx-agenda-entry"><button type="button" class="cal-simple-event" ${ev.appointment_id ? `data-go="appointment" data-id="${ev.appointment_id}"` : `data-go="calendarEvent" data-id="${ev.id}"`} aria-label="Ver detalles de ${esc(ev.title)}"><span class="cal-simple-icon" aria-hidden="true">${calSticker(ev)}</span><span class="cal-simple-content"><strong>${esc(ev.title)}</strong><small>${esc(ev.time || 'Sin hora')} · ${esc(ev.type)} ${ev.recurring ? '· ↻ Recurrente' : ''}</small><small class="mx-status-text">${esc(ev.status)}</small></span><span class="cal-simple-chevron" aria-hidden="true">›</span></button>${!ev.appointment_id ? `<div class="mx-status-buttons">${['Pendiente', 'Completada', 'Omitida'].map((st) => `<button type="button" data-cal-status="${ev.id}" data-date="${ev.date}" data-status="${st}" class="${ev.status === st ? 'active' : ''}">${st}</button>`).join('')}</div>` : ''}</div>`).join('')
            || '<div class="cal-empty"><div class="cal-empty-icon" aria-hidden="true">🌿</div><strong>Tu día está libre</strong><div class="small muted" style="margin-top:5px">Puedes elegir otro día o agregar una actividad.</div></div>'}
          <button type="button" class="button primary full cal-primary-action" data-go="calendarEvent" data-id="new">＋ Agregar actividad</button>
          <button type="button" class="cal-secondary-link" data-go="appointments">Gestionar mis citas médicas ›</button>
        </div></div>
        <div class="cal-notice-compact">🔔 Los recordatorios se muestran mientras MEXIA está abierta. <button type="button" data-enable-notifications>Activar avisos</button></div>
        ${bottomNav('calendar')}
      </section>`;
    },
    mount(root, ctx) {
      const cal = ctx.ui.cal;
      root.querySelectorAll('[data-cal-move]').forEach((b) => b.addEventListener('click', () => {
        const d = new Date(cal.y, cal.m + Number(b.dataset.calMove), 1); cal.y = d.getFullYear(); cal.m = d.getMonth(); ctx.render();
      }));
      root.querySelector('[data-cal-today]').addEventListener('click', () => { const d = new Date(); Object.assign(cal, { y: d.getFullYear(), m: d.getMonth(), sel: localISO() }); ctx.render(); });
      root.querySelectorAll('[data-calendar-date]').forEach((b) => b.addEventListener('click', () => { cal.sel = b.dataset.calendarDate; ctx.render(); }));
      root.querySelector('#mx-cal-filter').addEventListener('change', (e) => { cal.filter = e.target.value; ctx.render(); });
      root.querySelectorAll('[data-cal-status]').forEach((b) => b.addEventListener('click', async () => {
        try { await ctx.api.put(`/calendar/${b.dataset.calStatus}/status`, { date: b.dataset.date, status: b.dataset.status }); ctx.render(); } catch (e) { toastError(e); }
      }));
      root.querySelector('[data-calendar-date]') && root.querySelector('.cal-primary-action').addEventListener('click', () => { ctx.ui.calendarDate = cal.sel; }, true);
      root.querySelector('[data-enable-notifications]').addEventListener('click', async () => {
        if (!('Notification' in window)) return toast('Tu navegador no admite notificaciones', 'error');
        const r = await Notification.requestPermission();
        toast(r === 'granted' ? 'Avisos activados' : 'Avisos no autorizados');
      });
    },
  },

  calendarEvent: {
    role: 'PATIENT',
    async render(ctx) {
      const isNew = !ctx.params.id || ctx.params.id === 'new';
      const episodes = await ctx.api.get('/episodes');
      let ev = { type: ctx.ui.calendarType || 'Medicamento', title: '', event_date: ctx.ui.calendarDate || localISO(), event_time: '08:00', notes: '', repeat_mode: 'none', repeat_until: '', episode_id: ctx.ui.calendarEpisode || '' };
      if (!isNew) {
        ev = await ctx.api.get(`/calendar/${encodeURIComponent(ctx.params.id)}`);
        if (ev.appointment_id) { ctx.go('appointment', { id: ev.appointment_id }); return ''; }
      }
      return `<section><div class="badge">Agenda</div><h2>${isNew ? 'Nueva actividad' : 'Editar actividad'}</h2>
        <form class="card" id="event-form">
          <div class="field"><label for="ev-type">Tipo</label><select id="ev-type" name="type" class="select">${CAL_TYPES.filter((t) => t !== 'Consulta' || !isNew).map((t) => `<option ${ev.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
          <div class="field"><label for="ev-title">Título</label><input id="ev-title" name="title" class="input" required maxlength="160" value="${esc(ev.title)}" placeholder="Ej. Tomar medicamento indicado"></div>
          <div class="field"><label for="ev-date">Fecha</label><input id="ev-date" name="event_date" type="date" class="input" required value="${esc(ev.event_date)}"></div>
          <div class="field"><label for="ev-time">Hora</label><input id="ev-time" name="event_time" type="time" class="input" value="${esc((ev.event_time || '').slice(0, 5))}"></div>
          <div class="field"><label for="ev-repeat">Repetir</label><select id="ev-repeat" name="repeat_mode" class="select">${[['none', 'No se repite'], ['daily', 'Diario'], ['weekly', 'Semanal']].map(([v, l]) => `<option value="${v}" ${ev.repeat_mode === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div class="field"><label for="ev-until">Repetir hasta (opcional)</label><input id="ev-until" name="repeat_until" type="date" class="input" value="${esc(ev.repeat_until || '')}"></div>
          <div class="field"><label for="ev-ep">Episodio relacionado</label><select id="ev-ep" name="episode_id" class="select"><option value="">Ninguno</option>${episodes.map((e) => `<option value="${e.id}" ${String(ev.episode_id) === String(e.id) ? 'selected' : ''}>${esc(e.title)}</option>`).join('')}</select></div>
          <div class="field"><label for="ev-notes">Indicaciones / notas</label><textarea id="ev-notes" name="notes" class="textarea" rows="3" maxlength="1000" placeholder="Ej. dosis indicada por tu médico">${esc(ev.notes || '')}</textarea></div>
          <p class="small muted">Registra solo lo que te indicó tu profesional de salud. MEXIA no receta ni ajusta tratamientos.</p>
          <button class="button primary full" type="submit">${isNew ? 'Guardar actividad' : 'Guardar cambios'}</button>
          ${!isNew ? '<button class="button full danger" type="button" data-delete-event style="margin-top:9px">Eliminar actividad</button>' : ''}
        </form>${nav('calendar', null)}</section>`;
    },
    mount(root, ctx) {
      const isNew = !ctx.params.id || ctx.params.id === 'new';
      const form = root.querySelector('#event-form');
      if (!form) return;
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        busy(form.querySelector('[type=submit]'), async () => {
          try {
            const b = readForm(form);
            if (isNew) await ctx.api.post('/calendar', b); else await ctx.api.patch(`/calendar/${ctx.params.id}`, b);
            ctx.ui.calendarEpisode = null; ctx.ui.calendarType = null; ctx.ui.calendarDate = null;
            if (ctx.ui.cal) ctx.ui.cal.sel = b.event_date;
            toast('Actividad guardada');
            ctx.go(b.type === 'Medicamento' && ctx.ui.fromMeds ? 'medicationTracker' : 'calendar');
          } catch (err) { toastError(err); }
        });
      });
      root.querySelector('[data-delete-event]')?.addEventListener('click', async () => {
        if (!confirm('¿Eliminar esta actividad y todas sus repeticiones?')) return;
        try { await ctx.api.del(`/calendar/${ctx.params.id}`); toast('Actividad eliminada'); ctx.go('calendar'); } catch (e) { toastError(e); }
      });
    },
  },

  medicationTracker: {
    role: 'PATIENT',
    async render(ctx) {
      const today = localISO();
      const from = addDaysISO(today, -7), to = addDaysISO(today, 7);
      const events = (await ctx.api.get(`/calendar?from=${from}&to=${to}`)).filter((e) => e.type === 'Medicamento');
      const todays = events.filter((e) => e.date === today);
      const plans = [...new Map(events.map((e) => [e.id, e])).values()];
      const past = events.filter((e) => e.date < today);
      const taken = past.filter((e) => e.status === 'Completada').length;
      return `<section><div class="badge">Seguimiento</div><h2>Mis tomas de medicamentos</h2><p class="muted">Recordatorios que registraste según las indicaciones de tu médico. Marca cada toma como realizada u omitida.</p>
        <button class="button primary" data-new-med>+ Programar recordatorio</button>
        <h3 style="margin-top:20px">Hoy · ${formatDate(today)}</h3>
        ${todays.map((e) => `<article class="card" style="margin-top:12px"><strong>💊 ${esc(e.title)}</strong><p class="small muted">${esc(e.time || 'Sin hora')} · ${esc(e.notes || 'Sin detalle registrado')}</p><span class="v2-chip">${esc(e.status)}</span><div class="v2-toolbar"><button class="button ${e.status === 'Completada' ? 'primary' : ''}" data-med-status="${e.id}" data-value="Completada">✓ Tomado</button><button class="button" data-med-status="${e.id}" data-value="Omitida">Omitido</button></div></article>`).join('') || '<div class="card" style="margin-top:12px">No hay tomas programadas para hoy.</div>'}
        <h3 style="margin-top:20px">Adherencia últimos 7 días</h3>
        <div class="card"><strong>${past.length ? Math.round((taken / past.length) * 100) : 0}%</strong> <span class="small muted">${taken} de ${past.length} tomas marcadas como realizadas</span></div>
        <h3 style="margin-top:20px">Tratamientos registrados</h3>
        ${plans.map((e) => `<button class="card mxa-row-btn" data-go="calendarEvent" data-id="${e.id}" style="margin-top:10px;width:100%;text-align:left"><strong>💊 ${esc(e.title)}</strong><p class="small muted">${e.recurring ? (e.repeat_mode === 'daily' ? 'Diario' : 'Semanal') : 'Una vez'} · ${esc(e.time || 'Sin hora')}${e.repeat_until ? ' · hasta ' + formatDate(e.repeat_until) : ''}</p></button>`).join('') || '<div class="card">Todavía no hay medicamentos programados.</div>'}
        ${nav('home', null)}</section>`;
    },
    mount(root, ctx) {
      root.querySelector('[data-new-med]').addEventListener('click', () => { ctx.ui.calendarType = 'Medicamento'; ctx.ui.fromMeds = true; ctx.go('calendarEvent', { id: 'new' }); });
      root.querySelectorAll('[data-med-status]').forEach((b) => b.addEventListener('click', async () => {
        try { await ctx.api.put(`/calendar/${b.dataset.medStatus}/status`, { date: localISO(), status: b.dataset.value }); ctx.render(); } catch (e) { toastError(e); }
      }));
    },
  },
};
