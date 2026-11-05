#!/usr/bin/env node
'use strict';
/*
 * Endurance Tool — informe de RENOVACIÓN (a demanda).
 *
 * Para cada plan (o atleta) toma el ÚLTIMO mesociclo del plan vigente (+ el
 * anterior si el último dura <= 2 microciclos) y, sesión por sesión, contrasta
 * lo PROGRAMADO (bloques con ritmo objetivo) contra lo EJECUTADO:
 *   - ritmo real por FIT (resume.laps) si hay dispositivo;
 *   - si no, ritmo medio manual (athlete_distance/duration) + ritmos parseados
 *     del comentario del atleta;
 *   - si no hay nada, "sin datos de ritmo".
 * Además sRPE prog vs real, adherencia por microciclo, dolor.
 *
 * Uso: node renewal.js <plan_id> [<plan_id> ...]        (valida con ids)
 *      node renewal.js --athlete "Nombre Apellido" ...  (resuelve por nombre)
 * Salida: report/renewal-<plan>-data.json por plan.
 */
const ET = require('./lib/endurance');
const https = require('https');
const fs = require('fs');
const path = require('path');

const API = 'https://api.app.endurancegroup.org/front_ws/call/';
const agent = new https.Agent({ ca: fs.readFileSync('/root/.ccr/ca-bundle.crt'), keepAlive: true });
const OUT = path.join(__dirname, 'report');

function call(name, args, auth) {
  return new Promise((res, rej) => {
    const p = JSON.stringify({ id: null, session: '', name, args: args || {} });
    const r = https.request(API, { method: 'POST', agent, headers: { 'content-type': 'application/json;charset=UTF-8', accept: 'application/json', referer: 'https://etangular.endurancegroup.org/', authorization: auth } },
      (x) => { let b = ''; x.on('data', (c) => (b += c)); x.on('end', () => { try { const j = JSON.parse(b); j.error ? rej(new Error(j.error_msg || name)) : res(j.response); } catch (e) { rej(e); } }); });
    r.on('error', rej); r.setTimeout(30000, () => r.destroy(new Error('timeout'))); r.write(p); r.end();
  });
}

// --- parse paces ("7.37/km", "7'37\"/km", "5:10", "a 6.00 el km", "ritmo 6'10") ---
function parseCommentPaces(txt) {
  if (!txt) return [];
  const out = [];
  // number like 7.37 / 7'37" / 7:37 / 7’37, optionally followed by km marker
  const re = /(\d{1,2})\s*[.:'’]\s*(\d{2})\s*(?:"|”|''|′′)?\s*(\/?\s*km|min\s*\/?\s*km|el\s*km|\/km)?/gi;
  let m;
  while ((m = re.exec(txt)) !== null) {
    const mm = +m[1], ss = +m[2];
    if (ss >= 60) continue;               // not a valid seconds field
    const hasKm = !!m[3];
    // keep only plausible running paces (2:30–12:00 /km), and prefer those with a km marker
    const totalMin = mm + ss / 60;
    if (totalMin < 2.4 || totalMin > 12) continue;
    out.push({ pace: `${mm}'${String(ss).padStart(2, '0')}"/km`, km: hasKm });
  }
  // de-dupe, prefer km-marked
  const seen = new Set(); const res = [];
  for (const p of out.sort((a, b) => (b.km ? 1 : 0) - (a.km ? 1 : 0))) {
    if (seen.has(p.pace)) continue; seen.add(p.pace); res.push(p);
  }
  return res;
}

const fmtMag = (o) => (o && o.magnitude != null ? o.format : '');
const magKm = (o) => (o && o.magnitude != null ? (o.unit === 'm' ? o.magnitude / 1000 : o.magnitude) : null);
const magMin = (o) => (o && o.magnitude != null ? (o.unit === 'min' ? o.magnitude : o.magnitude / 60) : null);
function paceFrom(km, min) { if (!km || !min || km <= 0) return ''; let s = Math.round((min * 60) / km); const mm = Math.floor(s / 60), ss = s % 60; return `${mm}'${String(ss).padStart(2, '0')}"/km`; }

// el objetivo es una ZONA (rango), no un ritmo único; el coach puede indicar piso/mitad/techo en notes.
function zoneLevel(notes) {
  const n = (notes || '').toLowerCase();
  const t = [];
  if (/piso|parte baja|bajo de (la )?zona/.test(n)) t.push('piso');
  if (/mitad|medio de (la )?zona|parte media/.test(n)) t.push('mitad');
  if (/techo|parte alta|alto de (la )?zona/.test(n)) t.push('techo');
  return t.join('-'); // ej. "mitad-techo"
}
function programmedTargets(sessionFull) {
  const targets = [];
  for (const act of (sessionFull.activities || [])) {
    for (const sec of (act.sections || [])) {
      if (sec.text_only) continue;
      const w = sec.work; if (!w) continue;
      const det = (w.details || '');
      const mPace = det.match(/(\d{1,2}'\d{2}"?\s*\/\s*km)/);
      const km = magKm(w.distance), min = magMin(w.duration);
      if (!mPace && !(km || min)) continue;
      const vf = (w.value && w.value.format) || '';
      const range = /km/.test(vf) ? vf.replace(/\s*\/\s*km/g, '').replace(/\s*-\s*/, '–').replace(/"/g, '').trim() : '';
      const mName = det.match(/\[Zona\s*\d+:\s*([^,\]]+)/);
      const notes = (w.notes || '').replace(/\s+/g, ' ').trim();
      targets.push({
        label: `${sec.series || 1}x${sec.repetitions || 1}`,
        zone: w.zone_number || sec.workout_variable || '',
        target: mPace ? mPace[1].replace(/\s+/g, '') : '',
        range, zoneName: mName ? mName[1].trim() : '', notes, nivel: zoneLevel(notes),
        dist: km, dur: min,
      });
    }
  }
  return targets;
}

// today's Buenos Aires date (UTC-3)
function todayAR() { return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10); }
function microExecuted(mi) {
  let n = 0; const s = mi.sessions || {};
  for (const mom of ['am', 'pm']) for (const x of (s[mom] || [])) if (x && x.id && (x.status === 'finished' || x.athlete_rpe != null || x.has_feedback)) n++;
  return n;
}
function mesoExecuted(m) { return (m.micros || []).reduce((a, mi) => a + microExecuted(mi), 0); }

// Period to report: the mesociclo that contains today (the "semana en curso"), else
// the most recent one already started, else the last. Per Gianluca's rule, add the
// previous mesociclo if the chosen one lasts <=2 microciclos. Extension: if the chosen
// period has no executed sessions yet (e.g. a just-started or interrupted block), also
// pull in the previous mesociclo so the renewal isn't blank.
// --- name -> athlete -> vigente plan resolver -----------------------------
function norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function lev(a, b) {
  const m = a.length, n = b.length; const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
function matchAthlete(name, roster) {
  const q = norm(name), qt = q.split(' ').filter(Boolean);
  const tokenHit = (t, ft) => ft.some((f) => f === t || (t.length >= 4 && (f.startsWith(t) || lev(f, t) <= 1)));
  let best = null, bestScore = -1;
  for (const a of roster) {
    const full = norm(a.full_name), ft = full.split(' ').filter(Boolean);
    let score = 0;
    const hits = qt.filter((t) => tokenHit(t, ft)).length;
    if (full === q) score = 100;
    else if (qt.length && qt.every((t) => ft.includes(t))) score = 85;        // every query token present exactly
    else if (hits >= 2) score = 60 + hits;                                     // >=2 name parts align (first+last) → safe
    else if (qt.length === 1 && hits === 1) score = 70;                        // single distinctive name, exact/typo/prefix
    else if (qt.length >= 2 && hits === 1 && lev(full, q) <= 2) score = 55;    // multi-word but very close overall
    // a lone first-name hit in a multi-word query is NOT enough (avoids false positives)
    if (score > bestScore) { bestScore = score; best = a; }
  }
  return bestScore >= 55 ? { athlete: best, score: bestScore } : { athlete: null, score: bestScore };
}
async function resolveNames(session, names) {
  const al = await call('athlete_list', {}, session);
  const r = al.athletes || al.athlete_list || (Array.isArray(al) ? al : Object.values(al));
  const roster = Array.isArray(r) ? r : Object.values(r);
  const resolved = [], unmatched = [];
  for (const name of names) {
    const { athlete, score } = matchAthlete(name, roster);
    if (!athlete) { unmatched.push({ name, reason: 'sin coincidencia' }); continue; }
    const planId = athlete.active_plan || athlete.current_plan_id;
    if (!planId) { unmatched.push({ name, reason: `"${athlete.full_name}" sin plan vigente` }); continue; }
    resolved.push({ input: name, athlete: athlete.full_name, athlete_id: athlete.id, planId, score });
  }
  return { resolved, unmatched };
}

function selectPeriod(mesos) {
  if (!mesos.length) return [];
  const today = todayAR();
  let idx = mesos.findIndex((m) => m.start_date && m.end_date && m.start_date <= today && today <= m.end_date);
  if (idx < 0) { // none contains today -> last one already started, else the last
    for (let i = mesos.length - 1; i >= 0; i--) { if (!mesos[i].start_date || mesos[i].start_date <= today) { idx = i; break; } }
    if (idx < 0) idx = mesos.length - 1;
  }
  const sel = [mesos[idx]];
  const needPrev = ((mesos[idx].micros || []).length <= 2) || mesoExecuted(mesos[idx]) === 0;
  if (needPrev && idx >= 1) sel.unshift(mesos[idx - 1]);
  return sel;
}

// --- Emparejado de FITs ejecutados en OTRO día (mismo criterio que fb-fit del feedback) ---
const d10 = (s) => String(s || '').slice(0, 10);
function dayDiff(a, b) { return Math.round((Date.parse(d10(a) + 'T00:00:00Z') - Date.parse(d10(b) + 'T00:00:00Z')) / 86400000); }
// reloj GPS real (da laps) vs app de teléfono (Nike/Strava genérico = solo resumen)
function realDevice(dev) {
  const n = ((dev && dev.device_name) || '').toLowerCase(), o = ((dev && dev.origin) || '').toLowerCase();
  if (/garmin|amazfit|coros|polar|suunto|apple ?watch|wahoo|fitbit|huawei|forerunner|fenix|instinct|venu|vivoactive|epix|enduro|galaxy watch/.test(n)) return true;
  return o === 'garmin';
}
// laps + ritmo de un resume_id (mismo shape que el loop principal)
async function fitLaps(resumeId, auth) {
  let r; try { r = await call('session_resume', { resume_id: resumeId }, auth); } catch (_) { return null; }
  const rz = (r && (r.resume || r)) || null;
  if (!rz || !Array.isArray(rz.laps) || !rz.laps.length) return null;
  const km = (rz.total_distance || 0) / 1000, durMin = (rz.total_timer_time || rz.total_elapsed_time || 0) / 60;
  const laps = rz.laps.map((l, i) => {
    const t = l.total_elapsed_time || l.total_timer_time || 0, d = l.total_distance || 0;
    return { n: i + 1, time: `${Math.floor(t / 60)}'${String(Math.round(t % 60)).padStart(2, '0')}"`, timeSec: t, distKm: +d.toFixed(2),
      pace: (l.avg_speed && l.avg_speed.format) || paceFrom(d, t / 60), hrA: l.avg_heart_rate || '', hrM: l.max_heart_rate || '' };
  }).filter((l) => l.timeSec > 0 || l.distKm > 0);
  return { laps, realPace: paceFrom(km, durMin), realDist: km ? km.toFixed(2) + ' km' : '',
    realDur: durMin ? `${Math.floor(durMin)}'${String(Math.round((durMin % 1) * 60)).padStart(2, '0')}"` : '' };
}
// Enriquecer las sesiones de un micro con FITs reales que ET no pegó (ejecutados en otro día).
// `sessions` se muta; devuelve cuántas sesiones pasaron a ejecutadas (para sumar a `done`).
async function pairCrossDayFits(session, microId, sessions, rawRun) {
  let extraDone = 0;
  let gm; try { gm = await call('get_micro', { micro_id: String(microId) }, session); } catch (_) { return { extraDone, loose: [] }; }
  const micro = (gm && (gm.micro || gm)) || {};
  let fits = [];
  for (const slot of (micro.fits || [])) if (Array.isArray(slot)) for (const f of slot) if (f && f.id) {
    const dev = f.device_info || {};
    if (!realDevice(dev) || !/run/i.test(f.sport_code || '')) continue;
    fits.push({ id: f.id, date: d10(f.session_date), km: parseFloat(dev.distance) || 0 });
  }
  // de-dup (misma corrida subida por 2 fuentes: misma fecha ±1 y distancia ~igual)
  const kept = [];
  for (const f of fits.sort((a, b) => a.date.localeCompare(b.date))) {
    const dup = kept.some((k) => Math.abs(dayDiff(f.date, k.date)) <= 1 && (!f.km || !k.km || Math.abs(k.km - f.km) / Math.max(k.km, f.km) <= 0.2));
    if (!dup) kept.push(f);
  }
  const assigned = new Set(), usedFit = new Set();
  for (const f of kept) {
    // si ya hay una sesión con FIT en esa fecha, ese fit ya está representado (ET lo pegó)
    if (sessions.some((ss) => ss.date === f.date && ss.hasFit)) { usedFit.add(f.id); continue; }
    let best = null, bs = 1e9;
    for (const x of rawRun) {
      const ss = sessions[x.idx];
      if (ss.hasFit || assigned.has(x.idx)) continue;
      const dd = Math.abs(dayDiff(f.date, ss.date)); if (dd > 4) continue;
      const pk = x.progM / 1000;
      if (f.km && pk && dd > 0 && Math.abs(f.km - pk) > Math.max(2.5, pk * 0.6)) continue; // rechaza mismatch de distancia (salvo mismo día)
      const score = dd + ((f.km && pk) ? Math.abs(f.km - pk) * 0.6 : 0);
      if (score < bs) { bs = score; best = x; }
    }
    if (!best) continue;
    const fl = await fitLaps(f.id, session);
    if (!fl) continue;
    const ss = sessions[best.idx];
    if (!ss.executed) { ss.executed = true; extraDone++; }
    ss.hasFit = true; ss.laps = fl.laps; ss.realPace = fl.realPace; ss.realDist = fl.realDist; ss.realDur = fl.realDur; ss.source = 'FIT';
    if (ss.date !== f.date) ss.execDate = f.date;
    assigned.add(best.idx); usedFit.add(f.id);
  }
  // fits que no matchean ninguna sesión -> filas "(actividad sin sesión programada)"
  const loose = [];
  for (const f of kept) {
    if (usedFit.has(f.id)) continue;
    const fl = await fitLaps(f.id, session); if (!fl) continue;
    loose.push({ date: f.date, moment: '', title: '(actividad sin sesión programada)', due: true, future: false, cat: '', key: false,
      status: 'Finished', executed: true, hasFit: true, strength: false, progRpe: null, sRPE: null, progDist: '', progDur: '',
      targetPace: '', targets: [], realDist: fl.realDist, realDur: fl.realDur, realPace: fl.realPace, source: 'FIT', laps: fl.laps,
      pain: false, painClass: 'none', comment: '', execDate: null });
  }
  return { extraDone, loose };
}

async function renewalForPlan(session, planId) {
  const tp = await ET.getTrainingPlan(session, planId);
  const plan = tp.plan || {};
  const athlete = tp.athlete ? (tp.athlete.full_name || `${tp.athlete.first_name || ''} ${tp.athlete.last_name || ''}`.trim()) : '';
  const mesos = (plan.macro && plan.macro.mesos) || [];
  const TODAY = todayAR();
  const period = selectPeriod(mesos);
  const micros = [];
  for (const meso of period) {
    for (const mi of (meso.micros || [])) {
      const sessions = [];
      const rawRun = [];                         // sesiones de running vencidas, para emparejar FITs de otros días
      let prog = 0, done = 0, future = 0;        // adherencia = solo sesiones vencidas (fecha <= hoy)
      const slots = mi.sessions || {};
      for (const mom of ['am', 'pm']) for (const s of (slots[mom] || [])) {
        if (!s || !s.id) continue;
        const due = !s.date || s.date <= TODAY;
        // Fuerza/gimnasio: no se reportan feedbacks, así que NO cuenta para adherencia
        // ni para el estado del día (la ejecución se mide solo sobre los runs).
        const typeName = s.type_name || (s.type && s.type.name) || '';
        const strength = /fuerza|gym|gimnas|core|pesas|\bstrength\b/i.test(`${s.title || ''} ${typeName}`);
        // Detalle completo (bloques programados + laps del dispositivo) solo para
        // sesiones vencidas; las futuras se listan livianas (no se analizan aún).
        let full = null;
        if (due && !strength) { try { full = await call('session', { session_id: s.id }, session); } catch (_) {} }
        const rz = full && full.resume;
        // Una sesión con FIT (actividad de dispositivo vinculada) cuenta como realizada
        // aunque no tenga feedback manual (ver manual: sesión roja con FIT = realizada).
        const hasFit = !!(rz && (rz.id || (Array.isArray(rz.laps) && rz.laps.length)));
        const executed = s.status === 'finished' || s.athlete_rpe != null || s.has_feedback || hasFit;
        if (due && !strength) { prog++; if (executed) done++; } else if (!due && !strength) future++;
        const targets = full ? programmedTargets(full) : [];
        const mainTarget = targets.filter((t) => t.target).sort((a, b) => (b.zone || 0) - (a.zone || 0))[0];
        // real pace by source
        let realPace = '', realDist = '', realDur = '', source = 'sin datos', laps = [];
        if (rz && Array.isArray(rz.laps) && rz.laps.length) {
          const km = (rz.total_distance || 0) / 1000;
          const durMin = (rz.total_timer_time || rz.total_elapsed_time || 0) / 60;
          realDist = km ? km.toFixed(2) + ' km' : ''; realDur = durMin ? `${Math.floor(durMin)}'${String(Math.round((durMin % 1) * 60)).padStart(2, '0')}"` : '';
          realPace = paceFrom(km, durMin); source = 'FIT';
          // Lap-by-lap detail (lo que da el contexto real de la sesión: tramos, ritmos, cortes).
          laps = rz.laps.map((l, i) => {
            const t = l.total_elapsed_time || l.total_timer_time || 0;
            const d = l.total_distance || 0; // km
            return {
              n: i + 1,
              time: `${Math.floor(t / 60)}'${String(Math.round(t % 60)).padStart(2, '0')}"`,
              timeSec: t, distKm: +d.toFixed(2),
              pace: (l.avg_speed && l.avg_speed.format) || paceFrom(d, t / 60),
              hrA: l.avg_heart_rate || '', hrM: l.max_heart_rate || '',
            };
          }).filter((l) => l.timeSec > 0 || l.distKm > 0);
        } else {
          const km = magKm(s.athlete_distance), min = magMin(s.athlete_duration);
          if (km || min) { realDist = fmtMag(s.athlete_distance); realDur = fmtMag(s.athlete_duration); realPace = paceFrom(km, min); source = 'manual'; }
          const cps = parseCommentPaces(s.athlete_comment);
          if (cps.length) {
            // summarise: show range + count when the athlete logged many splits
            const toSec = (p) => { const m = p.pace.match(/(\d+)'(\d+)/); return +m[1] * 60 + +m[2]; };
            const secs = cps.map(toSec).sort((a, b) => a - b);
            const fmt = (x) => `${Math.floor(x / 60)}'${String(x % 60).padStart(2, '0')}"/km`;
            const summary = cps.length > 3 ? `${fmt(secs[secs.length - 1])}–${fmt(secs[0])} (${cps.length} tramos)` : cps.map((c) => c.pace).join(' / ');
            realPace = (realPace ? realPace + ' · ' : '') + summary;
            source = source === 'manual' ? 'manual+coment.' : 'comentario';
          }
        }
        const it = (s.type && s.type.intensity_type) || '';
        const idx = sessions.length;
        sessions.push({
          date: s.date, moment: mom.toUpperCase(), title: s.title, due, future: !due,
          cat: it === 'THT' ? 'ThT' : it === 'LIT' ? 'LIT' : it === 'HIT' ? 'HIT' : (it || ''),
          key: !!s.key_session, status: !due ? 'Futura' : (s.get_status_display || s.status), executed, hasFit, strength,
          progRpe: s.rpe != null ? s.rpe : null, sRPE: s.athlete_rpe != null ? s.athlete_rpe : null,
          progDist: fmtMag(s.distance), progDur: fmtMag(s.duration),
          targetPace: mainTarget ? mainTarget.target : '', targets,
          realDist, realDur, realPace, source: due ? source : '', laps, execDate: null,
          pain: ET.detectPain ? ET.detectPain((s.athlete_comment || '').trim()) : false,
          painClass: ET.classifyPain ? ET.classifyPain((s.athlete_comment || '').trim()) : 'none',
          comment: (s.athlete_comment || '').replace(/\s+/g, ' ').trim().slice(0, 600),
        });
        if (due && !strength) rawRun.push({ idx, date: s.date, progM: (s.distance && s.distance.magnitude) || 0 });
      }
      // Emparejar FITs ejecutados en OTRO día (ET no los pegó): get_micro + match por fecha±4 + distancia.
      const paired = await pairCrossDayFits(session, mi.id, sessions, rawRun);
      done += paired.extraDone;
      for (const l of paired.loose) sessions.push(l);
      sessions.sort((a, b) => String(a.date).localeCompare(String(b.date)));
      micros.push({ meso: meso.name || `Meso ${meso.number || ''}`, number: mi.number, start: mi.start_date, end: mi.end_date, future,
        progVol: fmtMag(mi.prog_distance), realVol: fmtMag(mi.real_distance),
        progSessions: prog, doneSessions: done, adherence: prog ? Math.round(100 * done / prog) : 0, sessions });
    }
  }
  // nivel real del atleta: pico de volumen semanal programado en TODO el plan (no solo el meso actual)
  // + disciplina oficial de ET (para no confundir a un fondista en receso con un iniciante).
  let _peakM = 0;
  for (const _m of mesos) for (const _mi of (_m.micros || [])) {
    const _v = (_mi.prog_distance && _mi.prog_distance.magnitude) || 0;
    if (_v > _peakM) _peakM = _v;
  }
  const discipline = plan.discipline ? (plan.discipline.name || plan.discipline.code || '') : ((plan.sport && plan.sport.name) || '');
  const data = { generatedAt: new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }),
    athlete, plan: { id: plan.id, title: plan.title, start: plan.start_date, end: plan.end_date, status: plan.get_status_display || plan.status },
    discipline, planPeakKm: Math.round(_peakM / 100) / 10,
    periodMesos: period.map((m) => m.name || m.number), micros };
  fs.mkdirSync(OUT, { recursive: true });
  const f = path.join(OUT, `renewal-${planId}-data.json`);
  fs.writeFileSync(f, JSON.stringify(data, null, 2));
  const totP = micros.reduce((s, m) => s + m.progSessions, 0), totD = micros.reduce((s, m) => s + m.doneSessions, 0);
  console.log(`${athlete} · "${plan.title}" · período ${data.periodMesos.join(' + ')} · ${micros.length} micros · adherencia ${totP ? Math.round(100 * totD / totP) : 0}% (${totD}/${totP}) -> ${path.basename(f)}`);
  return data;
}

// Split a pasted list into names: by newlines or commas; drop numbering/bullets.
function parseNameList(raw) {
  return String(raw || '').split(/[\n,;]+/).map((s) => s.replace(/^\s*(?:\d+[.)]\s*|[-*•]\s*)/, '').trim())
    .filter((s) => s && !/^\d+$/.test(s));
}

async function main() {
  const email = process.env.ET_EMAIL, password = process.env.ET_PASSWORD;
  const { session } = await ET.login(email, password);
  const argv = process.argv.slice(2);

  const ids = argv.filter((a) => /^\d+$/.test(a));
  let names = [];
  const fileIdx = argv.indexOf('--file');
  if (fileIdx >= 0 && argv[fileIdx + 1]) names = names.concat(parseNameList(fs.readFileSync(argv[fileIdx + 1], 'utf8')));
  const namesIdx = argv.indexOf('--names');
  if (namesIdx >= 0) names = names.concat(argv.slice(namesIdx + 1).filter((a) => a !== '--file' && !/^\d+$/.test(a)));

  const planIds = ids.map((x) => parseInt(x, 10));
  if (names.length) {
    const { resolved, unmatched } = await resolveNames(session, names);
    console.log(`Resueltos ${resolved.length}/${names.length} nombres:`);
    resolved.forEach((r) => console.log(`  "${r.input}" → ${r.athlete} (plan ${r.planId})${r.score < 85 ? '  ⚠ revisar (coincidencia aproximada)' : ''}`));
    if (unmatched.length) { console.log('NO resueltos (revisar a mano):'); unmatched.forEach((u) => console.log(`  "${u.name}" — ${u.reason}`)); }
    for (const r of resolved) if (!planIds.includes(r.planId)) planIds.push(r.planId);
    if (argv.includes('--dry')) { console.log('\n(--dry: solo resolución, no se genera informe)'); return; }
  }

  if (!planIds.length) { console.error('Nada para procesar. Pasá IDs de plan o --names "Nombre" ... / --file lista.txt'); process.exit(1); }
  for (const id of planIds) await renewalForPlan(session, id);
}
main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
