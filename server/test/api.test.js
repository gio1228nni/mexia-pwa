// Pruebas de integración contra un servidor en marcha (npm start) y una BD de pruebas.
// Uso:  API=http://localhost:3000 ADMIN_EMAIL=... ADMIN_PASSWORD=... npm test
// Cubre los casos obligatorios del plan de pruebas: roles, verificación, reserva concurrente,
// IDOR, estados sincronizados, mensajes, reseñas y revocación de acceso a episodios.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const API = process.env.API || 'http://localhost:3000';
const RUN = Date.now().toString(36);

function client() {
  let cookie = '';
  return async function call(method, path, body) {
    const res = await fetch(API + '/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'mexia', ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  };
}

const nextWeekday = (wd) => { // wd 0=Lunes
  const d = new Date(); d.setUTCDate(d.getUTCDate() + 2);
  while (((d.getUTCDay() + 6) % 7) !== wd) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

const patientA = client(), patientB = client(), doctor = client(), doctor2 = client(), admin = client();
const ctx = {};

test('registro: ADMIN no se puede crear por registro público', async () => {
  const r = await patientA('POST', '/auth/register', { role: 'ADMIN', name: 'X', email: `x${RUN}@t.mx`, password: 'abc12345', consent: true });
  assert.equal(r.status, 400);
});

test('registro de paciente y profesional independientes', async () => {
  let r = await patientA('POST', '/auth/register', { role: 'PATIENT', name: 'Paciente Uno', email: `pa${RUN}@t.mx`, password: 'clave1234', consent: true });
  assert.equal(r.status, 201); assert.equal(r.data.user.role, 'PATIENT');
  r = await patientB('POST', '/auth/register', { role: 'PATIENT', name: 'Paciente Dos', email: `pb${RUN}@t.mx`, password: 'clave1234', consent: true });
  assert.equal(r.status, 201);
  r = await doctor('POST', '/auth/register', { role: 'DOCTOR', name: 'Dra. Prueba Uno', email: `dr${RUN}@t.mx`, password: 'clave1234', consent: true });
  assert.equal(r.status, 201); assert.equal(r.data.professional.verification_status, 'DRAFT');
  r = await doctor2('POST', '/auth/register', { role: 'DOCTOR', name: 'Dr. Ajeno', email: `dr2${RUN}@t.mx`, password: 'clave1234', consent: true });
  assert.equal(r.status, 201);
  r = await patientA('POST', '/auth/register', { role: 'PATIENT', name: 'Dup', email: `pa${RUN}@t.mx`, password: 'clave1234', consent: true });
  assert.equal(r.status, 409);
});

test('login incorrecto no revela si existe el correo', async () => {
  const c = client();
  const a = await c('POST', '/auth/login', { email: `pa${RUN}@t.mx`, password: 'mala' });
  const b = await c('POST', '/auth/login', { email: `noexiste${RUN}@t.mx`, password: 'mala' });
  assert.equal(a.status, 401); assert.equal(b.status, 401); assert.equal(a.data.error, b.data.error);
});

test('roles: un paciente no entra al portal médico ni a admin', async () => {
  assert.equal((await patientA('GET', '/doctor/me')).status, 403);
  assert.equal((await patientA('GET', '/admin/professionals')).status, 403);
  assert.equal((await doctor('GET', '/episodes')).status, 403);
});

test('registro médico en 4 pasos con validaciones', async () => {
  let r = await doctor('PATCH', '/doctor/me', { license_number: '12' });
  assert.equal(r.status, 400);
  r = await doctor('PATCH', '/doctor/me', { phone: '2221234567', specialty: 'Medicina general', license_number: '1234567', university: 'UNAM', experience_years: 8, registration_step: 2 });
  assert.equal(r.status, 200);
  r = await doctor('PATCH', '/doctor/me/draft', { displayName: 'Dra. Prueba Uno', specialty: 'Medicina general', bio: 'Atención integral.', city: 'Puebla', address: 'Calle 1', mode: 'AMBAS', price: 500, duration: 30 });
  assert.equal(r.status, 200);
  r = await doctor('POST', '/doctor/me/submit-verification', { attest: true });
  assert.equal(r.status, 200); assert.equal(r.data.professional.verification_status, 'PENDING_REVIEW');
  ctx.profId = r.data.professional.id;
  const day = nextWeekday(0); ctx.day = day;
  r = await doctor('PUT', '/doctor/me/availability', { rules: [{ weekday: 0, start_time: '09:00', end_time: '12:00', slot_minutes: 30 }, { weekday: 0, start_time: '11:00', end_time: '13:00' }] });
  assert.equal(r.status, 400, 'franjas traslapadas deben rechazarse');
  r = await doctor('PUT', '/doctor/me/availability', { rules: [{ weekday: 0, start_time: '09:00', end_time: '12:00', slot_minutes: 30 }] });
  assert.equal(r.status, 200);
});

test('profesional no verificado no puede publicarse ni aparece en el directorio', async () => {
  let r = await doctor('POST', '/doctor/me/publish-request');
  assert.equal(r.status, 403);
  r = await patientA('GET', '/professionals');
  assert.ok(!r.data.some((p) => p.id === ctx.profId));
  r = await patientA('GET', `/professionals/${ctx.profId}`);
  assert.equal(r.status, 404);
});

test('admin verifica y publica; paciente ve exactamente la versión publicada', async () => {
  const email = process.env.ADMIN_EMAIL, password = process.env.ADMIN_PASSWORD;
  assert.ok(email && password, 'Define ADMIN_EMAIL y ADMIN_PASSWORD');
  let r = await admin('POST', '/auth/login', { email, password });
  assert.equal(r.status, 200); assert.equal(r.data.user.role, 'ADMIN');
  r = await admin('PATCH', `/admin/professionals/${ctx.profId}/verification`, { status: 'VERIFIED' });
  assert.equal(r.status, 200);
  r = await doctor('POST', '/doctor/me/publish-request');
  assert.equal(r.status, 200); assert.equal(r.data.publicProfile.status, 'PENDING_REVIEW');
  r = await admin('POST', `/admin/professionals/${ctx.profId}/publish`, { decision: 'APPROVE' });
  assert.equal(r.status, 200);
  // El médico cambia su borrador: el paciente NO debe verlo hasta nueva publicación
  await doctor('PATCH', '/doctor/me/draft', { bio: 'Borrador nuevo sin publicar' });
  const pub = await patientB('GET', `/professionals/${ctx.profId}`);
  assert.equal(pub.status, 200);
  assert.equal(pub.data.bio, 'Atención integral.');
  assert.equal(pub.data.verified, true);
  const prev = await doctor('GET', '/doctor/me/preview');
  assert.equal(prev.data.bio, 'Borrador nuevo sin publicar');
  assert.deepEqual(Object.keys(prev.data).sort(), Object.keys(pub.data).sort(), 'misma forma en vista previa y ficha pública');
});

test('dos pacientes reservan el mismo hueco a la vez: solo una gana', async () => {
  const av = await patientA('GET', `/professionals/${ctx.profId}/availability?from=${ctx.day}&to=${ctx.day}`);
  assert.equal(av.status, 200);
  assert.equal(av.data.slots.length, 6);
  const slot = av.data.slots[0].start_at;
  ctx.slot = slot;
  const ep = await patientA('POST', '/episodes', { title: 'Dolor de cabeza', onset_reported: 'Ayer', symptom: { name: 'Dolor de cabeza', intensity: 6, evolution: 'Está igual' } });
  assert.equal(ep.status, 201); ctx.epId = ep.data.id;
  const [a, b] = await Promise.all([
    patientA('POST', '/appointments', { professional_id: ctx.profId, start_at: slot, mode: 'PRESENCIAL', episode_id: ctx.epId, share_episode: true, idempotency_key: 'k-' + RUN }),
    patientB('POST', '/appointments', { professional_id: ctx.profId, start_at: slot, mode: 'PRESENCIAL' }),
  ]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [201, 409]);
  ctx.apptA = a.status === 201 ? a.data : null;
  if (!ctx.apptA) { // B ganó; reservamos A en el siguiente hueco
    const r = await patientA('POST', '/appointments', { professional_id: ctx.profId, start_at: av.data.slots[1].start_at, episode_id: ctx.epId, share_episode: true });
    ctx.apptA = r.data;
  }
  // Reintento idempotente devuelve la misma cita
  const again = await patientA('POST', '/appointments', { professional_id: ctx.profId, start_at: slot, idempotency_key: 'k-' + RUN, episode_id: ctx.epId });
  if (a.status === 201) assert.equal(again.data.id, ctx.apptA.id);
  const av2 = await patientB('GET', `/professionals/${ctx.profId}/availability?from=${ctx.day}&to=${ctx.day}`);
  assert.equal(av2.data.slots.length, a.status === 201 ? 5 : 4);
});

test('horario fuera de agenda es rechazado', async () => {
  const r = await patientB('POST', '/appointments', { professional_id: ctx.profId, start_at: `${ctx.day} 09:10` });
  assert.equal(r.status, 409);
});

test('IDOR: otro paciente y otro médico no ven la cita ni el episodio', async () => {
  assert.equal((await patientB('GET', `/appointments/${ctx.apptA.id}`)).status, 404);
  assert.equal((await doctor2('GET', `/appointments/${ctx.apptA.id}`)).status, 404);
  assert.equal((await patientB('GET', `/episodes/${ctx.epId}`)).status, 404);
  assert.equal((await doctor2('GET', `/doctor/episodes/${ctx.epId}`)).status, 403);
});

test('médico autorizado ve el episodio compartido y queda en bitácora', async () => {
  const r = await doctor('GET', `/doctor/episodes/${ctx.epId}`);
  assert.equal(r.status, 200); assert.equal(r.data.title, 'Dolor de cabeza');
  const log = await patientA('GET', '/me/access-log');
  assert.ok(log.data.some((x) => x.action === 'EPISODE_VIEWED_BY_PROFESSIONAL'));
});

test('estado de cita sincronizado y control de versión', async () => {
  let r = await doctor('GET', '/doctor/me/appointments?status=REQUESTED');
  const mine = r.data.find((x) => x.id === ctx.apptA.id);
  assert.ok(mine);
  r = await patientA('PATCH', `/appointments/${ctx.apptA.id}/status`, { status: 'CONFIRMED', version: mine.version });
  assert.equal(r.status, 403, 'el paciente no puede confirmar');
  r = await doctor('PATCH', `/appointments/${ctx.apptA.id}/status`, { status: 'CONFIRMED', version: mine.version });
  assert.equal(r.status, 200); assert.equal(r.data.status, 'CONFIRMED');
  r = await doctor('PATCH', `/appointments/${ctx.apptA.id}/status`, { status: 'CANCELLED', version: mine.version });
  assert.equal(r.status, 409, 'versión obsoleta');
  r = await patientA('GET', `/appointments/${ctx.apptA.id}`);
  assert.equal(r.data.status, 'CONFIRMED');
  ctx.version = r.data.version;
});

test('mensajes: solo participantes de una cita confirmada', async () => {
  let r = await patientA('POST', `/appointments/${ctx.apptA.id}/messages`, { body: 'Hola doctora' });
  assert.equal(r.status, 201);
  r = await doctor('GET', `/appointments/${ctx.apptA.id}/messages`);
  assert.equal(r.data.length, 1); assert.equal(r.data[0].mine, false);
  assert.equal((await patientB('GET', `/appointments/${ctx.apptA.id}/messages`)).status, 404);
  assert.equal((await doctor2('POST', `/appointments/${ctx.apptA.id}/messages`, { body: 'x' })).status, 404);
});

test('reseña solo tras consulta atendida', async () => {
  const r = await patientA('POST', `/appointments/${ctx.apptA.id}/review`, { rating: 5 });
  assert.equal(r.status, 403);
});

test('revocar acceso es inmediato', async () => {
  const ep = await patientA('GET', `/episodes/${ctx.epId}`);
  const g = ep.data.grants.find((x) => x.active);
  assert.ok(g);
  const r = await patientA('DELETE', `/episodes/${ctx.epId}/grants/${g.id}`);
  assert.equal(r.status, 200);
  assert.equal((await doctor('GET', `/doctor/episodes/${ctx.epId}`)).status, 403);
});

test('cancelar libera el hueco y quita la cita del calendario', async () => {
  let r = await patientA('PATCH', `/appointments/${ctx.apptA.id}/status`, { status: 'CANCELLED', version: ctx.version });
  assert.equal(r.status, 200);
  r = await patientA('GET', `/calendar?from=${ctx.day}&to=${ctx.day}`);
  assert.ok(!r.data.some((e) => e.appointment_id === ctx.apptA.id));
  r = await patientB('POST', '/appointments', { professional_id: ctx.profId, start_at: ctx.apptA.start_at });
  assert.equal(r.status, 201, 'el hueco liberado puede reservarse de nuevo');
});

test('calendario: actividad diaria y estado por ocurrencia', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const until = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  let r = await patientA('POST', '/calendar', { type: 'Medicamento', title: 'Paracetamol (ficticio)', event_date: today, event_time: '08:00', repeat_mode: 'daily', repeat_until: until, episode_id: ctx.epId });
  assert.equal(r.status, 201);
  const evId = r.data.id;
  r = await patientA('GET', `/calendar?from=${today}&to=${until}`);
  assert.equal(r.data.filter((e) => e.id === evId).length, 3);
  r = await patientA('PUT', `/calendar/${evId}/status`, { date: today, status: 'Completada' });
  assert.equal(r.status, 200);
  assert.equal((await patientB('PUT', `/calendar/${evId}/status`, { date: today, status: 'Omitida' })).status, 404);
});

test('cambiar la cédula de un médico verificado exige nueva revisión', async () => {
  const r = await doctor('PATCH', '/doctor/me', { license_number: '7654321' });
  assert.equal(r.data.professional.verification_status, 'PENDING_REVIEW');
});
