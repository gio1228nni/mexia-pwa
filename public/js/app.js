// MEXIA PWA · núcleo: sesión, enrutador por hash y delegación de eventos.
import { api } from './api.js';
import { toast, toastError, esc } from './ui.js';
import authScreens from './screens/auth.js';
import patientScreens from './screens/patient.js';
import episodeScreens from './screens/episodes.js';
import calendarScreens from './screens/calendar.js';
import doctorsScreens from './screens/doctors.js';
import portalScreens from './screens/portal.js';
import adminScreens from './screens/admin.js';

/**
 * Cada pantalla: { role, render(ctx) → html | Promise<html>, mount?(root, ctx), hideHome? }
 * role: 'PUBLIC' (sin sesión), 'PATIENT', 'DOCTOR', 'ADMIN' o 'ANY' (cualquier sesión)
 */
const routes = {
  ...authScreens, ...patientScreens, ...episodeScreens, ...calendarScreens,
  ...doctorsScreens, ...portalScreens, ...adminScreens,
};

const screen = document.getElementById('screen');
const globalHome = document.getElementById('globalHome');

export const session = { user: null, profile: null, professional: null };
// Estado de interfaz que sobrevive entre pantallas (borradores de formularios, filtros…)
export const ui = {};

function homeFor() {
  if (!session.user) return 'welcome';
  if (session.user.role === 'ADMIN') return 'admin';
  if (session.user.role === 'DOCTOR') return 'portal';
  return session.profile?.onboarding_done ? 'home' : 'permissions';
}

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const [name, id] = path.split('/');
  const params = Object.fromEntries(new URLSearchParams(query));
  if (id) params.id = decodeURIComponent(id);
  return { name: name || '', params };
}

export function go(name, params = {}) {
  const { id, ...rest } = params;
  const qs = new URLSearchParams(rest).toString();
  const hash = `#/${name}${id !== undefined && id !== null ? '/' + encodeURIComponent(id) : ''}${qs ? '?' + qs : ''}`;
  if (location.hash === hash) render();
  else location.hash = hash;
}

let renderSeq = 0;
export async function render() {
  const seq = ++renderSeq;
  let { name, params } = parseHash();
  if (!routes[name]) name = homeFor();
  const route = routes[name];

  // Control de acceso en el cliente (la autorización real está en el servidor)
  if (route.role === 'PUBLIC' && session.user) return go(homeFor());
  if (route.role !== 'PUBLIC' && !session.user) return go('login');
  if (!['PUBLIC', 'ANY'].includes(route.role) && route.role !== session.user.role) return go(homeFor());

  const ctx = { name, params, session, ui, go, render, refreshSession, api };
  try {
    const html = await route.render(ctx);
    if (seq !== renderSeq) return;   // el usuario ya navegó a otra pantalla
    screen.innerHTML = html;
    screen.classList.toggle('mx30-reading', !!session.profile?.easy_reading);
    route.mount?.(screen, ctx);
  } catch (e) {
    if (seq !== renderSeq) return;
    if (e.status === 401) return;
    screen.innerHTML = `<section><div class="badge">MEXIA</div><h2>No pudimos cargar esta sección</h2>
      <div class="card"><p>${esc(e.message || 'Error inesperado')}</p>
      <div class="actions"><button class="button primary" data-retry>Reintentar</button><button class="button" data-go="${homeFor()}">Ir al inicio</button></div></div></section>`;
    screen.querySelector('[data-retry]')?.addEventListener('click', render);
  }
  const hide = route.hideHome || ['PUBLIC'].includes(route.role) || name === homeFor();
  globalHome.style.display = hide ? 'none' : 'grid';
  updateSessionBadge();
}

export async function refreshSession() {
  const data = await api.get('/auth/me');
  session.user = data.user || null;
  session.profile = data.profile || null;
  session.professional = data.professional || null;
  return session;
}

function updateSessionBadge() {
  const b = document.getElementById('sessionBadge');
  if (!session.user) { b.hidden = true; return; }
  b.hidden = false;
  b.textContent = `${session.user.name.split(' ')[0]} · Salir`;
  b.title = 'Cerrar sesión';
}

// ---------- Delegación global ----------
document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-go]');
  if (!el || !screen.contains(el) && el.id !== 'globalHome') return;
  ev.preventDefault();
  const params = {};
  if (el.dataset.id) params.id = el.dataset.id;
  if (el.dataset.tab) params.tab = el.dataset.tab;
  go(el.dataset.go, params);
});

globalHome.addEventListener('click', () => go(homeFor()));

document.getElementById('sessionBadge').addEventListener('click', async () => {
  if (!confirm('¿Cerrar sesión en este dispositivo?')) return;
  try { await api.post('/auth/logout'); } catch { /* sin conexión: se limpia igual */ }
  Object.assign(session, { user: null, profile: null, professional: null });
  for (const k of Object.keys(ui)) delete ui[k];
  go('login');
  toast('Sesión cerrada');
});

window.addEventListener('mexia:unauthenticated', () => {
  if (!session.user) return;
  Object.assign(session, { user: null, profile: null, professional: null });
  toast('Tu sesión terminó. Vuelve a iniciar sesión.', 'error');
  go('login');
});

window.addEventListener('hashchange', () => { render(); window.scrollTo({ top: 0 }); });

const offline = document.getElementById('offlineBadge');
const syncOnline = () => { offline.hidden = navigator.onLine; };
window.addEventListener('online', syncOnline);
window.addEventListener('offline', syncOnline);
syncOnline();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ---------- Arranque ----------
(async () => {
  try { await refreshSession(); } catch (e) { toastError(e); }
  render();
})();
