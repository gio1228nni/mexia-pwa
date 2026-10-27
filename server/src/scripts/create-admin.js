// Crea (o promueve) una cuenta ADMIN. Uso:
//   npm run create-admin -- admin@tudominio.com "Nombre Apellido"
// Pide la contraseña por consola (no queda en el historial).
import bcrypt from 'bcryptjs';
import readline from 'node:readline';
import { pool, one, q } from '../db.js';

const [email, name = 'Administrador'] = process.argv.slice(2);
if (!email) {
  console.error('Uso: npm run create-admin -- correo@dominio.com "Nombre"');
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const password = process.env.ADMIN_PASSWORD || await new Promise((res) => rl.question('Contraseña (mín. 10 caracteres): ', res));
rl.close();
if (!password || password.length < 10) {
  console.error('La contraseña debe tener al menos 10 caracteres');
  process.exit(1);
}

const hash = await bcrypt.hash(password, 12);
const existing = await one('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
if (existing) {
  await q("UPDATE users SET role = 'ADMIN', password_hash = ?, token_version = token_version + 1 WHERE id = ?", [hash, existing.id]);
  console.log('Cuenta existente promovida a ADMIN:', email);
} else {
  await q("INSERT INTO users (role, email, password_hash, name, consent_at) VALUES ('ADMIN', ?, ?, ?, UTC_TIMESTAMP())", [email.toLowerCase(), hash, name]);
  console.log('ADMIN creado:', email);
}
await pool.end();
