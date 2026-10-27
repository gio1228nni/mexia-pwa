import mysql from 'mysql2/promise';
import { config } from './config.js';

export const pool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
  dateStrings: true,       // DATE/DATETIME llegan como texto: sin conversiones de zona horaria
  decimalNumbers: true,
  timezone: 'Z',
});

/** Consulta simple: devuelve filas */
export async function q(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

/** Primera fila o null */
export async function one(sql, params = []) {
  const rows = await q(sql, params);
  return rows[0] || null;
}

/** Ejecuta fn(conn) dentro de una transacción */
export async function tx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}
