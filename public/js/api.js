// Cliente HTTP de MEXIA. La sesión viaja en una cookie httpOnly (no accesible desde JS).

export class ApiError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

async function request(method, path, body, { form = false } = {}) {
  const headers = { 'X-Requested-With': 'mexia' };
  let payload;
  if (form) payload = body;                       // FormData: el navegador pone el Content-Type
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let res;
  try {
    res = await fetch('/api' + path, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'Sin conexión con el servidor. Revisa tu internet e intenta de nuevo.', 'NETWORK');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new ApiError(res.status, data?.error || 'Ocurrió un error', data?.code);
    if (res.status === 401) window.dispatchEvent(new CustomEvent('mexia:unauthenticated'));
    throw err;
  }
  return data;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b = {}) => request('POST', p, b),
  patch: (p, b = {}) => request('PATCH', p, b),
  put: (p, b = {}) => request('PUT', p, b),
  del: (p) => request('DELETE', p),
  upload: (p, formData) => request('POST', p, formData, { form: true }),
};

/** Clave de idempotencia para que un doble clic no cree dos citas */
export const idemKey = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
