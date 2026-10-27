import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { bad } from './http.js';

const ALLOWED = {
  image: ['image/jpeg', 'image/png', 'image/webp'],
  doc: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
};

// Firmas binarias (magic numbers): no confiamos en la extensión ni en el MIME declarado
function sniff(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buf.slice(0, 5).toString() === '%PDF-') return 'application/pdf';
  return null;
}

export function uploader(kind) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxUploadBytes, files: 1 },
  }).single('file');
}

/**
 * Valida el archivo y lo guarda en disco.
 * visibility PUBLIC → storage/public (fotos de perfil);
 * PRIVATE → storage/private (documentos clínicos y credenciales; solo se sirven tras autorizar).
 */
export function saveFile(file, kind, visibility) {
  if (!file) throw bad('Selecciona un archivo');
  const real = sniff(file.buffer);
  if (!real || !ALLOWED[kind].includes(real)) {
    throw bad(kind === 'image' ? 'Solo se aceptan imágenes JPG, PNG o WEBP' : 'Solo se aceptan PDF o imágenes JPG, PNG, WEBP');
  }
  const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' }[real];
  const dir = visibility === 'PUBLIC' ? 'public' : 'private';
  const name = crypto.randomBytes(16).toString('hex') + ext;
  fs.mkdirSync(path.join(config.storageDir, dir), { recursive: true });
  fs.writeFileSync(path.join(config.storageDir, dir, name), file.buffer, { mode: 0o600 });
  return { storageKey: `${dir}/${name}`, mime: real, size: file.size,
    originalName: String(file.originalname || '').slice(0, 200) };
}

export function absolutePath(storageKey) {
  const p = path.resolve(config.storageDir, storageKey);
  if (!p.startsWith(config.storageDir + path.sep)) throw bad('Ruta inválida');
  return p;
}

export function removeFile(storageKey) {
  try { fs.unlinkSync(absolutePath(storageKey)); } catch { /* ya no existe */ }
}
