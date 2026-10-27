// Episodios de salud: registro guiado, historial, vista de continuidad, seguimiento, cierre y compartir.
import { esc, nav, localISO, addDaysISO, formatDate, formatDateTime, intensityChart, statusChip, toast, toastError, readForm, busy } from '../ui.js';

const SYMPTOMS = ['🤕 Dolor', '🤒 Fiebre', '🤢 Malestar estomacal', '😮‍💨 Dificultad para respirar', '😵 Mareo', '✍️ Otro síntoma'];
const ONSETS = ['Hoy', 'Ayer', 'Hace 2–3 días', 'Hace más de una semana', 'No estoy seguro'];
const EVOLUTIONS = ['Está mejorando', 'Está igual', 'Está empeorando', 'Va y viene'];
const LOCATIONS = ['Cabeza', 'Pecho', 'Abdomen', 'Espalda', 'Brazo', 'Pierna', 'Otra zona', 'No sé'];
const SIDES = ['Centro', 'Derecho', 'Izquierdo', 'Ambos', 'No sé'];

const strip = (s) => String(s || '').replace(/^\S+\s/, '');
const needsLocation = (d) => /Dolor/.test(d.symptom) || /dolor/i.test(d.description);
const steps = (d) => ['síntoma', 'inicio', 'intensidad', 'evolución', ...(needsLocation(d) ? ['ubicación'] : []), 'revisión'];

function onsetToDate(onset) {
  const t = localISO();
  return { Hoy: [t, false], Ayer: [addDaysISO(t, -1), false], 'Hace 2–3 días': [addDaysISO(t, -2), true],
    'Hace más de una semana': [addDaysISO(t, -8), true] }[onset] || [t, true];
}

function draft(ctx) {
  if (!ctx.ui.newEpisode) ctx.ui.newEpisode = { step: 0, symptom: '', description: '', onset: '', intensity: 5, evolution: '', location: '', side: 'Centro' };
  return ctx.ui.newEpisode;
}

export default {
  newEpisode: {
    role: 'PATIENT',
    render(ctx) {
      const d = draft(ctx);
      const st = steps(d); const idx = Math.min(d.step, st.length - 1); const stage = st[idx]; d.step = idx;
      const option = (v, sel) => `<button type="button" class="ne-option ${sel ? 'selected' : ''}" data-ne-option="${esc(v)}" aria-pressed="${sel}"><span>${esc(v)}</span><span class="ne-check">${sel ? '✓' : '○'}</span></button>`;
      let title = '', sub = '', content = '';
      if (stage === 'síntoma') {
        title = '¿Qué te está pasando?'; sub = 'Elige una opción o descríbelo con tus propias palabras.';
        content = SYMPTOMS.map((x) => option(x, d.symptom === x)).join('') + `<div class="ne-form"><label for="ne-description">Descríbelo con tus palabras (opcional si elegiste una opción)</label><textarea id="ne-description" class="textarea" maxlength="800" placeholder="Por ejemplo: tengo dolor de cabeza desde ayer...">${esc(d.description)}</textarea></div>`;
      } else if (stage === 'inicio') {
        title = '¿Cuándo comenzó?'; sub = 'Una respuesta aproximada también está bien.'; content = ONSETS.map((x) => option(x, d.onset === x)).join('');
      } else if (stage === 'intensidad') {
        title = '¿Qué tan intenso es?'; sub = 'Marca del 0 al 10 cómo lo percibes en este momento.';
        content = `<div class="ne-form"><div class="ne-intensity"><span id="ne-int-value">${d.intensity}</span><small style="font-size:17px;color:#849ba4"> /10</small></div><label for="ne-intensity">Intensidad percibida</label><input id="ne-intensity" type="range" min="0" max="10" step="1" value="${d.intensity}"><div style="display:flex;justify-content:space-between;font-size:12px;color:#7b919c"><span>Sin molestia</span><span>Máxima intensidad</span></div></div>`;
      } else if (stage === 'evolución') {
        title = '¿Cómo ha cambiado?'; sub = 'Si no estás seguro, elige lo que más se aproxime.'; content = EVOLUTIONS.map((x) => option(x, d.evolution === x)).join('');
      } else if (stage === 'ubicación') {
        title = '¿Dónde lo sientes?'; sub = 'Solo si puedes identificar una zona. Puedes omitir esta pregunta.';
        content = `<div class="ne-inline">${LOCATIONS.map((x) => option(x, d.location === x)).join('')}</div><div class="ne-form"><label for="ne-side">Lado (opcional)</label><select id="ne-side" class="select">${SIDES.map((x) => `<option ${d.side === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>`;
      } else {
        title = 'Revisa tu información'; sub = 'Confirma los datos antes de crear el episodio.';
        const desc = d.description.trim() || strip(d.symptom);
        content = `<div class="ne-form ne-summary">${[['Síntoma', desc], ['Inicio', d.onset], ['Intensidad', d.intensity + '/10'], ['Evolución', d.evolution], ...(needsLocation(d) ? [['Ubicación', d.location || 'No indicada']] : [])].map(([a, b]) => `<div><span>${a}</span><strong>${esc(b)}</strong></div>`).join('')}</div><p class="ne-note">Al confirmar se creará un episodio en tu historial. Puedes regresar y corregir tus respuestas.</p>`;
      }
      return `<section class="ne26"><div class="ne-head"><strong>✚ MEXIA</strong><span class="badge">Nuevo episodio</span></div><div class="ne-progress" aria-label="Paso ${idx + 1} de ${st.length}">${st.map((_, i) => `<i class="${i <= idx ? 'done' : ''}"></i>`).join('')}</div><p class="small muted">PASO ${idx + 1} DE ${st.length}</p><h2>${title}</h2><p class="ne-sub">${sub}</p>${content}<div class="ne-alert">MEXIA organiza información, no realiza diagnósticos. Si tienes síntomas graves o una emergencia, busca atención médica inmediata; no esperes a terminar este registro.</div><div class="ne-actions"><button type="button" class="button" id="ne-back">${idx === 0 ? 'Cancelar' : 'Atrás'}</button><button type="button" class="button primary" id="ne-next">${stage === 'revisión' ? 'Crear episodio' : 'Continuar →'}</button></div></section>`;
    },
    mount(root, ctx) {
      const d = draft(ctx);
      const stage = steps(d)[d.step];
      root.querySelector('#ne-description')?.addEventListener('input', (e) => { d.description = e.target.value; });
      root.querySelector('#ne-intensity')?.addEventListener('input', (e) => { d.intensity = Number(e.target.value); root.querySelector('#ne-int-value').textContent = d.intensity; });
      root.querySelector('#ne-side')?.addEventListener('change', (e) => { d.side = e.target.value; });
      root.querySelectorAll('[data-ne-option]').forEach((b) => b.addEventListener('click', () => {
        const v = b.dataset.neOption;
        if (stage === 'síntoma') d.symptom = v; if (stage === 'inicio') d.onset = v; if (stage === 'evolución') d.evolution = v; if (stage === 'ubicación') d.location = v;
        ctx.render();
      }));
      root.querySelector('#ne-back').addEventListener('click', () => {
        if (d.step === 0) { ctx.ui.newEpisode = null; ctx.go('home'); } else { d.step--; ctx.render(); }
      });
      root.querySelector('#ne-next').addEventListener('click', (e) => {
        if (stage === 'síntoma' && !d.symptom && !d.description.trim()) return toast('Elige un síntoma o descríbelo para continuar', 'error');
        if (stage === 'inicio' && !d.onset) return toast('Selecciona cuándo comenzó', 'error');
        if (stage === 'evolución' && !d.evolution) return toast('Selecciona cómo ha cambiado', 'error');
        if (stage !== 'revisión') { d.step++; ctx.render(); window.scrollTo(0, 0); return; }
        busy(e.currentTarget, async () => {
          const title = (d.description.trim() || strip(d.symptom)).slice(0, 160);
          const [start, approx] = onsetToDate(d.onset);
          try {
            const ep = await ctx.api.post('/episodes', {
              title, start_date: start, onset_reported: d.onset, onset_approximate: approx,
              symptom: { name: title, intensity: d.intensity, evolution: d.evolution, location: needsLocation(d) ? d.location || null : null, side: needsLocation(d) && d.location ? d.side : null, notes: d.description.trim() || null },
            });
            ctx.ui.newEpisode = null;
            toast('Episodio creado');
            ctx.go('episode', { id: ep.id });
          } catch (err) { toastError(err); }
        });
      });
    },
  },

  episodes: {
    role: 'PATIENT',
    async render(ctx) {
      const list = await ctx.api.get('/episodes');
      return `<section><div class="badge">Mi Salud · Historial</div><h2>Mis episodios de salud</h2><p class="muted">Cada episodio reúne síntomas, evolución, medicamentos, estudios y citas de un mismo problema de salud.</p>
        <button class="button primary full" data-go="newEpisode">＋ Nuevo episodio</button>
        ${list.map((ep) => `<article class="card" style="margin-top:12px"><div class="item-top"><strong>${esc(ep.title)}</strong><span class="mxa-chip mxa-chip--${ep.status === 'ACTIVE' ? 'ok' : 'off'}">${ep.status === 'ACTIVE' ? 'En seguimiento' : 'Cerrado'}</span></div><p class="small muted">${formatDate(ep.start_date)} → ${ep.end_date ? formatDate(ep.end_date) : 'En seguimiento'}</p><div class="small muted">${ep.symptom_count} síntoma(s) · ${ep.followup_count} seguimiento(s)${ep.last_intensity !== null ? ` · última intensidad ${ep.last_intensity}/10` : ''}</div><button type="button" class="button full" data-go="episode" data-id="${ep.id}" style="margin-top:12px">Ver episodio</button></article>`).join('') || '<div class="card" style="margin-top:12px">Aún no hay episodios. Inicia uno cuando quieras registrar cómo te sientes.</div>'}
        ${nav('myHealth', null)}</section>`;
    },
  },

  episode: {
    role: 'PATIENT',
    async render(ctx) {
      const ep = await ctx.api.get(`/episodes/${ctx.params.id}`);
      const today = localISO();
      const upcoming = ep.activities.filter((x) => x.event_date >= today || x.repeat_mode !== 'none').slice(0, 4);
      const openAppts = ep.appointments.filter((a) => ['REQUESTED', 'CONFIRMED'].includes(a.status));
      const lastInt = [...ep.followups].reverse().find((f) => f.intensity !== null);
      const meds = ep.activities.filter((a) => a.type === 'Medicamento');
      const activeGrants = ep.grants.filter((g) => g.active);
      const panel = ctx.ui.episodePanel || '';
      return `<section class="continuity" aria-label="Continuidad de salud">
        <div class="ct-hero">
          <div class="ct-eyebrow">MEXIA · CONTINUIDAD DE SALUD</div>
          <div style="margin-top:15px"><span class="ct-status">${ep.status === 'ACTIVE' ? 'En seguimiento' : 'Cerrado · ' + esc(ep.outcome || '')}</span></div>
          <h2>${esc(ep.title)}</h2>
          <p class="ct-muted" style="max-width:460px;margin:0">Inició ${formatDate(ep.start_date)}${ep.onset_reported ? ` (${esc(ep.onset_reported.toLowerCase())})` : ''}${ep.end_date ? ` · cerrado ${formatDate(ep.end_date)}` : ''}.</p>
          <div style="display:flex;gap:9px;flex-wrap:wrap;margin-top:19px">
            ${ep.status === 'ACTIVE' ? '<button class="button primary" data-panel="followup">Registrar evolución →</button><button class="button" data-panel="close">Cerrar episodio</button>' : '<button class="button" data-reopen>Reabrir episodio</button>'}
          </div>
        </div>
        ${panel === 'followup' ? `<form class="ct-panel" id="followup-form" style="margin:14px 0"><h3>¿Cómo sigues?</h3>
          <div class="field"><label for="fu-int">Intensidad (0–10): <strong id="fu-int-v">${lastInt?.intensity ?? 5}</strong></label><input id="fu-int" name="intensity" type="range" min="0" max="10" value="${lastInt?.intensity ?? 5}"></div>
          <div class="field"><label for="fu-evo">Evolución</label><select id="fu-evo" name="evolution" class="select"><option value="">Sin cambios que reportar</option>${EVOLUTIONS.map((x) => `<option>${x}</option>`).join('')}</select></div>
          <div class="field"><label for="fu-note">Nota (opcional)</label><textarea id="fu-note" name="note" class="textarea" rows="2" maxlength="1000"></textarea></div>
          <div class="actions"><button class="button" type="button" data-panel="">Cancelar</button><button class="button primary" type="submit">Guardar seguimiento</button></div></form>` : ''}
        ${panel === 'close' ? `<form class="ct-panel" id="close-form" style="margin:14px 0"><h3>Cerrar episodio</h3>
          <div class="field"><label for="cl-out">Resultado</label><select id="cl-out" name="outcome" class="select">${['Resuelto', 'Mejoró', 'Sin cambios', 'Derivado a especialista', 'Otro'].map((x) => `<option>${x}</option>`).join('')}</select></div>
          <div class="field"><label for="cl-date">Fecha de cierre</label><input id="cl-date" name="end_date" type="date" class="input" value="${localISO()}" min="${ep.start_date}"></div>
          <div class="field"><label for="cl-note">Nota de cierre (opcional)</label><textarea id="cl-note" name="closing_note" class="textarea" rows="2" maxlength="1000"></textarea></div>
          <div class="actions"><button class="button" type="button" data-panel="">Cancelar</button><button class="button primary" type="submit">Cerrar episodio</button></div></form>` : ''}
        <div class="ct-grid">
          <div class="ct-stat"><span style="font-size:20px">🫀</span><span class="ct-number">${ep.symptoms.length}</span><small>Síntomas registrados</small></div>
          <div class="ct-stat"><span style="font-size:20px">📅</span><span class="ct-number">${upcoming.length}</span><small>Actividades</small></div>
          <div class="ct-stat"><span style="font-size:20px">🩺</span><span class="ct-number">${openAppts.length}</span><small>Citas activas</small></div>
          <div class="ct-stat"><span style="font-size:20px">💙</span><span class="ct-number">${lastInt ? lastInt.intensity : '–'}/10</span><small>Última intensidad</small></div>
        </div>
        <div class="ct-layout">
          <div style="display:grid;gap:14px">
            <div class="ct-panel"><div class="ct-heading"><h3>Mi evolución</h3></div>${intensityChart(ep.followups.filter((f) => f.intensity !== null))}
              ${ep.followups.slice(-5).reverse().map((f) => `<div class="ct-item"><div class="ct-dot">↗</div><div class="ct-item-content"><strong>${f.intensity !== null ? f.intensity + '/10' : 'Nota'}${f.evolution ? ' · ' + esc(f.evolution) : ''}</strong><small>${formatDate(f.recorded_at)}${f.note ? ' · ' + esc(f.note) : ''}</small></div></div>`).join('')}</div>
            <div class="ct-panel"><div class="ct-heading"><h3>Mis síntomas</h3><button class="ct-link" data-panel="symptom">＋ Agregar</button></div>
              ${panel === 'symptom' ? `<form id="symptom-form" class="ne-form"><div class="field"><label for="sy-name">Síntoma</label><input id="sy-name" name="name" class="input" required maxlength="160"></div><div class="field"><label for="sy-int">Intensidad (0–10)</label><input id="sy-int" name="intensity" type="number" min="0" max="10" class="input" value="5"></div><div class="field"><label for="sy-loc">Ubicación (opcional)</label><select id="sy-loc" name="location" class="select"><option value="">No aplica</option>${LOCATIONS.map((x) => `<option>${x}</option>`).join('')}</select></div><div class="field"><label for="sy-date">Desde</label><input id="sy-date" name="onset_date" type="date" class="input" value="${localISO()}"></div><div class="actions"><button type="button" class="button" data-panel="">Cancelar</button><button class="button primary" type="submit">Guardar síntoma</button></div></form>` : ''}
              ${ep.symptoms.map((x) => `<div class="ct-item"><div class="ct-dot">🫀</div><div class="ct-item-content"><strong>${esc(x.name)}</strong><small>${esc(x.location || 'Ubicación no indicada')} · ${x.intensity ?? '–'}/10 · desde ${formatDate(x.onset_date)}</small></div><button class="mini-button danger" data-del-symptom="${x.id}" aria-label="Eliminar síntoma">✕</button></div>`).join('') || '<p class="ct-muted">Aún no hay síntomas registrados.</p>'}
            </div>
          </div>
          <div style="display:grid;gap:14px">
            <div class="ct-panel"><div class="ct-heading"><h3>Lo que sigue</h3><button class="ct-link" data-go="calendarEvent" data-id="new" data-episode="${ep.id}">＋ Actividad</button></div>
              ${upcoming.map((x) => `<div class="ct-item"><div class="ct-dot">${x.type === 'Medicamento' ? '💊' : x.type === 'Consulta' ? '🩺' : x.type === 'Estudio' ? '🧪' : '📌'}</div><div class="ct-item-content"><strong>${esc(x.title)}</strong><small>${formatDate(x.event_date)} · ${esc((x.event_time || '').slice(0, 5) || 'Sin hora')}${x.repeat_mode !== 'none' ? ' · ↻ recurrente' : ''}</small></div></div>`).join('') || '<p class="ct-muted">No hay actividades vinculadas a este episodio.</p>'}
            </div>
            <div class="ct-panel"><div class="ct-heading"><h3>Citas de este episodio</h3><button class="ct-link" data-go="doctors">Buscar médico →</button></div>
              ${ep.appointments.map((a) => `<button class="ct-item mxa-row-btn" data-go="appointment" data-id="${a.id}"><div class="ct-dot">🩺</div><div class="ct-item-content"><strong>${esc(a.professional_name || 'Profesional')}</strong><small>${formatDateTime(a.start_at)}</small></div>${statusChip(a.status)}</button>`).join('') || '<p class="ct-muted">Sin citas vinculadas.</p>'}
            </div>
            <div class="v27-card"><div class="v27-top"><h3 style="margin:0">🩺 Compartir este episodio</h3><span class="v27-chip">Control del paciente</span></div>
              <p class="v27-muted">Solo el episodio seleccionado, solo con el médico que elijas y por tiempo limitado. Puedes revocarlo en cualquier momento.</p>
              <div class="v27-grid"><div class="v27-metric"><strong>${ep.followups.length}</strong><small>Seguimientos</small></div><div class="v27-metric"><strong>${meds.length}</strong><small>Medicamentos</small></div><div class="v27-metric"><strong>${activeGrants.length}</strong><small>Accesos vigentes</small></div></div>
              ${activeGrants.map((g) => `<div class="privacy-row"><div><strong>${esc(g.professional_name || 'Profesional')}</strong><div class="small muted">${g.scope === 'FULL' ? 'Completo' : 'Resumen'} · vence ${formatDate(g.expires_at)}</div></div><button class="mini-button danger" data-revoke="${g.id}">Revocar</button></div>`).join('')}
              <div class="v27-actions"><button class="button" data-panel="share">Compartir con un médico →</button></div>
              ${panel === 'share' ? await shareForm(ctx, ep) : ''}
            </div>
            <div class="ct-panel"><div class="ct-heading"><h3>Accesos a mi atención</h3></div><div class="ct-actions">
              <button class="ct-action" data-go="medicationTracker"><span>💊</span> Mis medicamentos</button>
              <button class="ct-action" data-go="appointments"><span>🩺</span> Mis citas</button>
              <button class="ct-action" data-go="documents"><span>📄</span> Mis estudios</button>
              <button class="ct-action" data-go="privacy"><span>🔒</span> Privacidad</button>
            </div></div>
          </div>
        </div>
        <p class="ct-note">Los registros no sustituyen la atención profesional.</p>
        <div class="actions"><button class="button" data-go="episodes">← Mis episodios</button><button class="button danger" data-delete-episode>Eliminar episodio</button></div>
      </section>`;
    },
    mount(root, ctx) {
      const epId = ctx.params.id;
      const reload = () => ctx.render();
      root.querySelectorAll('[data-panel]').forEach((b) => b.addEventListener('click', () => { ctx.ui.episodePanel = b.dataset.panel; reload(); }));
      root.querySelector('#fu-int')?.addEventListener('input', (e) => { root.querySelector('#fu-int-v').textContent = e.target.value; });
      const submit = (sel, fn) => { const f = root.querySelector(sel); f?.addEventListener('submit', (e) => { e.preventDefault(); busy(f.querySelector('[type=submit]'), async () => { try { await fn(readForm(f)); ctx.ui.episodePanel = ''; reload(); } catch (err) { toastError(err); } }); }); };
      submit('#followup-form', async (b) => { await ctx.api.post(`/episodes/${epId}/followups`, b); toast('Seguimiento guardado'); });
      submit('#close-form', async (b) => { await ctx.api.patch(`/episodes/${epId}`, { ...b, status: 'CLOSED' }); toast('Episodio cerrado'); });
      submit('#symptom-form', async (b) => { await ctx.api.post(`/episodes/${epId}/symptoms`, b); toast('Síntoma agregado'); });
      submit('#share-form', async (b) => {
        if (!b.professional_id) throw new Error('Elige un profesional');
        await ctx.api.post(`/episodes/${epId}/grants`, b); toast('Episodio compartido');
      });
      root.querySelector('[data-reopen]')?.addEventListener('click', async () => { try { await ctx.api.patch(`/episodes/${epId}`, { status: 'ACTIVE' }); reload(); } catch (e) { toastError(e); } });
      root.querySelectorAll('[data-del-symptom]').forEach((b) => b.addEventListener('click', async () => {
        if (!confirm('¿Eliminar este síntoma?')) return;
        try { await ctx.api.del(`/episodes/${epId}/symptoms/${b.dataset.delSymptom}`); reload(); } catch (e) { toastError(e); }
      }));
      root.querySelectorAll('[data-revoke]').forEach((b) => b.addEventListener('click', async () => {
        if (!confirm('¿Revocar el acceso ahora?')) return;
        try { await ctx.api.del(`/episodes/${epId}/grants/${b.dataset.revoke}`); toast('Acceso revocado'); reload(); } catch (e) { toastError(e); }
      }));
      root.querySelector('[data-delete-episode]').addEventListener('click', async () => {
        if (!confirm('¿Eliminar este episodio con todos sus síntomas y seguimientos? Esta acción no se puede deshacer.')) return;
        try { await ctx.api.del(`/episodes/${epId}`); toast('Episodio eliminado'); ctx.go('episodes'); } catch (e) { toastError(e); }
      });
      // "＋ Actividad" lleva el episodio preseleccionado
      root.querySelector('[data-episode]')?.addEventListener('click', () => { ctx.ui.calendarEpisode = epId; }, true);
    },
  },
};

async function shareForm(ctx, ep) {
  // Profesionales con los que el paciente tiene relación asistencial (citas no canceladas)
  const appts = await ctx.api.get('/appointments');
  const profs = new Map();
  appts.filter((a) => ['REQUESTED', 'CONFIRMED', 'COMPLETED'].includes(a.status)).forEach((a) => profs.set(a.professional_id, a.professional_name));
  if (!profs.size) return '<p class="small muted" style="margin-top:10px">Para compartir, primero agenda una cita con un profesional verificado.</p>';
  return `<form id="share-form" class="ne-form" style="margin-top:12px">
    <div class="field"><label for="sh-prof">Profesional</label><select id="sh-prof" name="professional_id" class="select">${[...profs].map(([id, name]) => `<option value="${id}">${esc(name)}</option>`).join('')}</select></div>
    <div class="field"><label for="sh-scope">¿Qué compartir?</label><select id="sh-scope" name="scope" class="select"><option value="SUMMARY">Resumen: síntomas y últimas intensidades</option><option value="FULL">Completo: también seguimientos y medicamentos del episodio</option></select></div>
    <div class="field"><label for="sh-days">Vigencia</label><select id="sh-days" name="days" class="select"><option value="7">7 días</option><option value="30">30 días</option><option value="90">90 días</option></select></div>
    <label style="display:flex;gap:10px;align-items:flex-start"><input type="checkbox" required> <span class="small">Autorizo compartir únicamente el episodio “${esc(ep.title)}” con este profesional.</span></label>
    <div class="actions"><button class="button" type="button" data-panel="">Cancelar</button><button class="button primary" type="submit">Autorizar acceso</button></div></form>`;
}
