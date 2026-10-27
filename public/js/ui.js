// Utilidades de interfaz compartidas por todas las pantallas.

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const pad = (n) => String(n).padStart(2, '0');
export const localISO = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const addDaysISO = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return localISO(d); };

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export const WEEK = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

export function formatDate(iso, { weekday = false } = {}) {
  if (!iso) return '—';
  const d = new Date(String(iso).slice(0, 10) + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return esc(iso);
  return `${weekday ? WEEKDAYS[d.getDay()] + ' ' : ''}${d.getDate()} de ${MONTHS[d.getMonth()]} de ${d.getFullYear()}`;
}
export const formatShort = (iso) => { const d = new Date(String(iso).slice(0, 10) + 'T12:00:00'); return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`; };
export const hhmm = (dt) => String(dt || '').slice(11, 16) || String(dt || '').slice(0, 5);
export const formatDateTime = (dt) => `${formatDate(dt, { weekday: true })} · ${hhmm(dt)} h`;
export const money = (n) => (n === null || n === undefined || n === '' ? 'Precio por definir' : `$${Number(n).toLocaleString('es-MX', { maximumFractionDigits: 2 })} MXN`);
export const monthLabel = (y, m) => `${MONTHS[m]} ${y}`;

export const STATUS = {
  REQUESTED: ['Solicitada', 'warn'], CONFIRMED: ['Confirmada', 'ok'], REJECTED: ['Rechazada', 'off'],
  CANCELLED: ['Cancelada', 'off'], COMPLETED: ['Atendida', 'ok'], NO_SHOW: ['No asistió', 'off'],
};
export const statusChip = (s) => `<span class="mxa-chip mxa-chip--${(STATUS[s] || ['', ''])[1]}">${esc((STATUS[s] || [s])[0])}</span>`;

export const VERIFICATION = {
  DRAFT: 'Registro incompleto', PENDING_REVIEW: 'Pendiente de verificación', VERIFIED: 'Credenciales verificadas',
  REJECTED: 'Verificación rechazada', SUSPENDED: 'Cuenta suspendida',
};
export const PROFILE_STATUS = { DRAFT: 'Borrador', PENDING_REVIEW: 'Publicación en revisión', PUBLISHED: 'Publicado', WITHDRAWN: 'Retirado' };
export const MODES = { PRESENCIAL: 'Presencial', EN_LINEA: 'En línea', AMBAS: 'Presencial y en línea' };

/** Botones Atrás / Continuar con el mismo formato del prototipo */
export function nav(back, next, label = 'Continuar') {
  return `<div class="actions">${back ? `<button class="button" data-go="${back}">Atrás</button>` : ''}${next ? `<button class="button primary" data-go="${next}">${label}</button>` : ''}</div>`;
}

export const CAL_STICKERS = {
  Consulta: ['🩺', 'consulta'], Medicamento: ['💊', 'medicamento'], Estudio: ['🧪', 'estudio'], Terapia: ['🪷', 'terapia'],
  'Vacunación': ['💉', 'vacuna'], Ejercicio: ['👟', 'ejercicio'], 'Alimentación': ['🍎', 'alimentacion'], 'Sueño': ['🌙', 'sueno'],
  'Hidratación': ['💧', 'hidratacion'], Seguimiento: ['📋', 'seguimiento'], Otro: ['📌', 'general'],
};
export const CAL_TYPES = Object.keys(CAL_STICKERS);
export function calSticker(ev, small = false) {
  const [symbol, kind] = CAL_STICKERS[ev.type] || ['📅', 'general'];
  return `<span class="mx-sticker mx-sticker--${kind} ${small ? 'mx-sticker--mini' : ''}" aria-hidden="true"><span class="mx-sticker-art">${symbol}</span></span>`;
}

const FACE = {
  bien: '<path d="M33 35v3M67 35v3"/><path d="M27 43q23 25 46 0"/>',
  regular: '<path d="M33 35v3M67 35v3"/><path d="M29 53h42"/>',
  mal: '<path d="M33 35v3M67 35v3"/><path d="M28 62q22-24 44 0"/>',
};
export const face = (v) => `<span class="mx44-face mx44-${v}" aria-hidden="true"><svg viewBox="0 0 100 100" focusable="false"><circle class="mx44-disc" cx="50" cy="50" r="46"/><circle class="mx44-shine" cx="34" cy="21" r="13"/><g class="mx44-expression">${FACE[v]}</g></svg></span>`;
export const PULSE_LABEL = { bien: 'Bien', regular: 'Regular', mal: 'Mal' };

// ---------- Avisos ----------
let toastTimer;
export function toast(msg, kind = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.dataset.kind = kind;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, kind === 'error' ? 6000 : 3500);
}
export const toastError = (e) => toast(e?.message || 'Ocurrió un error', 'error');

/** Lee los campos con atributo name dentro de un contenedor */
export function readForm(root) {
  const out = {};
  root.querySelectorAll('[name]').forEach((el) => {
    if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; return; }
    if (el.type === 'checkbox') { out[el.name] = el.checked; return; }
    if (el.type === 'file') return;
    out[el.name] = el.value;
  });
  return out;
}

/** Deshabilita un botón mientras corre una promesa (evita dobles envíos) */
export async function busy(btn, fn) {
  if (btn?.disabled) return;
  const label = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }
  try { return await fn(); } finally {
    if (btn && btn.isConnected) { btn.disabled = false; btn.removeAttribute('aria-busy'); btn.innerHTML = label; }
  }
}

/** Gráfica de evolución (intensidad 0–10) como SVG simple */
export function intensityChart(points) {
  if (!points.length) return '<p class="ct-muted">Aún no hay registros de intensidad.</p>';
  const w = 320, h = 140, px = 28, py = 16;
  const n = points.length;
  const x = (i) => px + (n === 1 ? (w - 2 * px) / 2 : (i * (w - 2 * px)) / (n - 1));
  const y = (v) => h - py - (v / 10) * (h - 2 * py);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.intensity).toFixed(1)}`).join(' ');
  return `<svg class="mxa-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Evolución de intensidad: ${points.map((p) => p.intensity).join(', ')}">
    ${[0, 5, 10].map((v) => `<line x1="${px}" x2="${w - px}" y1="${y(v)}" y2="${y(v)}" class="mxa-chart-grid"/><text x="4" y="${y(v) + 4}" class="mxa-chart-label">${v}</text>`).join('')}
    <path d="${path}" class="mxa-chart-line"/>
    ${points.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.intensity)}" r="4" class="mxa-chart-dot"><title>${esc(formatShort(p.recorded_at))}: ${p.intensity}/10</title></circle>`).join('')}
  </svg>`;
}

export const emptyCard = (title, text = '') => `<div class="card"><strong>${esc(title)}</strong>${text ? `<p class="small muted">${esc(text)}</p>` : ''}</div>`;
