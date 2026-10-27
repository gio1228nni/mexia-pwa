// Portal médico: registro en 4 pasos, verificación, perfil (borrador → publicación), fotos,
// disponibilidad, solicitudes de consulta, pacientes/episodios compartidos, mensajes y estadísticas.
import { esc, localISO, formatDate, formatDateTime, hhmm, money, statusChip, WEEK, VERIFICATION, PROFILE_STATUS, MODES, toast, toastError, readForm, busy } from '../ui.js';
import { publicCard } from './doctors.js';

const TABS = [['resumen', 'Inicio', '⌂'], ['verificacion', 'Verificación', '◇'], ['perfil', 'Mi perfil', '♙'], ['perfilPublico', 'Perfil público', '▧'], ['agenda', 'Agenda', '▦'], ['consultas', 'Consultas', '◷'], ['pacientes', 'Pacientes', '♡'], ['mensajes', 'Mensajes', '✉'], ['estadisticas', 'Estadísticas', '▥']];
const STEPS = ['Identidad profesional', 'Credenciales médicas', 'Consultorio y atención', 'Revisión y envío'];

const opt = (v, cur, label = v) => `<option value="${esc(v)}" ${String(cur ?? '') === String(v) ? 'selected' : ''}>${esc(label)}</option>`;

// ---------- Bloques de formulario reutilizados en el registro y en "Mi perfil" ----------
const identityFields = (p) => `<div class="mx49-form">
  <div class="wide"><label for="pf-name">Nombre completo *</label><input id="pf-name" name="name" autocomplete="name" required minlength="3" maxlength="120" value="${esc(p.name)}" placeholder="Nombre y apellidos"></div>
  <div><label for="pf-email">Correo de la cuenta</label><input id="pf-email" type="email" value="${esc(p.email)}" disabled></div>
  <div><label for="pf-phone">Teléfono *</label><input id="pf-phone" name="phone" type="tel" inputmode="numeric" pattern="\\d{10}" maxlength="10" value="${esc(p.phone)}" placeholder="10 dígitos"></div></div>`;

const credentialFields = (p) => `<div class="mx49-form">
  <div><label for="pf-type">Tipo de profesional *</label><select id="pf-type" name="professional_type">${opt('MEDICO', p.professional_type, 'Médico')}${opt('ENFERMERIA', p.professional_type, 'Personal de enfermería (alcance limitado)')}</select></div>
  <div><label for="pf-spec">Especialidad *</label><input id="pf-spec" name="specialty" maxlength="100" value="${esc(p.specialty)}" placeholder="Ej. Medicina general"></div>
  <div><label for="pf-lic">Cédula profesional *</label><input id="pf-lic" name="license_number" inputmode="numeric" pattern="\\d{7,8}" maxlength="8" value="${esc(p.license_number)}" placeholder="7 u 8 dígitos"></div>
  <div><label for="pf-slic">Cédula de especialidad (si aplica)</label><input id="pf-slic" name="specialty_license" inputmode="numeric" maxlength="8" value="${esc(p.specialty_license)}"></div>
  <div><label for="pf-uni">Institución formadora</label><input id="pf-uni" name="university" maxlength="150" value="${esc(p.university)}"></div>
  <div><label for="pf-exp">Años de experiencia</label><input id="pf-exp" name="experience_years" type="number" min="0" max="70" value="${esc(p.experience_years)}"></div>
  <div class="wide"><p class="mx49-mini">El formato de la cédula no acredita su autenticidad: el equipo de MEXIA la verifica antes de publicar tu perfil. Cambiar cédula o especialidad de un perfil verificado requiere nueva revisión.</p></div></div>`;

const practiceFields = (d) => `<div class="mx49-form">
  <div><label for="pr-city">Ciudad / municipio *</label><input id="pr-city" name="city" maxlength="100" value="${esc(d.city)}" placeholder="Ej. Puebla"></div>
  <div><label for="pr-mode">Modalidad *</label><select id="pr-mode" name="mode">${Object.entries(MODES).map(([k, l]) => opt(k, d.mode || 'PRESENCIAL', l)).join('')}</select></div>
  <div class="wide"><label for="pr-addr">Dirección de consultorio</label><input id="pr-addr" name="address" maxlength="250" value="${esc(d.address)}"></div>
  <div><label for="pr-price">Precio por consulta (MXN) *</label><input id="pr-price" name="price" type="number" min="0" step="50" value="${esc(d.price)}"></div>
  <div><label for="pr-dur">Duración de consulta (min) *</label><input id="pr-dur" name="duration" type="number" min="10" max="180" value="${esc(d.duration || 30)}"></div>
  <div class="wide"><label for="pr-bio">Presentación profesional</label><textarea id="pr-bio" name="bio" maxlength="2000" placeholder="Experiencia, enfoque de atención y servicios">${esc(d.bio)}</textarea></div>
  <div class="wide"><label for="pr-lang">Idiomas de atención</label><input id="pr-lang" name="languages" maxlength="120" value="${esc(d.languages || 'Español')}"></div></div>`;

function numberOrEmpty(o, keys) { keys.forEach((k) => { if (o[k] === '') o[k] = null; }); return o; }

// ---------- Registro (4 etapas) ----------
function wizard(ctx, me) {
  const p = me.professional, d = me.publicProfile.draft;
  const step = Math.max(0, Math.min(3, ctx.ui.regStep ?? Math.min(3, p.registration_step || 0)));
  ctx.ui.regStep = step;
  const bodies = [
    `<div class="card"><h3>Identidad y contacto</h3>${identityFields(p)}</div>`,
    `<div class="card"><h3>Credenciales y formación</h3><p class="mx55-help">Esta información se declara aquí; su autenticidad se verifica después.</p>${credentialFields(p)}</div>`,
    `<div class="card"><h3>Consultorio y servicios</h3>${practiceFields(d)}</div>`,
    `<div class="card mx52-review"><h3>Confirma tu solicitud</h3><p>Revisa tus datos. El equipo de MEXIA verificará tus credenciales antes de publicar tu perfil.</p><div class="mx52-review-lines">
      ${[['Nombre', p.name], ['Teléfono', p.phone], ['Especialidad', p.specialty], ['Cédula', p.license_number], ['Institución', p.university], ['Ciudad', d.city], ['Modalidad', MODES[d.mode]], ['Precio', money(d.price)], ['Duración', (d.duration || 30) + ' min']].map(([a, b]) => `<p><strong>${a}:</strong> ${esc(b || '—')}</p>`).join('')}</div></div>
     <div class="card mx52-consent"><label><input type="checkbox" id="attest"> Declaro que la información profesional es verdadera y autorizo su revisión.</label><p class="mx49-mini">Tu perfil no será visible para pacientes hasta que la verificación sea aprobada.</p><button class="button primary full" type="button" data-submit-verification>Enviar solicitud y entrar al portal →</button></div>`,
  ];
  return `<section class="mx55-shell" aria-label="Registro profesional paso ${step + 1} de 4"><div class="mx55-top"><div class="mx55-mark">✚</div><div><strong>MEXIA</strong><span>PROFESIONALES</span></div><div class="mx55-trust">◈ Registro seguro</div></div><div class="mx55-layout"><main class="mx55-main">
    <div class="mx55-heading"><span class="mx51-eyebrow">REGISTRO MÉDICO · ETAPA ${step + 1} DE 4</span><h2>${['Tu vocación merece un gran comienzo', 'Tu experiencia nos importa', 'Tu consultorio, a tu manera', 'Revisemos tu información'][step]}</h2><p>${['Crea tu identidad médica digital en unos pasos sencillos.', 'Registra tu formación y tus credenciales para su revisión.', 'Personaliza cómo, cuándo y dónde deseas atender.', 'Verifica cada dato y envía tu solicitud.'][step]}</p></div>
    <div class="mx55-bars" role="progressbar" aria-valuemin="0" aria-valuemax="4" aria-valuenow="${step + 1}">${STEPS.map((_, i) => `<span class="${i <= step ? 'active' : ''}"></span>`).join('')}</div>
    <div class="mx57-draft"><span>Tu avance se guarda en tu cuenta en cada paso.</span></div>
    <div class="mx58-section-kicker">${['01 / INFORMACIÓN PERSONAL', '02 / FORMACIÓN Y CÉDULAS', '03 / SERVICIOS Y CONSULTORIO', '04 / CONFIRMACIÓN'][step]}</div>
    <form class="mx55-fields" id="wizard-form" novalidate>${bodies[step]}</form>
    <div class="mx55-controls">${step > 0 ? '<button class="button" type="button" data-wiz-prev>← Anterior</button>' : '<span></span>'}${step < 3 ? '<button class="button primary" type="button" data-wiz-next>Guardar y continuar →</button>' : ''}</div>
    <p class="mx55-foot">MEXIA · Tecnología con inteligencia, salud con humanidad.</p></main>
    <aside class="mx55-side"><div class="mx55-aside-head"><span>ACOMPAÑAMIENTO MEXIA</span><h3>Tu camino profesional</h3><p>Una experiencia clara, segura y diseñada para ti.</p></div>${STEPS.map((s, i) => `<div class="mx55-milestone ${i === step ? 'current' : ''}"><span>${i < step ? '✓' : i + 1}</span><div><strong>${s}</strong><small>${['Información de contacto', 'Especialidad y cédula', 'Servicios y consultorio', 'Confirmación final'][i]}</small></div></div>`).join('')}<div class="mx55-note"><strong>Privacidad y confianza</strong><br>Tu perfil no se publicará sin una verificación profesional real.</div></aside></div></section>`;
}

async function saveWizardStep(ctx, root, step) {
  const f = readForm(root.querySelector('#wizard-form'));
  if (step === 0) {
    if (!f.name || f.name.trim().length < 3) throw new Error('Escribe tu nombre completo');
    if (!/^\d{10}$/.test(f.phone || '')) throw new Error('El teléfono debe tener 10 dígitos');
    await ctx.api.patch('/doctor/me', { name: f.name, phone: f.phone, registration_step: 1 });
    await ctx.api.patch('/doctor/me/draft', { displayName: f.name });
  } else if (step === 1) {
    if (!f.specialty) throw new Error('Indica tu especialidad');
    if (!/^\d{7,8}$/.test(f.license_number || '')) throw new Error('La cédula profesional debe tener 7 u 8 dígitos');
    await ctx.api.patch('/doctor/me', { ...numberOrEmpty(f, ['experience_years']), registration_step: 2 });
    await ctx.api.patch('/doctor/me/draft', { specialty: f.specialty, experienceYears: f.experience_years });
  } else if (step === 2) {
    if (!f.city) throw new Error('Indica la ciudad de atención');
    if (f.price === '') throw new Error('Indica el precio de la consulta');
    await ctx.api.patch('/doctor/me/draft', numberOrEmpty(f, ['price', 'duration']));
    await ctx.api.patch('/doctor/me', { registration_step: 3 });
  }
}

// ---------- Secciones del portal ----------
function dashboard(me, appts) {
  const p = me.professional, today = localISO();
  const todays = appts.filter((a) => a.start_at.slice(0, 10) === today && ['CONFIRMED', 'REQUESTED', 'COMPLETED'].includes(a.status));
  const pending = appts.filter((a) => a.status === 'REQUESTED');
  const confirmed = appts.filter((a) => a.status === 'CONFIRMED');
  const activeDays = new Set(me.availability.map((r) => r.weekday)).size;
  const first = (p.name || 'profesional').replace(/^(dra?\.?|doctora?)\s+/i, '').split(/\s+/)[0];
  return `${p.verification_status !== 'VERIFIED' ? `<div class="mx54-dashboard-banner"><span aria-hidden="true">◇</span><div><strong>${esc(VERIFICATION[p.verification_status])}</strong><p>Tu perfil no aparece en el directorio hasta que MEXIA verifique tus credenciales.</p></div><button class="button" data-go="portal" data-tab="verificacion">Ver estado →</button></div>` : ''}
  <div class="mx51-welcome mx61-hero"><div class="mx51-welcome-copy"><span class="mx51-eyebrow">MEXIA · TU CONSULTORIO DIGITAL</span><h2>Hola, ${esc(first)} <span aria-hidden="true">✳</span></h2><p>Tu tiempo transforma vidas. Gestiona tus consultas con una experiencia clara, humana y sencilla.</p><div class="mx51-hero-actions"><button class="button primary" data-go="portal" data-tab="consultas">Ver solicitudes →</button><button class="button" data-go="portal" data-tab="agenda">Mi agenda</button></div></div><div class="mx61-hero-visual" aria-hidden="true"><div class="mx61-hero-quote">“Cuidar de otros también es una forma de dejar huella.”</div></div></div>
  <div class="mx51-metrics"><div class="mx51-metric"><span class="mx51-metric-icon">▦</span><strong>${todays.length}</strong><small>Consultas hoy</small></div><div class="mx51-metric"><span class="mx51-metric-icon">◷</span><strong>${pending.length}</strong><small>Solicitudes pendientes</small></div><div class="mx51-metric"><span class="mx51-metric-icon">♡</span><strong>${confirmed.length}</strong><small>Citas confirmadas</small></div><div class="mx51-metric"><span class="mx51-metric-icon">✓</span><strong>${activeDays}</strong><small>Días activos</small></div></div>
  <div class="mx61-quick-actions" aria-label="Accesos rápidos"><button data-go="portal" data-tab="agenda"><span>▦</span> Ver agenda</button><button data-go="portal" data-tab="consultas"><span>✚</span> Solicitudes</button><button data-go="portal" data-tab="pacientes"><span>♡</span> Pacientes</button><button data-go="portal" data-tab="perfil"><span>♙</span> Mi perfil</button></div>
  <div class="mx51-dashboard-grid"><div class="mx51-main-stack">${todayAgenda(me, todays)}
    <div class="mx51-panel"><div class="mx51-panel-head"><h3>Solicitudes pendientes</h3><button class="mx51-text-link" data-go="portal" data-tab="consultas">Ver todas →</button></div>${pending.slice(0, 3).map((a) => `<div class="mx51-request"><span class="mx51-request-icon">✚</span><span><strong>${esc(a.patient_name)}</strong><small>${formatDateTime(a.start_at)}</small></span><button class="button" data-go="portal" data-tab="consultas">Revisar</button></div>`).join('') || '<p class="mx49-mini">No hay solicitudes pendientes.</p>'}</div></div>
    <div class="mx51-side-stack"><div class="mx51-panel"><div class="mx51-panel-head"><h3>Mi práctica</h3><span class="mx51-soft-tag">${esc(PROFILE_STATUS[me.publicProfile.status])}</span></div><p><strong>${esc(p.name)}</strong></p><p class="mx49-mini">${esc(p.specialty || '')} · ${esc(me.publicProfile.draft.city || 'Ubicación por definir')}</p><button class="button full" data-go="portal" data-tab="perfilPublico">Perfil público</button></div><div class="mx51-quote">“Cuidar de otros también es una forma de dejar huella.”</div></div></div>`;
}

function todayAgenda(me, todays) {
  const wd = (new Date().getDay() + 6) % 7;
  const enabled = me.availability.some((r) => r.weekday === wd);
  return `<div class="mx51-schedule"><div class="mx51-schedule-head"><div><h3>Agenda de hoy</h3><p class="mx49-mini">${formatDate(localISO(), { weekday: true })} · ${enabled ? 'Día de atención configurado' : 'Sin atención configurada para hoy'}</p></div><button class="button" data-go="portal" data-tab="agenda">Gestionar →</button></div>${todays.map((a) => `<button class="mx51-appointment mxa-row-btn" data-go="appointment" data-id="${a.id}"><span class="mx51-time">${hhmm(a.start_at)}</span><span class="mx51-appt-body"><strong>${esc(a.patient_name)}</strong><small>${a.mode === 'EN_LINEA' ? 'En línea' : 'Presencial'}</small></span>${statusChip(a.status)}</button>`).join('') || '<div class="mx51-empty">No tienes consultas para hoy.</div>'}</div>`;
}

function verification(me) {
  const p = me.professional;
  const done = me.checklist.filter((c) => c.ready).length;
  const creds = me.media.filter((m) => m.kind === 'CREDENTIAL');
  return `<section class="mx54-verification" aria-labelledby="mx54-title">
    <div class="mx54-hero"><div><span class="mx51-eyebrow">MEXIA PROFESIONALES · TU ACREDITACIÓN</span><h2 id="mx54-title">Centro de verificación</h2><p>Prepara tu información y consulta qué sigue para formar parte del directorio de MEXIA.</p></div><span class="mx54-shield" aria-hidden="true">◇</span></div>
    <div class="mx54-status" role="status"><span class="mx54-status-icon" aria-hidden="true">${p.verification_status === 'VERIFIED' ? '✓' : '◷'}</span><div><strong>${esc(VERIFICATION[p.verification_status])}</strong><p>${p.verification_status === 'VERIFIED' ? `Verificado el ${formatDate(p.verified_at)}. Ya puedes solicitar la publicación de tu perfil.` : p.verification_status === 'REJECTED' ? 'Revisa las observaciones, corrige tus datos y vuelve a enviar.' : p.verification_status === 'DRAFT' ? 'Completa tu registro y envía la solicitud.' : 'El equipo de MEXIA revisará tu identidad, cédula y especialidad.'}</p>${p.verification_notes ? `<p><strong>Observaciones:</strong> ${esc(p.verification_notes)}</p>` : ''}</div></div>
    <div class="mx54-layout"><div class="mx54-main"><div class="mx54-card"><div class="mx54-heading"><div><h3>Prepara tu perfil</h3><p>Datos declarados por ti.</p></div><strong>${done} de ${me.checklist.length}</strong></div><div class="mx54-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${me.checklist.length}" aria-valuenow="${done}"><span style="width:${(done / me.checklist.length) * 100}%"></span></div>
      <div class="mx54-items">${me.checklist.map((x) => `<div class="mx54-item"><span class="mx54-check ${x.ready ? 'done' : ''}" aria-hidden="true">${x.ready ? '✓' : '○'}</span><div><strong>${esc(x.name)}</strong><p>${esc(x.detail)}</p><small>${x.ready ? 'Información declarada' : 'Por completar'}</small></div><button class="button" data-go="portal" data-tab="${x.target}">${x.ready ? 'Revisar' : 'Completar'}</button></div>`).join('')}</div>
      ${['DRAFT', 'REJECTED'].includes(p.verification_status) ? '<label style="display:flex;gap:8px;margin-top:12px"><input type="checkbox" id="attest"> Declaro que la información es verdadera.</label><button class="button primary full" data-submit-verification style="margin-top:10px">Enviar a verificación</button>' : ''}</div></div>
    <aside class="mx54-side"><div class="mx54-card"><h3>Documentos de acreditación</h3><p>Se guardan en almacenamiento privado; solo el equipo de verificación los consulta.</p>
      ${creds.map((m) => `<div class="mx54-doc"><span aria-hidden="true">▤</span><div><strong>${esc(m.original_name || 'Documento')}</strong><small>${formatDate(m.created_at)}</small></div><button class="mini-button danger" data-del-media="${m.id}">Quitar</button></div>`).join('')}
      <form id="cred-form"><input type="hidden" name="kind" value="CREDENTIAL"><label class="mx49-mini">Cédula, título o identificación (PDF/imagen, máx. 8 MB)<input type="file" name="file" accept=".pdf,image/jpeg,image/png,image/webp" required></label><button class="button full" type="submit" style="margin-top:8px">Subir documento</button></form></div></aside></div>
  </section>`;
}

function profileEdit(me) {
  const p = me.professional, d = me.publicProfile.draft;
  const portrait = me.media.find((m) => m.kind === 'PORTRAIT');
  const facilities = me.media.filter((m) => m.kind === 'FACILITY');
  return `<div class="mx49-grid mx59-profile-edit">
    <form class="card" id="identity-form"><h3>Identidad y acreditación</h3>${identityFields(p)}${credentialFields(p)}<button class="button primary full" type="submit">Guardar identidad y credenciales</button></form>
    <form class="card" id="practice-form"><h3>Consultorio y servicios (borrador del perfil público)</h3>${practiceFields(d)}<div class="mx49-form"><div class="wide"><label for="pr-dn">Nombre público</label><input id="pr-dn" name="displayName" maxlength="120" value="${esc(d.displayName || p.name)}"></div></div><button class="button primary full" type="submit">Guardar borrador</button><p class="mx49-mini">Los pacientes verán estos cambios cuando se apruebe la publicación.</p></form></div>
  <div class="mx63-section"><div class="mx63-section-heading"><span class="mx51-eyebrow">PRESENCIA PROFESIONAL</span><h2>Fotografía e instalaciones</h2><p>Se guardan en tu cuenta y aparecen en tu perfil público al publicarse.</p></div>
    <div class="mx63-panel"><h3>Fotografía profesional</h3><div class="mx63-photo-preview">${portrait ? `<img src="${esc(portrait.url)}" alt="Tu retrato">` : '<span>Sin fotografía</span>'}</div>${portrait ? `<button class="button" data-del-media="${portrait.id}">Quitar fotografía</button>` : ''}<form data-media-form><input type="hidden" name="kind" value="PORTRAIT"><label>Seleccionar fotografía<input type="file" name="file" accept="image/jpeg,image/png,image/webp" required></label><button class="button" type="submit">Subir</button></form><p class="mx49-mini">Retrato de frente, iluminación natural y fondo neutro.</p></div>
    <div class="mx63-panel"><h3>Consultorios e instalaciones (${facilities.length}/6)</h3><div class="mx63-gallery">${facilities.map((m) => `<div class="mx63-photo-preview"><img src="${esc(m.url)}" alt="Instalaciones"><button class="mini-button danger" data-del-media="${m.id}">Quitar</button></div>`).join('') || '<p class="mx49-mini">Aún no hay fotografías.</p>'}</div>${facilities.length < 6 ? '<form data-media-form><input type="hidden" name="kind" value="FACILITY"><label>Agregar fotografía<input type="file" name="file" accept="image/jpeg,image/png,image/webp" required></label><button class="button" type="submit">Subir</button></form>' : ''}<p class="mx49-mini">Evita mostrar pacientes, expedientes o pantallas con información clínica.</p></div></div>`;
}

function bookingAside(prof) {
  return `<div class="mx64-card mx64-book"><h3>Agenda una consulta</h3><p class="mx49-mini">${esc(prof.city || 'Ubicación por definir')} · ${esc(prof.modeLabel)}</p><p><strong>${money(prof.price)}</strong> por consulta</p><div class="mx64-empty">Los pacientes verán aquí tus horarios disponibles calculados con tu agenda.</div></div>`;
}

function publicProfile(me, preview) {
  const pp = me.publicProfile, p = me.professional;
  const items = [preview.displayName, preview.specialty, preview.bio, preview.city, preview.price != null, preview.mode, preview.portrait, preview.gallery.length];
  const done = items.filter(Boolean).length;
  const canRequest = p.verification_status === 'VERIFIED' && pp.status !== 'PENDING_REVIEW';
  return `<section class="mx64-profile"><div class="mx64-head"><div><span class="mx51-eyebrow">MEXIA · IDENTIDAD PROFESIONAL</span><h2>Mi perfil público</h2><p class="mx49-mini">Edita tu presentación y visualiza cómo te verán los pacientes.</p></div><div class="mx64-actions"><button class="button" data-go="portal" data-tab="perfil">Editar mis datos</button><button class="button primary" data-go="portal" data-tab="vistaPrevia">Vista previa</button></div></div>
    <div class="mx64-card mx64-panel"><div class="mx64-head"><strong>Perfil completo: ${done} de 8 elementos</strong><span>${Math.round((done / 8) * 100)}%</span></div><div class="mx64-completion"><span style="width:${(done / 8) * 100}%"></span></div>
      <div class="mx64-control"><p class="mx49-mini"><strong>Estado: ${esc(PROFILE_STATUS[pp.status])}</strong>${pp.published_version ? ` · versión publicada #${pp.published_version} (${formatDate(pp.published_at)})` : ''}. ${p.verification_status !== 'VERIFIED' ? 'Podrás solicitar la publicación cuando tus credenciales estén verificadas.' : pp.status === 'PENDING_REVIEW' ? 'Tu solicitud está en revisión.' : 'Los cambios del borrador no son visibles hasta que se aprueben.'}</p>
      <div class="actions"><button class="button primary" data-publish ${canRequest ? '' : 'disabled'}>${pp.status === 'PUBLISHED' ? 'Publicar cambios del borrador' : 'Solicitar publicación'}</button>${pp.status === 'PUBLISHED' ? '<button class="button" data-withdraw>Retirar del directorio</button>' : ''}</div></div></div>
    <div class="mx64-layout"><div>${publicCard(preview, 'galeria')}</div><aside>${bookingAside(preview)}</aside></div></section>`;
}

function agendaSection(ctx, me, avail) {
  const r = ctx.ui.agenda || (ctx.ui.agenda = {
    interval: me.availability[0]?.slot_minutes || 30,
    days: Object.fromEntries(WEEK.map((_, i) => [i, me.availability.filter((x) => x.weekday === i).map((x) => ({ start: x.start_time.slice(0, 5), end: x.end_time.slice(0, 5) }))])),
  });
  return `<div class="mx51-panel-head mx51-section-head"><div><h2>Tu disponibilidad</h2><p class="mx49-mini">Define cuándo pueden solicitar una consulta contigo. Los huecos se calculan con la duración de tu consulta.</p></div></div>
  <div class="mx51-agenda-forms"><div class="card"><h3>Franjas de atención por día</h3>
    <div class="mx49-form"><div><label for="ag-int">Intervalo entre inicios de cita</label><select id="ag-int">${[15, 20, 30, 45, 60].map((x) => opt(x, r.interval, x + ' minutos')).join('')}</select></div></div>
    <div class="mx62-schedule-editor">${WEEK.map((day, i) => `<div class="mx62-day"><div class="mx62-day-head"><strong>${day}</strong><button type="button" class="button" data-ag-add="${i}">+ Agregar horario</button></div><div class="mx62-range-list">${r.days[i].map((x, j) => `<div class="mx62-range"><label>Desde<input type="time" data-ag-start="${i}:${j}" value="${esc(x.start)}"></label><label>Hasta<input type="time" data-ag-end="${i}:${j}" value="${esc(x.end)}"></label><button type="button" class="button" data-ag-remove="${i}:${j}" aria-label="Quitar franja de ${day}">Quitar</button></div>`).join('')}</div></div>`).join('')}</div>
    <button class="button primary full" style="margin-top:15px" data-ag-save>Guardar disponibilidad</button></div>
  <form class="card" id="timeoff-form"><h3>Bloquear fechas</h3><div class="mx49-form"><div><label for="to-d">Desde</label><input id="to-d" name="date" type="date" min="${localISO()}" required></div><div><label for="to-u">Hasta (opcional)</label><input id="to-u" name="until" type="date" min="${localISO()}"></div><div class="wide"><label for="to-r">Motivo (privado)</label><input id="to-r" name="reason" maxlength="200"></div><div style="align-self:end"><button class="button full" type="submit">Bloquear</button></div></div>
    <div class="mx49-mini">${avail.timeOff.map((t) => `<span style="display:inline-block;margin:5px"><button type="button" class="button" data-unblock="${t.id}">${formatDate(t.start_at)}${t.start_at.slice(0, 10) !== t.end_at.slice(0, 10) ? ' → ' + formatDate(t.end_at) : ''} ×</button></span>`).join('') || 'Sin fechas bloqueadas'}</div></form></div>`;
}

function requests(appts, filter) {
  const list = appts.filter((a) => filter === 'ALL' || a.status === filter);
  return `<div class="card"><h3>Solicitudes y consultas</h3><p class="mx49-mini">El acceso a expedientes requiere autorización específica del paciente por episodio.</p>
    <div class="trusted-tabs" role="group">${[['REQUESTED', 'Pendientes'], ['CONFIRMED', 'Confirmadas'], ['COMPLETED', 'Atendidas'], ['ALL', 'Todas']].map(([k, l]) => `<button class="${filter === k ? 'active' : ''}" data-appt-filter="${k}">${l}</button>`).join('')}</div>
    ${list.map((a) => `<div class="summary-row"><div class="item-top"><strong>${formatDateTime(a.start_at)}</strong>${statusChip(a.status)}</div><p class="small">${esc(a.patient_name)} · ${a.mode === 'EN_LINEA' ? 'En línea' : 'Presencial'} · ${money(a.price_mxn)}</p>${a.reason ? `<p class="mx49-mini">Motivo: ${esc(a.reason)}</p>` : ''}<p class="mx49-mini">${a.has_grant ? '📋 El paciente compartió un episodio contigo.' : 'Sin episodio compartido.'}</p>
      <div class="actions">${a.status === 'REQUESTED' ? `<button class="button primary" data-appt="CONFIRMED:${a.id}:${a.version}">Aceptar</button><button class="button" data-appt="REJECTED:${a.id}:${a.version}">Rechazar</button>` : ''}${a.status === 'CONFIRMED' ? `<button class="button primary" data-appt="COMPLETED:${a.id}:${a.version}">Marcar atendida</button><button class="button" data-appt="NO_SHOW:${a.id}:${a.version}">No asistió</button><button class="button" data-appt="CANCELLED:${a.id}:${a.version}">Cancelar</button>` : ''}${a.has_grant && a.episode_id ? `<button class="button" data-go="portal" data-tab="episodio" data-episode="${a.episode_id}">Ver episodio</button>` : ''}<button class="button" data-go="appointment" data-id="${a.id}">Detalle y mensajes</button></div></div>`).join('') || '<p class="muted">No hay consultas en esta categoría.</p>'}</div>`;
}

function patients(list) {
  return `<div class="card"><h3>Mis pacientes</h3><p class="mx49-mini">Pacientes con cita contigo. Solo ves datos clínicos de los episodios que te compartieron y mientras la autorización esté vigente.</p>
    ${list.map((p) => `<div class="summary-row"><strong>${esc(p.name)}</strong><p class="mx49-mini">${p.appointments} cita(s) · ${p.completed} atendida(s) · última ${formatDate(p.last_appointment)}</p>${p.sharedEpisodes.map((g) => `<button class="button" data-go="portal" data-tab="episodio" data-episode="${g.episode_id}">📋 ${esc(g.title)} · ${g.scope === 'FULL' ? 'completo' : 'resumen'} · vence ${formatDate(g.expires_at)}</button>`).join(' ') || '<p class="mx49-mini">Sin episodios compartidos.</p>'}</div>`).join('') || '<p class="muted">Sin pacientes vinculados todavía.</p>'}</div>`;
}

function episodeView(ep) {
  return `<div class="card"><span class="mx51-eyebrow">EPISODIO COMPARTIDO · ${ep.scope === 'FULL' ? 'COMPLETO' : 'RESUMEN'}</span><h2>${esc(ep.title)}</h2><p class="mx49-mini">Paciente: ${esc(ep.patient_name)} · Inicio ${formatDate(ep.start_date)}${ep.onset_reported ? ` (${esc(ep.onset_reported)})` : ''} · ${ep.status === 'ACTIVE' ? 'En seguimiento' : 'Cerrado'} · acceso vigente hasta ${formatDate(ep.expires_at)}</p>
    <h3>Síntomas</h3>${ep.symptoms.map((s) => `<div class="summary-row"><strong>${esc(s.name)}</strong><p class="mx49-mini">${s.intensity ?? '–'}/10 · ${esc(s.evolution || '')} · ${esc(s.location || 'sin ubicación')}${s.side ? ' (' + esc(s.side) + ')' : ''} · desde ${formatDate(s.onset_date)}</p>${s.notes ? `<p class="small">${esc(s.notes)}</p>` : ''}</div>`).join('') || '<p class="mx49-mini">Sin síntomas.</p>'}
    <h3>Evolución</h3>${ep.followups.map((f) => `<p class="mx49-mini">${formatDate(f.recorded_at)} · ${f.intensity ?? '–'}/10 ${esc(f.evolution || '')} ${f.note ? '· ' + esc(f.note) : ''}</p>`).join('') || '<p class="mx49-mini">Sin seguimientos.</p>'}
    ${ep.medications ? `<h3>Medicamentos registrados por el paciente</h3>${ep.medications.map((m) => `<p class="mx49-mini">💊 ${esc(m.title)} · ${esc(m.repeat_mode)} desde ${formatDate(m.event_date)} ${m.notes ? '· ' + esc(m.notes) : ''}</p>`).join('') || '<p class="mx49-mini">Sin medicamentos.</p>'}` : ''}
    <p class="mx49-mini">Esta consulta quedó registrada en la bitácora de accesos del paciente.</p><button class="button" data-go="portal" data-tab="pacientes">← Mis pacientes</button></div>`;
}

function statistics(s) {
  const max = Math.max(1, ...s.days.map((d) => d.CONFIRMED + d.COMPLETED));
  return `<div class="mx63-section"><div class="mx63-section-heading"><span class="mx51-eyebrow">ANÁLISIS DE ACTIVIDAD</span><h2>Estadísticas de consultas</h2><p>Semana del ${formatDate(s.start)} al ${formatDate(s.end)} · zona horaria ${esc(s.timezone)}.</p></div>
    <div class="actions"><button class="button" data-week="-7">‹ Semana anterior</button><button class="button" data-week="7">Semana siguiente ›</button></div>
    <div class="mx63-kpis"><div class="mx63-kpi"><span>Solicitadas (sin responder)</span><strong>${s.totals.requested}</strong></div><div class="mx63-kpi"><span>Confirmadas</span><strong>${s.totals.confirmed}</strong></div><div class="mx63-kpi"><span>Atendidas</span><strong>${s.totals.completed}</strong></div><div class="mx63-kpi"><span>Canceladas</span><strong>${s.totals.cancelled}</strong></div><div class="mx63-kpi"><span>Rechazadas</span><strong>${s.totals.rejected}</strong></div><div class="mx63-kpi"><span>No asistió</span><strong>${s.totals.noShow}</strong></div></div>
    <div class="mx63-panel"><h3>Confirmadas + atendidas por día</h3><div class="mx63-bars" role="img" aria-label="Consultas por día">${s.days.map((d, i) => { const t = d.CONFIRMED + d.COMPLETED; return `<div class="mx63-bar-item"><strong>${t}</strong><span class="mx63-bar-track"><span style="height:${Math.max(3, (100 * t) / max)}%"></span></span><small>${['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'][i]}</small></div>`; }).join('')}</div>
    <p class="mx49-mini">Solicitudes pendientes en todas las fechas: ${s.pendingAllDates}. Una cita confirmada no cuenta como atendida hasta que la marcas como tal.</p></div></div>`;
}

function messagesSection(appts) {
  const list = appts.filter((a) => ['CONFIRMED', 'COMPLETED'].includes(a.status));
  return `<div class="mx63-section"><div class="mx63-section-heading"><span class="mx51-eyebrow">CONTACTO PROFESIONAL</span><h2>Mensajes con pacientes</h2><p>Solo con pacientes que tienen una cita confirmada o atendida contigo.</p></div><div class="mx63-panel"><h3>Conversaciones habilitadas</h3>
    ${list.map((a) => `<button class="mx63-conversation mxa-row-btn" data-go="appointment" data-id="${a.id}"><div class="mx63-conversation-top"><div><strong>${esc(a.patient_name)}</strong><p class="mx49-mini">${formatDateTime(a.start_at)}</p></div>${statusChip(a.status)}</div></button>`).join('') || '<p class="mx49-mini">No hay citas confirmadas todavía.</p>'}</div></div>`;
}

// ---------- Pantalla ----------
export default {
  portal: {
    role: 'DOCTOR', hideHome: true,
    async render(ctx) {
      const me = await ctx.api.get('/doctor/me');
      ctx.ui.me = me;
      const p = me.professional;
      if (p.verification_status === 'DRAFT' && !p.attested_at) return wizard(ctx, me);
      const tab = ctx.params.tab || 'resumen';
      let content = '';
      if (tab === 'resumen') content = dashboard(me, await ctx.api.get('/doctor/me/appointments'));
      else if (tab === 'verificacion') content = verification(me);
      else if (tab === 'perfil') content = profileEdit(me);
      else if (tab === 'perfilPublico') content = publicProfile(me, await ctx.api.get('/doctor/me/preview'));
      else if (tab === 'vistaPrevia') {
        const prev = await ctx.api.get('/doctor/me/preview');
        const device = ctx.ui.previewDevice || 'mobile';
        content = `<section class="mx64-profile"><div class="mx64-head"><div><span class="mx51-eyebrow">VISTA DEL PACIENTE</span><h2>Vista previa de mi perfil</h2></div><button class="button" data-go="portal" data-tab="perfilPublico">← Volver</button></div><div class="mx64-demo">Así se verá tu borrador al publicarse. Es la misma tarjeta que ve el paciente.</div><div class="mx64-control"><button class="button" data-device="mobile">📱 Celular</button><button class="button" data-device="desktop">▣ Computadora</button></div><div class="mx64-preview-device ${device}"><div class="mx64-layout"><div>${publicCard(prev, ctx.ui.doctorProfileTab || 'galeria')}</div><aside>${bookingAside(prev)}</aside></div></div></section>`;
      } else if (tab === 'agenda') {
        const [appts, avail] = await Promise.all([ctx.api.get(`/doctor/me/appointments?from=${localISO()}&to=${localISO()}`), ctx.api.get('/doctor/me/availability')]);
        content = todayAgenda(me, appts.filter((a) => ['CONFIRMED', 'REQUESTED', 'COMPLETED'].includes(a.status))) + agendaSection(ctx, me, avail);
      } else if (tab === 'consultas') content = requests(await ctx.api.get('/doctor/me/appointments'), ctx.ui.apptFilter || 'REQUESTED');
      else if (tab === 'pacientes') content = patients(await ctx.api.get('/doctor/me/patients'));
      else if (tab === 'episodio') {
        try { content = episodeView(await ctx.api.get(`/doctor/episodes/${ctx.params.episode}`)); } catch (e) { content = `<div class="card"><h3>Acceso no disponible</h3><p>${esc(e.message)}</p><button class="button" data-go="portal" data-tab="pacientes">← Mis pacientes</button></div>`; }
      } else if (tab === 'mensajes') content = messagesSection(await ctx.api.get('/doctor/me/appointments'));
      else if (tab === 'estadisticas') content = statistics(await ctx.api.get(`/doctor/me/stats${ctx.ui.statsWeek ? '?week=' + ctx.ui.statsWeek : ''}`));
      const first = (p.name || '').split(/\s+/)[0] || 'M';
      const navBtn = ([id, label, sym]) => `<button data-go="portal" data-tab="${id}" class="${tab === id ? 'active' : ''}" ${tab === id ? 'aria-current="page"' : ''}><span class="mx51-nav-symbol" aria-hidden="true">${sym}</span>${label}</button>`;
      return `<section class="mx49-portal mx51-portal"><div class="mx51-layout">
        <aside class="mx51-sidebar"><div class="mx51-brand"><span class="mx51-brand-mark">✳</span><span>MEXIA<small>PORTAL MÉDICO</small></span></div><div class="mx51-side-label">TU CONSULTORIO</div><nav class="mx51-side-nav" aria-label="Navegación profesional">${TABS.map(navBtn).join('')}</nav><div class="mx51-side-footer"><span class="mx51-soft-tag">${esc(VERIFICATION[p.verification_status])}</span></div></aside>
        <div class="mx51-workspace"><div class="mx51-topbar"><div class="mx51-mobile-brand">✳ MEXIA <small>PROFESIONALES</small></div><div class="mx51-topbar-text">Mi consultorio digital</div><div class="mx51-topbar-actions"><span class="mx51-top-status">${esc(PROFILE_STATUS[me.publicProfile.status])} · ${esc(VERIFICATION[p.verification_status])}</span><span class="mx51-avatar" aria-hidden="true">${esc(first.slice(0, 1).toUpperCase())}</span></div></div>
        <nav class="mx51-mobile-nav" aria-label="Secciones del portal">${TABS.map(([id, label]) => `<button data-go="portal" data-tab="${id}" class="${tab === id ? 'active' : ''}">${label}</button>`).join('')}</nav>
        <div class="mx51-content">${content}</div></div></div>
        <nav class="mx60-bottom-nav" aria-label="Navegación principal médica">${[['resumen', 'Inicio', '⌂'], ['agenda', 'Agenda', '▦'], ['consultas', 'Citas', '◷'], ['pacientes', 'Pacientes', '♡'], ['perfilPublico', 'Perfil', '▧']].map(([id, l, s]) => `<button data-go="portal" data-tab="${id}" class="${tab === id ? 'active' : ''}"><span class="mx60-icon">${s}</span>${l}</button>`).join('')}</nav></section>`;
    },
    mount(root, ctx) {
      const me = ctx.ui.me;
      const reload = () => ctx.render();
      const act = (btn, fn, ok) => busy(btn, async () => { try { await fn(); if (ok) toast(ok); reload(); } catch (e) { toastError(e); } });

      // Registro
      root.querySelector('[data-wiz-prev]')?.addEventListener('click', () => { ctx.ui.regStep--; reload(); });
      root.querySelector('[data-wiz-next]')?.addEventListener('click', (e) => busy(e.currentTarget, async () => {
        try { await saveWizardStep(ctx, root, ctx.ui.regStep); ctx.ui.regStep++; reload(); window.scrollTo(0, 0); } catch (err) { toastError(err); }
      }));
      root.querySelector('[data-submit-verification]')?.addEventListener('click', (e) => {
        if (!root.querySelector('#attest')?.checked) return toast('Marca la declaración de veracidad para continuar', 'error');
        act(e.currentTarget, () => ctx.api.post('/doctor/me/submit-verification', { attest: true }), 'Solicitud enviada a verificación');
      });

      // Perfil
      const formSubmit = (sel, fn, ok) => { const f = root.querySelector(sel); f?.addEventListener('submit', (e) => { e.preventDefault(); act(f.querySelector('[type=submit]'), () => fn(readForm(f)), ok); }); };
      formSubmit('#identity-form', (b) => ctx.api.patch('/doctor/me', numberOrEmpty(b, ['experience_years'])), 'Datos guardados');
      formSubmit('#practice-form', (b) => ctx.api.patch('/doctor/me/draft', numberOrEmpty(b, ['price', 'duration'])), 'Borrador guardado');
      root.querySelectorAll('[data-media-form], #cred-form').forEach((f) => f.addEventListener('submit', (e) => {
        e.preventDefault();
        const file = f.querySelector('[type=file]').files[0];
        if (!file) return toast('Selecciona un archivo', 'error');
        if (file.size > 8 * 1024 * 1024) return toast('El archivo supera 8 MB', 'error');
        act(f.querySelector('[type=submit]'), () => ctx.api.upload('/doctor/me/media', new FormData(f)), 'Archivo guardado');
      }));
      root.querySelectorAll('[data-del-media]').forEach((b) => b.addEventListener('click', () => {
        if (confirm('¿Quitar este archivo? Se retirará también de tu perfil publicado.')) act(b, () => ctx.api.del(`/doctor/me/media/${b.dataset.delMedia}`), 'Archivo eliminado');
      }));
      root.querySelector('[data-publish]')?.addEventListener('click', (e) => act(e.currentTarget, () => ctx.api.post('/doctor/me/publish-request'), 'Solicitud de publicación enviada'));
      root.querySelector('[data-withdraw]')?.addEventListener('click', (e) => { if (confirm('Tu perfil dejará de aparecer en el directorio. ¿Continuar?')) act(e.currentTarget, () => ctx.api.post('/doctor/me/withdraw'), 'Perfil retirado'); });
      root.querySelectorAll('[data-device]').forEach((b) => b.addEventListener('click', () => { ctx.ui.previewDevice = b.dataset.device; reload(); }));
      root.querySelectorAll('[data-profile-tab]').forEach((b) => b.addEventListener('click', () => { ctx.ui.doctorProfileTab = b.dataset.profileTab; reload(); }));

      // Agenda
      const ag = ctx.ui.agenda;
      if (ag) {
        const sync = () => {
          root.querySelectorAll('[data-ag-start]').forEach((i) => { const [d, j] = i.dataset.agStart.split(':'); ag.days[d][j].start = i.value; });
          root.querySelectorAll('[data-ag-end]').forEach((i) => { const [d, j] = i.dataset.agEnd.split(':'); ag.days[d][j].end = i.value; });
          const iv = root.querySelector('#ag-int'); if (iv) ag.interval = Number(iv.value);
        };
        root.querySelectorAll('[data-ag-add]').forEach((b) => b.addEventListener('click', () => { sync(); const list = ag.days[b.dataset.agAdd]; const last = list[list.length - 1]; list.push(last ? { start: last.end, end: last.end < '20:00' ? String(Number(last.end.slice(0, 2)) + 2).padStart(2, '0') + last.end.slice(2) : '21:00' } : { start: '09:00', end: '14:00' }); reload(); }));
        root.querySelectorAll('[data-ag-remove]').forEach((b) => b.addEventListener('click', () => { sync(); const [d, j] = b.dataset.agRemove.split(':'); ag.days[d].splice(Number(j), 1); reload(); }));
        root.querySelector('[data-ag-save]')?.addEventListener('click', (e) => {
          sync();
          const rules = Object.entries(ag.days).flatMap(([d, list]) => list.filter((x) => x.start && x.end).map((x) => ({ weekday: Number(d), start_time: x.start, end_time: x.end, slot_minutes: ag.interval })));
          act(e.currentTarget, async () => { await ctx.api.put('/doctor/me/availability', { rules }); ctx.ui.agenda = null; }, 'Disponibilidad guardada');
        });
      }
      formSubmit('#timeoff-form', (b) => ctx.api.post('/doctor/me/time-off', b), 'Fecha bloqueada');
      root.querySelectorAll('[data-unblock]').forEach((b) => b.addEventListener('click', () => act(b, () => ctx.api.del(`/doctor/me/time-off/${b.dataset.unblock}`), 'Bloqueo eliminado')));

      // Consultas
      root.querySelectorAll('[data-appt-filter]').forEach((b) => b.addEventListener('click', () => { ctx.ui.apptFilter = b.dataset.apptFilter; reload(); }));
      root.querySelectorAll('[data-appt]').forEach((b) => b.addEventListener('click', () => {
        const [status, id, version] = b.dataset.appt.split(':');
        let reason = null;
        if (['REJECTED', 'CANCELLED'].includes(status)) { reason = prompt('Motivo para el paciente (opcional):') ; if (reason === null) return; }
        act(b, () => ctx.api.patch(`/appointments/${id}/status`, { status, version: Number(version), reason }), 'Cita actualizada');
      }));
      root.querySelectorAll('[data-episode]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); ctx.go('portal', { tab: 'episodio', episode: b.dataset.episode }); }, true));

      // Estadísticas
      root.querySelectorAll('[data-week]').forEach((b) => b.addEventListener('click', () => {
        const base = ctx.ui.statsWeek || localISO();
        const d = new Date(base + 'T12:00:00'); d.setDate(d.getDate() + Number(b.dataset.week));
        ctx.ui.statsWeek = localISO(d); reload();
      }));
      void me;
    },
  },
};
