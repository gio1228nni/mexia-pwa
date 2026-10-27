// Bienvenida, onboarding, registro con rol, inicio de sesión, permisos y perfil de salud inicial.
import { esc, toast, toastError, readForm, busy } from '../ui.js';

const LOGO = '<img class="mx-brand-icon" alt="" src="/img/brand-icon.png">';

async function afterAuth(ctx, data) {
  ctx.session.user = data.user;
  ctx.session.profile = data.profile || null;
  ctx.session.professional = data.professional || null;
  if (data.user.role === 'DOCTOR') return ctx.go('portal');
  if (data.user.role === 'ADMIN') return ctx.go('admin');
  return ctx.go(data.profile?.onboarding_done ? 'home' : 'permissions');
}

export default {
  welcome: {
    role: 'PUBLIC',
    render: () => `<section class="mx-intro mx-splash" aria-label="Bienvenida a MEXIA">
      <div class="mx-wave mx-wave-top" aria-hidden="true"></div>
      <div class="mx-hero-logo">${LOGO}<h1>MEXIA</h1><p>Tu salud, siempre contigo</p></div>
      <div class="mx-orb-stage" aria-hidden="true"><img class="mx-reference-orb" alt="" src="/img/reference-orb.png"></div>
      <div class="mx-intro-panel"><div>✓ &nbsp;Tu información, segura</div><div>✓ &nbsp;Siempre a tu lado</div><div>✓ &nbsp;Cuidado más simple</div><div>✓ &nbsp;Una vida más saludable</div></div>
      <button class="button primary full mx-intro-cta" data-go="onboarding">Siguiente →</button>
      <p class="mx-auth-switch">¿Ya tienes cuenta? <button class="mx-link" type="button" data-go="login">Inicia sesión</button></p>
      <div class="mx-wave mx-wave-bottom" aria-hidden="true"></div>
    </section>`,
  },

  onboarding: {
    role: 'PUBLIC',
    render: () => `<section class="mx-intro mx-onboard" aria-label="Conoce MEXIA">
      <div class="mx-intro-top"><button class="mx-text-button" data-go="welcome" aria-label="Regresar">←</button><button class="mx-text-button" data-go="account">Saltar</button></div>
      <h1>Tu salud en<br>un solo lugar</h1><p class="mx-intro-sub">Organiza, da seguimiento y cuida lo más importante: tú.</p>
      <div class="mx-onboard-illustration" aria-hidden="true"><img class="mx-reference-onboard" alt="" src="/img/reference-onboard.png"></div>
      <div class="mx-intro-list"><div><span>📅</span> Medicamentos, estudios, citas y más</div><div><span>📋</span> Todo en un calendario</div><div><span>♡</span> Comparte solo lo que tú decidas con tu médico</div></div>
      <div class="mx-step-dots" aria-label="Paso 2 de 5"><i></i><i class="active"></i><i></i><i></i><i></i></div>
      <button class="button primary full mx-intro-cta" data-go="account">Siguiente →</button>
    </section>`,
  },

  account: {
    role: 'PUBLIC',
    render: (ctx) => {
      const role = ctx.ui.registrationRole || 'PATIENT';
      return `<section class="mx-intro mx-auth" aria-label="Crear cuenta">
      <div class="mx-intro-top"><button class="mx-text-button" data-go="onboarding" aria-label="Regresar">←</button></div>
      <div class="mx-auth-logo">${LOGO}</div><h1>Crea tu cuenta</h1><p class="mx-intro-sub">Comienza tu camino hacia una vida más saludable.</p>
      <div class="mx-purpose"><span class="mx-purpose-symbol" aria-hidden="true">♡</span><p>Que ninguna persona se sienta sola cuando se trata de su salud.</p></div>
      <form id="register-form" novalidate>
      <fieldset class="mx-role-picker" aria-label="Tipo de cuenta"><legend>¿Cómo utilizarás MEXIA?</legend>
        <label class="mx-role-choice"><input type="radio" name="role" value="PATIENT" ${role !== 'DOCTOR' ? 'checked' : ''}><span class="mx-role-icon" aria-hidden="true">♡</span><span><strong>Soy paciente</strong><small>Organiza tu salud y tu expediente personal.</small></span><span class="mx-role-code">PATIENT</span></label>
        <label class="mx-role-choice"><input type="radio" name="role" value="DOCTOR" ${role === 'DOCTOR' ? 'checked' : ''}><span class="mx-role-icon" aria-hidden="true">⚕</span><span><strong>Soy médico</strong><small>Solicita verificación profesional antes de atender pacientes.</small></span><span class="mx-role-code">DOCTOR</span></label>
        <p class="mx-role-info" id="mx-role-info">${role === 'DOCTOR' ? 'Tu perfil no será visible para pacientes hasta que MEXIA verifique tus credenciales.' : 'El registro de paciente es el acceso público predeterminado.'}</p>
        <p class="mx-role-admin">🔒 ADMIN: acceso interno por invitación, nunca por registro público.</p>
      </fieldset>
      <div class="mx-auth-fields">
        <div class="field"><label for="name">Nombre</label><input id="name" name="name" class="input" autocomplete="name" required maxlength="120" placeholder="Ej. Carlos Martínez"></div>
        <div class="field"><label for="email">Correo electrónico</label><input id="email" name="email" class="input" type="email" autocomplete="email" required placeholder="correo@ejemplo.com"></div>
        <div class="field"><label for="password">Contraseña</label><input id="password" name="password" class="input" type="password" autocomplete="new-password" required minlength="8" placeholder="Mínimo 8 caracteres, letras y números"></div>
        <div class="field mx-consent"><label><input name="consent" type="checkbox"> Acepto los términos y condiciones y el aviso de privacidad para el tratamiento de mis datos.</label></div>
        <button class="button primary full mx-intro-cta" type="submit">Crear cuenta</button>
        <p class="mx-auth-switch">¿Ya tienes cuenta? <button class="mx-link" type="button" data-go="login">Inicia sesión</button></p>
      </div></form>
    </section>`;
    },
    mount(root, ctx) {
      const form = root.querySelector('#register-form');
      form.querySelectorAll('[name=role]').forEach((r) => r.addEventListener('change', () => {
        ctx.ui.registrationRole = r.value;
        root.querySelector('#mx-role-info').textContent = r.value === 'DOCTOR'
          ? 'Tu perfil no será visible para pacientes hasta que MEXIA verifique tus credenciales.'
          : 'El registro de paciente es el acceso público predeterminado.';
      }));
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const btn = form.querySelector('[type=submit]');
        busy(btn, async () => {
          const f = readForm(form);
          if (!f.consent) return toast('Debes aceptar los términos para continuar', 'error');
          try {
            const data = await ctx.api.post('/auth/register', f);
            toast('¡Cuenta creada! Bienvenido a MEXIA');
            await afterAuth(ctx, data);
          } catch (err) { toastError(err); }
        });
      });
    },
  },

  login: {
    role: 'PUBLIC',
    render: () => `<section class="mx-intro mx-auth" aria-label="Inicio de sesión">
      <div class="mx-intro-top"><button class="mx-text-button" data-go="welcome" aria-label="Regresar">←</button></div>
      <div class="mx-auth-logo">${LOGO}</div><h1>Bienvenido de nuevo</h1><p class="mx-intro-sub">Tu salud, siempre contigo.</p>
      <form id="login-form" class="mx-auth-fields" novalidate>
        <div class="field"><label for="mx-login-email">Correo electrónico</label><input id="mx-login-email" name="email" class="input" type="email" autocomplete="email" required placeholder="correo@ejemplo.com"></div>
        <div class="field"><label for="mx-login-pass">Contraseña</label><input id="mx-login-pass" name="password" class="input" type="password" autocomplete="current-password" required placeholder="••••••••"></div>
        <button class="button primary full mx-intro-cta" type="submit">Iniciar sesión</button>
        <p class="mx-auth-switch">¿No tienes cuenta? <button class="mx-link" type="button" data-go="account">Crear cuenta</button></p>
        <p class="mx-demo-disclaimer">¿Olvidaste tu contraseña? Por ahora la recuperación se solicita al administrador de MEXIA.</p>
      </form>
    </section>`,
    mount(root, ctx) {
      const form = root.querySelector('#login-form');
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        busy(form.querySelector('[type=submit]'), async () => {
          try { await afterAuth(ctx, await ctx.api.post('/auth/login', readForm(form))); } catch (err) { toastError(err); }
        });
      });
    },
  },

  permissions: {
    role: 'PATIENT', hideHome: true,
    render: () => `<section class="mx-intro mx-permissions" aria-label="Información sobre permisos">
      <div class="mx-permission-hero" aria-hidden="true"><img class="mx-reference-permission" alt="" src="/img/reference-permission.png"></div>
      <h1>Para cuidarte mejor</h1><p class="mx-intro-sub">Algunas funciones usan permisos de tu dispositivo. Tú decides cuándo activarlos.</p>
      <div class="mx-permission-list"><div><span>🔔</span><div><strong>Notificaciones</strong><small>Recordatorios de tu salud</small></div><button type="button" class="mx-permission-pill" data-perm-notify>Activar</button></div><div><span>📷</span><div><strong>Cámara</strong><small>Fotos de estudios y documentos</small></div><span class="mx-permission-pill">Al subir</span></div><div><span>📁</span><div><strong>Archivos</strong><small>Adjuntar estudios en PDF o imagen</small></div><span class="mx-permission-pill">Al subir</span></div></div>
      <button class="button primary full mx-intro-cta" data-go="profile">Continuar</button><button class="button full mx-permission-later" data-go="profile">Más tarde</button>
    </section>`,
    mount(root) {
      root.querySelector('[data-perm-notify]')?.addEventListener('click', async (e) => {
        if (!('Notification' in window)) return toast('Tu navegador no admite notificaciones', 'error');
        const r = await Notification.requestPermission();
        e.target.textContent = r === 'granted' ? '✓ Activadas' : 'No activadas';
      });
    },
  },

  profile: {
    role: 'PATIENT', hideHome: true,
    render: (ctx) => {
      const p = ctx.session.profile || {};
      const step = Math.min(2, Math.max(0, ctx.ui.profileStep || 0));
      const labels = ['Tus datos', 'Tu bienestar', 'Antecedentes'];
      const pages = [
        `<div class="field"><label for="preferredName">¿Cómo quieres que te llame?</label><input id="preferredName" name="preferred_name" class="input" maxlength="80" autocomplete="nickname" value="${esc(p.preferred_name)}" placeholder="Ej. Alex"></div>
         <div class="field"><label for="birth">Fecha de nacimiento (opcional)</label><input id="birth" name="birth_date" class="input" type="date" value="${esc(p.birth_date)}"></div>
         <div class="field"><label for="biologicalSex">Sexo biológico (opcional, cuando sea clínicamente relevante)</label><select id="biologicalSex" name="biological_sex" class="select">${['', 'Femenino', 'Masculino', 'Intersexual / variación'].map((x) => `<option value="${x}" ${p.biological_sex === x ? 'selected' : ''}>${x || 'Prefiero no indicarlo ahora'}</option>`).join('')}</select></div>`,
        `<div class="field"><label for="allergies">Alergias (opcional)</label><input id="allergies" name="allergies" class="input" maxlength="500" value="${esc(p.allergies)}" placeholder="Ej. Penicilina / Ninguna conocida"></div>
         <div class="field"><label for="medications">Medicamentos actuales (opcional)</label><input id="medications" name="current_medications" class="input" maxlength="500" value="${esc(p.current_medications)}" placeholder="Escribe los que deseas registrar"></div>`,
        `<div class="field"><label for="conditions">Antecedentes importantes (opcional)</label><textarea id="conditions" name="conditions" class="textarea" rows="4" maxlength="4000" placeholder="Puedes completarlo después">${esc(p.conditions)}</textarea></div>`,
      ];
      return `<section class="mx46-profile"><div class="badge">Perfil de salud</div>
      <h2>Conozcamos tu salud</h2><p class="muted">A tu ritmo. Puedes completar o cambiar estos datos después.</p>
      <div class="mx46-stephead"><span>Paso ${step + 1} de 3 · ${labels[step]}</span><span>${Math.round(((step + 1) / 3) * 100)}%</span></div>
      <div class="mx46-track" role="progressbar" aria-label="Progreso del perfil de salud" aria-valuemin="0" aria-valuemax="3" aria-valuenow="${step + 1}"><span style="width:${((step + 1) / 3) * 100}%"></span></div>
      <div class="card" id="profile-step"><h3>${labels[step]}</h3>${pages[step]}
      <div class="mx46-actions">${step ? '<button type="button" class="button" data-profile-back>Anterior</button>' : '<button type="button" class="button" data-go="permissions">Atrás</button>'}
      <button type="button" class="button primary" data-profile-next>${step === 2 ? 'Guardar y continuar' : 'Guardar y seguir'}</button></div>
      <button type="button" class="button full" data-skip-onboarding style="margin-top:10px">Completar después</button></div>
      <p class="mx46-demo-note">Tus datos se guardan cifrados en tránsito en el servidor de MEXIA y solo tú decides con quién compartirlos.</p></section>`;
    },
    mount(root, ctx) {
      const save = async (extra = {}) => {
        const body = { ...readForm(root.querySelector('#profile-step')), ...extra };
        ctx.session.profile = await ctx.api.patch('/me/profile', body);
      };
      root.querySelector('[data-profile-back]')?.addEventListener('click', () => { ctx.ui.profileStep = (ctx.ui.profileStep || 0) - 1; ctx.render(); });
      root.querySelector('[data-profile-next]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        try {
          const step = ctx.ui.profileStep || 0;
          await save(step === 2 ? { onboarding_done: true } : {});
          if (step === 2) { ctx.ui.profileStep = 0; toast('Perfil guardado'); ctx.go('home'); } else { ctx.ui.profileStep = step + 1; ctx.render(); }
        } catch (err) { toastError(err); }
      }));
      root.querySelector('[data-skip-onboarding]').addEventListener('click', async () => {
        try { ctx.session.profile = await ctx.api.patch('/me/profile', { onboarding_done: true }); ctx.go('home'); } catch (err) { toastError(err); }
      });
    },
  },
};
