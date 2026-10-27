// Service worker de MEXIA.
// - Precarga el "shell" (HTML, CSS, JS, imágenes) para abrir sin conexión.
// - NUNCA guarda en caché respuestas de /api ni /media de documentos: los datos de salud
//   viven solo en el servidor y no quedan almacenados en el dispositivo.
const VERSION = 'mexia-v1.0.0';
const SHELL = [
  '/', '/index.html', '/manifest.webmanifest',
  '/css/styles.css', '/css/app.css',
  '/js/app.js', '/js/api.js', '/js/ui.js',
  '/js/screens/auth.js', '/js/screens/patient.js', '/js/screens/episodes.js', '/js/screens/calendar.js',
  '/js/screens/doctors.js', '/js/screens/portal.js', '/js/screens/admin.js',
  '/img/brand-icon.png', '/img/reference-orb.png', '/img/reference-onboard.png', '/img/reference-permission.png',
  '/img/icon-192.png', '/img/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;            // datos: siempre a la red
  if (url.pathname.startsWith('/media/')) return;          // fotos de perfiles: red

  // Navegación: red primero, si falla se usa el shell
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/index.html')));
    return;
  }
  // Recursos estáticos: caché primero, actualizando en segundo plano
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const net = fetch(e.request).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});
