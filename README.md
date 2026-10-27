# MEXIA PWA · Node.js + Express + MySQL

PWA instalable construida a partir de `MEXIA_V6_6_BASE_VISUAL_CONSOLIDADA.html`. Usa **el mismo diseño** (mismo CSS y nombres de clases) y guarda los datos en MySQL mediante una API con autenticación y permisos por recurso.

```
mexia-pwa/
├── database/schema.sql      ← crea la BD "mexia" (22 tablas)
├── server/                  ← API Express (también sirve la PWA)
│   ├── src/index.js         ← arranque, seguridad, rutas
│   ├── src/routes/          ← auth, me (paciente), episodes, calendar, documents,
│   │                          professionals (directorio), doctor (portal), appointments, admin
│   ├── src/lib/             ← agenda/horarios, perfil público, archivos, auditoría
│   ├── src/scripts/create-admin.js
│   ├── test/api.test.js     ← 18 pruebas de integración
│   └── storage/             ← archivos subidos (public = fotos de perfil, private = documentos)
└── public/                  ← PWA: index.html, manifest, sw.js, css/, img/, js/
```

## Puesta en marcha

1. **Base de datos** (MySQL 8+ o MariaDB 10.6+):
   ```bash
   mysql -u root -p < database/schema.sql
   mysql -u root -p -e "CREATE USER 'mexia'@'localhost' IDENTIFIED BY 'TU_CLAVE'; GRANT ALL ON mexia.* TO 'mexia'@'localhost';"
   ```
2. **Servidor**:
   ```bash
   cd server
   cp .env.example .env        # edita DB_PASSWORD y JWT_SECRET
   npm install
   npm run create-admin -- admin@tudominio.com "Tu Nombre"   # pide contraseña
   npm start                   # http://localhost:3000
   ```
3. Abre `http://localhost:3000` en el celular o la computadora. En Chrome/Edge/Safari aparece la opción **Instalar / Agregar a pantalla de inicio**. En producción la PWA requiere **HTTPS** (pon `COOKIE_SECURE=true`).

## Flujo completo

| Rol | Qué puede hacer |
|---|---|
| **Paciente** | Registro, perfil de salud en 3 pasos, pulso diario, episodios guiados (síntoma → inicio → intensidad → evolución → ubicación), seguimientos con gráfica, cierre/reapertura, calendario con actividades recurrentes y estado por día, tomas de medicamento y adherencia, documentos PDF/imagen privados, directorio de médicos verificados, reserva de horarios reales, cancelación, mensajes, reseñas tras consulta atendida, médicos de confianza, compartir un episodio con vigencia y revocarlo, bitácora de accesos, exportar mis datos. |
| **Médico** | Registro en 4 etapas guardado en cada paso, centro de verificación con subida de cédula/título (privados), edición de perfil y borrador público, retrato y fotos del consultorio, vista previa idéntica a la del paciente, solicitud de publicación, franjas de agenda por día, bloqueo de fechas, aceptar/rechazar/atendida/no asistió, pacientes y episodios compartidos (con bitácora), mensajes, estadísticas semanales por estado. |
| **Admin** | Verificar/rechazar/suspender profesionales, ver documentos de acreditación, aprobar publicaciones, moderar reseñas, bitácora. Solo se crea con `npm run create-admin`, nunca por registro público. |

## Hallazgos de la auditoría cerrados

- **H01/H02** Datos en servidor, no en `localStorage`; sesión en cookie `httpOnly` + `SameSite=Strict`, encabezado anti‑CSRF, contraseñas con bcrypt, rate limiting, rol leído siempre de la BD. El service worker **no guarda en caché** respuestas de `/api`.
- **H03** Reserva en transacción con bloqueo por profesional (`FOR UPDATE`), validación contra la agenda, bloqueos y traslapes, índice único `uq_appt_slot` como segunda barrera, clave de idempotencia. Probado: dos pacientes reservando el mismo hueco a la vez → una sola cita.
- **H04/H11** Mensajes solo entre los dos participantes de una cita confirmada/atendida (un tercero recibe 404).
- **H05/H06/H12/H15** Un solo `ProfessionalPublicProfile` con borrador y versión publicada; paciente y vista previa usan la misma función del servidor y el mismo componente `publicCard`. Sin médicos ficticios.
- **H07/H17** Un médico solo aparece en el directorio si está `VERIFIED` **y** su publicación fue aprobada. Cambiar cédula o especialidad regresa la verificación a revisión.
- **H08** Fotos persistentes, validadas por firma binaria (no por extensión), borrado real que también las retira del perfil publicado.
- **H09** Reseña: una por cita, solo tras `COMPLETED`, con moderación; el médico no puede editarla.
- **H10** Estadísticas por estados explícitos e historial `appointment_events`, con zona horaria del consultorio.
- **Episodios**: autorización por episodio, alcance (resumen/completo), vencimiento, revocación inmediata y auditoría de cada lectura.

## Pruebas

```bash
cd server
API=http://localhost:3000 ADMIN_EMAIL=admin@tudominio.com ADMIN_PASSWORD='...' npm test
```
Usa una BD de pruebas: las pruebas crean cuentas. También se ejecutó un recorrido de interfaz con navegador (paciente, médico y admin, 390 px y 1280 px) sin errores de consola ni scroll horizontal.

## Pendiente antes de producción

- **Recuperación de contraseña por correo** (requiere un proveedor SMTP); hoy la restablece un admin con `create-admin`.
- **Notificaciones push** con servidor (Web Push / VAPID). Hoy los avisos son locales.
- Cifrado en reposo de la BD y respaldo de `server/storage/` (o mover archivos a S3/GCS privado), antivirus para cargas.
- Revisión legal (LFPDPPP, NOM‑004, NOM‑024), aviso de privacidad real y política de retención.
- Ícono de app en alta resolución: reemplaza `public/img/icon-192.png` y `icon-512.png` (los actuales salen del logo de 129 px del prototipo).
- La hora de citas se guarda en la zona del consultorio (`America/Mexico_City` por defecto); si atenderán varias zonas, mostrar la conversión al paciente.
