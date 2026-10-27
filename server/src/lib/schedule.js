// Cálculo de horarios disponibles. Todo en hora local del consultorio ("YYYY-MM-DD HH:MM:SS").

export const pad = (n) => String(n).padStart(2, '0');

/** "Ahora" en la zona horaria del consultorio, como texto local */
export function nowLocal(tz = 'America/Mexico_City') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const g = (t) => parts.find((p) => p.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}:${g('second')}`;
}

export const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
export const fromMin = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}:00`;

/** weekday 0=Lunes … 6=Domingo para una fecha ISO */
export function weekdayOf(iso) {
  const d = new Date(iso + 'T12:00:00Z').getUTCDay(); // 0=Domingo
  return (d + 6) % 7;
}

export function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function addMinutes(localDT, minutes) {
  const d = new Date(localDT.replace(' ', 'T') + 'Z');
  d.setUTCMinutes(d.getUTCMinutes() + minutes);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

/** Valida que las franjas no se traslapen dentro del mismo día */
export function validateRules(rules) {
  const byDay = new Map();
  for (const r of rules) {
    if (toMin(r.end_time) <= toMin(r.start_time)) return `La franja ${r.start_time.slice(0, 5)}–${r.end_time.slice(0, 5)} termina antes de empezar`;
    const list = byDay.get(r.weekday) || [];
    for (const o of list) {
      if (overlaps(toMin(r.start_time), toMin(r.end_time), toMin(o.start_time), toMin(o.end_time))) {
        return `Hay franjas traslapadas el mismo día (${r.start_time.slice(0, 5)} y ${o.start_time.slice(0, 5)})`;
      }
    }
    list.push(r); byDay.set(r.weekday, list);
  }
  return null;
}

/**
 * Genera huecos libres.
 * @param rules        availability_rules
 * @param timeOff      [{start_at, end_at}]
 * @param busy         citas activas [{start_at, end_at}]
 * @param duration     minutos del servicio
 * @param from,to      fechas ISO (inclusive)
 * @param now          "YYYY-MM-DD HH:MM:SS" local
 */
export function freeSlots({ rules, timeOff, busy, duration, from, to, now }) {
  const out = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const wd = weekdayOf(day);
    for (const r of rules.filter((x) => x.weekday === wd)) {
      const step = Math.max(5, Number(r.slot_minutes) || 30);
      for (let m = toMin(r.start_time); m + duration <= toMin(r.end_time); m += step) {
        const start = `${day} ${fromMin(m)}`;
        const end = addMinutes(start, duration);
        if (start <= now) continue;
        if (timeOff.some((t) => overlaps(start, end, t.start_at, t.end_at))) continue;
        if (busy.some((b) => overlaps(start, end, b.start_at, b.end_at))) continue;
        out.push({ start_at: start, end_at: end });
      }
    }
  }
  return out;
}

/** ¿El inicio solicitado coincide exactamente con un hueco que generaría la agenda? */
export function isValidSlot({ rules, duration, start }) {
  const day = start.slice(0, 10);
  const m0 = toMin(start.slice(11, 16));
  const wd = weekdayOf(day);
  return rules.some((r) => {
    const s = toMin(r.start_time), e = toMin(r.end_time), step = Math.max(5, Number(r.slot_minutes) || 30);
    return m0 >= s && m0 + duration <= e && (m0 - s) % step === 0 && r.weekday === wd;
  });
}

export { overlaps };
