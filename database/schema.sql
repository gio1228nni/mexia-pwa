-- =====================================================================
--  MEXIA PWA · Esquema MySQL 8.0+ (compatible con MariaDB 10.6+)
--  Codificación utf8mb4. Ejecutar:  mysql -u root -p < schema.sql
--
--  Convención de horas: las citas y la disponibilidad se guardan en la
--  hora local del consultorio (columna professionals.timezone).
--  Las marcas de auditoría (created_at, etc.) se guardan en UTC.
-- =====================================================================

CREATE DATABASE IF NOT EXISTS mexia
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE mexia;

-- ---------------------------------------------------------------------
-- 1. Identidad y roles
-- ---------------------------------------------------------------------
CREATE TABLE users (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  role           ENUM('PATIENT','DOCTOR','ADMIN') NOT NULL DEFAULT 'PATIENT',
  status         ENUM('ACTIVE','SUSPENDED','DELETED') NOT NULL DEFAULT 'ACTIVE',
  email          VARCHAR(190) NOT NULL,
  password_hash  VARCHAR(100) NOT NULL,
  name           VARCHAR(120) NOT NULL,
  token_version  INT UNSIGNED NOT NULL DEFAULT 0,      -- invalida sesiones al cambiar contraseña/cerrar todas
  consent_at     DATETIME NULL,                       -- aceptación de términos y aviso de privacidad
  last_login_at  DATETIME NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB;

-- Perfil de salud del paciente (1:1 con users)
CREATE TABLE patient_profiles (
  user_id             BIGINT UNSIGNED PRIMARY KEY,
  preferred_name      VARCHAR(80)  NULL,
  birth_date          DATE         NULL,
  biological_sex      VARCHAR(40)  NULL,
  allergies           VARCHAR(500) NULL,
  current_medications VARCHAR(500) NULL,
  conditions          TEXT         NULL,
  blood_type          VARCHAR(4)   NULL,
  surgeries           VARCHAR(500) NULL,
  vaccines            VARCHAR(500) NULL,
  emergency_contact   VARCHAR(200) NULL,
  onboarding_done     TINYINT(1) NOT NULL DEFAULT 0,
  easy_reading        TINYINT(1) NOT NULL DEFAULT 0,
  daily_pulse_enabled TINYINT(1) NOT NULL DEFAULT 0,
  daily_pulse_time    TIME NULL,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_pp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 2. Profesionales, verificación y perfil público
-- ---------------------------------------------------------------------
CREATE TABLE professionals (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id             BIGINT UNSIGNED NOT NULL,
  phone               VARCHAR(20)  NULL,
  professional_type   ENUM('MEDICO','ENFERMERIA') NOT NULL DEFAULT 'MEDICO',
  specialty           VARCHAR(100) NULL,
  license_number      VARCHAR(20)  NULL,   -- cédula profesional (declarada, NO verificada hasta revisión)
  specialty_license   VARCHAR(20)  NULL,
  university          VARCHAR(150) NULL,
  experience_years    SMALLINT UNSIGNED NULL,
  timezone            VARCHAR(40) NOT NULL DEFAULT 'America/Mexico_City',
  registration_step   TINYINT UNSIGNED NOT NULL DEFAULT 0,
  attested_at         DATETIME NULL,       -- declaró veracidad de datos
  verification_status ENUM('DRAFT','PENDING_REVIEW','VERIFIED','REJECTED','SUSPENDED')
                      NOT NULL DEFAULT 'DRAFT',
  verification_notes  VARCHAR(500) NULL,
  verified_at         DATETIME NULL,
  verified_by         BIGINT UNSIGNED NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_prof_user (user_id),
  KEY ix_prof_status (verification_status),
  CONSTRAINT fk_prof_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_prof_verifier FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Perfil público: un borrador editable y UNA versión publicada.
-- Médico y paciente consumen exactamente published_json (principio central).
CREATE TABLE professional_public_profiles (
  professional_id   BIGINT UNSIGNED PRIMARY KEY,
  draft_json        JSON NULL,      -- {displayName, specialty, bio, city, address, mode, languages, ...}
  published_json    JSON NULL,      -- copia congelada al aprobar la publicación
  published_version INT UNSIGNED NOT NULL DEFAULT 0,
  status            ENUM('DRAFT','PENDING_REVIEW','PUBLISHED','WITHDRAWN') NOT NULL DEFAULT 'DRAFT',
  city              VARCHAR(100) NULL,  -- desnormalizado de published_json para filtrar el directorio
  submitted_at      DATETIME NULL,
  published_at      DATETIME NULL,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY ix_ppp_status_city (status, city),
  CONSTRAINT fk_ppp_prof FOREIGN KEY (professional_id) REFERENCES professionals(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Archivos: fotos públicas (retrato/instalaciones) y documentos privados.
-- storage_key = ruta en disco/objeto. Nunca se sirve una ruta privada sin autorización.
CREATE TABLE media (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  owner_user_id   BIGINT UNSIGNED NOT NULL,
  kind            ENUM('PORTRAIT','FACILITY','CREDENTIAL','CLINICAL_DOC') NOT NULL,
  visibility      ENUM('PUBLIC','PRIVATE') NOT NULL,
  status          ENUM('ACTIVE','PENDING_MODERATION','REMOVED') NOT NULL DEFAULT 'ACTIVE',
  storage_key     VARCHAR(255) NOT NULL,
  original_name   VARCHAR(200) NULL,
  mime            VARCHAR(80)  NOT NULL,
  size_bytes      INT UNSIGNED NOT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_media_owner (owner_user_id, kind, status),
  CONSTRAINT fk_media_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE services (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  professional_id  BIGINT UNSIGNED NOT NULL,
  name             VARCHAR(120) NOT NULL DEFAULT 'Consulta',
  price_mxn        DECIMAL(10,2) NOT NULL DEFAULT 0,
  duration_min     SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  mode             ENUM('PRESENCIAL','EN_LINEA','AMBAS') NOT NULL DEFAULT 'PRESENCIAL',
  active           TINYINT(1) NOT NULL DEFAULT 1,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_srv_prof (professional_id, active),
  CONSTRAINT fk_srv_prof FOREIGN KEY (professional_id) REFERENCES professionals(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Franjas semanales (varias por día). weekday: 0=Lunes … 6=Domingo
CREATE TABLE availability_rules (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  professional_id  BIGINT UNSIGNED NOT NULL,
  weekday          TINYINT UNSIGNED NOT NULL,
  start_time       TIME NOT NULL,
  end_time         TIME NOT NULL,
  slot_minutes     SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  KEY ix_av_prof (professional_id, weekday),
  CONSTRAINT fk_av_prof FOREIGN KEY (professional_id) REFERENCES professionals(id) ON DELETE CASCADE,
  CONSTRAINT ck_av_weekday CHECK (weekday BETWEEN 0 AND 6),
  CONSTRAINT ck_av_range CHECK (end_time > start_time)
) ENGINE=InnoDB;

CREATE TABLE time_off (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  professional_id  BIGINT UNSIGNED NOT NULL,
  start_at         DATETIME NOT NULL,
  end_at           DATETIME NOT NULL,
  reason           VARCHAR(200) NULL,
  KEY ix_to_prof (professional_id, start_at),
  CONSTRAINT fk_to_prof FOREIGN KEY (professional_id) REFERENCES professionals(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 3. Expediente del paciente por episodios
-- ---------------------------------------------------------------------
CREATE TABLE episodes (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  patient_user_id   BIGINT UNSIGNED NOT NULL,
  title             VARCHAR(160) NOT NULL,
  onset_reported    VARCHAR(60)  NULL,         -- "Ayer", "Hace 2–3 días"...
  onset_approximate TINYINT(1) NOT NULL DEFAULT 1,
  start_date        DATE NOT NULL,
  end_date          DATE NULL,
  status            ENUM('ACTIVE','CLOSED') NOT NULL DEFAULT 'ACTIVE',
  outcome           VARCHAR(60)  NULL,         -- Mejoró / Resuelto / Derivado...
  closing_note      VARCHAR(1000) NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY ix_ep_patient (patient_user_id, status, start_date),
  CONSTRAINT fk_ep_patient FOREIGN KEY (patient_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE episode_symptoms (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  episode_id   BIGINT UNSIGNED NOT NULL,
  name         VARCHAR(160) NOT NULL,
  onset_date   DATE NULL,
  intensity    TINYINT UNSIGNED NULL,
  evolution    VARCHAR(40) NULL,
  location     VARCHAR(60) NULL,
  side         VARCHAR(20) NULL,
  pain_type    VARCHAR(60) NULL,
  notes        VARCHAR(1000) NULL,
  active       TINYINT(1) NOT NULL DEFAULT 1,
  recorded_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_sym_ep (episode_id),
  CONSTRAINT fk_sym_ep FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE,
  CONSTRAINT ck_sym_int CHECK (intensity IS NULL OR intensity <= 10)
) ENGINE=InnoDB;

-- Seguimientos de evolución (gráfica de intensidad)
CREATE TABLE episode_followups (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  episode_id   BIGINT UNSIGNED NOT NULL,
  symptom_id   BIGINT UNSIGNED NULL,
  intensity    TINYINT UNSIGNED NULL,
  evolution    VARCHAR(40) NULL,
  note         VARCHAR(1000) NULL,
  recorded_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_fu_ep (episode_id, recorded_at),
  CONSTRAINT fk_fu_ep FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE,
  CONSTRAINT fk_fu_sym FOREIGN KEY (symptom_id) REFERENCES episode_symptoms(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Documentos clínicos privados del paciente (archivo en media)
CREATE TABLE documents (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  patient_user_id  BIGINT UNSIGNED NOT NULL,
  episode_id       BIGINT UNSIGNED NULL,
  media_id         BIGINT UNSIGNED NULL,
  doc_type         VARCHAR(40) NOT NULL DEFAULT 'Otro',
  title            VARCHAR(200) NOT NULL,
  doc_date         DATE NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_doc_patient (patient_user_id, doc_type),
  CONSTRAINT fk_doc_patient FOREIGN KEY (patient_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_doc_ep FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE SET NULL,
  CONSTRAINT fk_doc_media FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE daily_pulse (
  patient_user_id  BIGINT UNSIGNED NOT NULL,
  pulse_date       DATE NOT NULL,
  value            ENUM('bien','regular','mal') NOT NULL,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (patient_user_id, pulse_date),
  CONSTRAINT fk_pulse_patient FOREIGN KEY (patient_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Médicos de confianza: a un profesional de MEXIA o uno externo capturado por el paciente
CREATE TABLE trusted_doctors (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  patient_user_id  BIGINT UNSIGNED NOT NULL,
  professional_id  BIGINT UNSIGNED NULL,
  name             VARCHAR(100) NULL,
  specialty        VARCHAR(90)  NULL,
  contact          VARCHAR(120) NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_td (patient_user_id, professional_id),
  CONSTRAINT fk_td_patient FOREIGN KEY (patient_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_td_prof FOREIGN KEY (professional_id) REFERENCES professionals(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 4. Citas (reserva transaccional)
-- ---------------------------------------------------------------------
CREATE TABLE appointments (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  patient_user_id  BIGINT UNSIGNED NOT NULL,
  professional_id  BIGINT UNSIGNED NOT NULL,
  service_id       BIGINT UNSIGNED NULL,
  episode_id       BIGINT UNSIGNED NULL,
  start_at         DATETIME NOT NULL,          -- hora local del consultorio
  end_at           DATETIME NOT NULL,
  mode             ENUM('PRESENCIAL','EN_LINEA') NOT NULL DEFAULT 'PRESENCIAL',
  price_mxn        DECIMAL(10,2) NOT NULL DEFAULT 0,  -- precio congelado al reservar
  reason           VARCHAR(1000) NULL,
  status           ENUM('REQUESTED','CONFIRMED','REJECTED','CANCELLED','COMPLETED','NO_SHOW')
                   NOT NULL DEFAULT 'REQUESTED',
  status_reason    VARCHAR(300) NULL,
  idempotency_key  VARCHAR(64) NULL,
  version          INT UNSIGNED NOT NULL DEFAULT 1,  -- control optimista de concurrencia
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  -- 1 cuando la cita ocupa el hueco; NULL cuando ya lo liberó (NULL no choca en UNIQUE)
  slot_lock        TINYINT AS (CASE WHEN status IN ('REQUESTED','CONFIRMED') THEN 1 ELSE NULL END) STORED,
  UNIQUE KEY uq_appt_slot (professional_id, start_at, slot_lock),
  UNIQUE KEY uq_appt_idem (patient_user_id, idempotency_key),
  KEY ix_appt_patient (patient_user_id, start_at),
  KEY ix_appt_prof (professional_id, start_at, status),
  CONSTRAINT fk_appt_patient FOREIGN KEY (patient_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_appt_prof FOREIGN KEY (professional_id) REFERENCES professionals(id) ON DELETE CASCADE,
  CONSTRAINT fk_appt_srv FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL,
  CONSTRAINT fk_appt_ep FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE SET NULL,
  CONSTRAINT ck_appt_range CHECK (end_at > start_at)
) ENGINE=InnoDB;

-- Historial de estados: fuente de las estadísticas (solicitadas, confirmadas, atendidas…)
CREATE TABLE appointment_events (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  appointment_id  BIGINT UNSIGNED NOT NULL,
  actor_user_id   BIGINT UNSIGNED NULL,
  from_status     VARCHAR(20) NULL,
  to_status       VARCHAR(20) NOT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_ae_appt (appointment_id),
  KEY ix_ae_status (to_status, created_at),
  CONSTRAINT fk_ae_appt FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Mensajes: solo entre paciente y profesional de una cita confirmada/atendida
CREATE TABLE messages (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  appointment_id  BIGINT UNSIGNED NOT NULL,
  author_user_id  BIGINT UNSIGNED NOT NULL,
  body            VARCHAR(2000) NOT NULL,
  read_at         DATETIME NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_msg_appt (appointment_id, created_at),
  CONSTRAINT fk_msg_appt FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE,
  CONSTRAINT fk_msg_author FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Reseñas: una por cita COMPLETED, autor = paciente; el médico no puede editarlas
CREATE TABLE reviews (
  id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  appointment_id     BIGINT UNSIGNED NOT NULL,
  author_user_id     BIGINT UNSIGNED NOT NULL,
  professional_id    BIGINT UNSIGNED NOT NULL,
  rating             TINYINT UNSIGNED NOT NULL,
  body               VARCHAR(1000) NULL,
  moderation_status  ENUM('PENDING','PUBLISHED','REMOVED') NOT NULL DEFAULT 'PENDING',
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_review_appt (appointment_id),
  KEY ix_rev_prof (professional_id, moderation_status),
  CONSTRAINT fk_rev_appt FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE,
  CONSTRAINT fk_rev_author FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_rev_prof FOREIGN KEY (professional_id) REFERENCES professionals(id) ON DELETE CASCADE,
  CONSTRAINT ck_rev_rating CHECK (rating BETWEEN 1 AND 5)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 5. Calendario del paciente (actividades, tomas de medicamento, recurrencia)
-- ---------------------------------------------------------------------
CREATE TABLE calendar_events (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  patient_user_id  BIGINT UNSIGNED NOT NULL,
  episode_id       BIGINT UNSIGNED NULL,
  appointment_id   BIGINT UNSIGNED NULL,
  type             VARCHAR(40) NOT NULL,       -- Medicamento, Consulta, Estudio, Ejercicio, Seguimiento...
  title            VARCHAR(160) NOT NULL,
  event_date       DATE NOT NULL,
  event_time       TIME NULL,
  notes            VARCHAR(1000) NULL,
  repeat_mode      ENUM('none','daily','weekly') NOT NULL DEFAULT 'none',
  repeat_until     DATE NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_cal_patient (patient_user_id, event_date),
  CONSTRAINT fk_cal_patient FOREIGN KEY (patient_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_cal_ep FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE SET NULL,
  CONSTRAINT fk_cal_appt FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Estado por ocurrencia (una actividad diaria tiene un estado por fecha)
CREATE TABLE calendar_event_status (
  event_id         BIGINT UNSIGNED NOT NULL,
  occurrence_date  DATE NOT NULL,
  status           ENUM('Pendiente','Completada','Omitida') NOT NULL DEFAULT 'Pendiente',
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id, occurrence_date),
  CONSTRAINT fk_ces_event FOREIGN KEY (event_id) REFERENCES calendar_events(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 6. Consentimiento por episodio y auditoría
-- ---------------------------------------------------------------------
CREATE TABLE episode_access_grants (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  episode_id       BIGINT UNSIGNED NOT NULL,
  professional_id  BIGINT UNSIGNED NOT NULL,
  appointment_id   BIGINT UNSIGNED NULL,
  scope            ENUM('SUMMARY','FULL') NOT NULL DEFAULT 'SUMMARY',
  granted_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at       DATETIME NOT NULL,
  revoked_at       DATETIME NULL,
  KEY ix_grant_lookup (professional_id, episode_id, revoked_at, expires_at),
  CONSTRAINT fk_grant_ep FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE,
  CONSTRAINT fk_grant_prof FOREIGN KEY (professional_id) REFERENCES professionals(id) ON DELETE CASCADE,
  CONSTRAINT fk_grant_appt FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Bitácora: nunca guarda contenido clínico, solo quién hizo qué sobre qué recurso
CREATE TABLE audit_events (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor_user_id BIGINT UNSIGNED NULL,
  action        VARCHAR(60) NOT NULL,          -- EPISODE_VIEWED_BY_DOCTOR, GRANT_REVOKED, LOGIN...
  entity_type   VARCHAR(40) NOT NULL,
  entity_id     BIGINT UNSIGNED NULL,
  meta          JSON NULL,
  ip            VARCHAR(45) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_audit_entity (entity_type, entity_id, created_at),
  KEY ix_audit_actor (actor_user_id, created_at)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 7. Primer administrador (NO hay registro público de ADMIN).
--    Créalo con:  cd server && npm run create-admin -- correo@dominio.com "Nombre"
-- ---------------------------------------------------------------------
