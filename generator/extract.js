#!/usr/bin/env node
'use strict';
/*
 * Extractor genérico para el GENERADOR de master por atleta.
 * Uso:  node generator/extract.js --name "Nombre Apellido"
 *       node generator/extract.js --id 50373
 * Escribe report/master-<id>-data.json con TODO lo que el builder necesita:
 * perfil, planes (mesos + grid semanal), competencias, carreras (FIT), zonas,
 * análisis (sesiones fantasma), derivados (años, vol máx/prom, semana tipo),
 * y disciplina/período inferidos para la recomendación.
 */
const fs = require('fs');
const ET = require('./et-client');
const LIB = require('../lib/endurance'); // classifyPain, fitMetric

const RO = ['SPRINT', 'GLUCOLÍTICA', 'VO2MAX', 'SUPRAUMBRAL', 'UMBRAL', 'TEMPO', 'ENDURANCE', 'RECUPERACIÓN', 'FUERZA'];
const QUAL = new Set(['UMBRAL', 'TEMPO', 'VO2MAX', 'SUPRAUMBRAL', 'SPRINT', 'GLUCOLÍTICA']);
const isTest = (t) => /test|valoraci|control/i.test(t || '');
const isRun = (t) => !/fuerza|gym|core|strength|movilidad/i.test(t || '');
const exec = (se) => !!(se.has_feedback || se.athlete_rpe != null || se.resume_fit || se.get_status_display === 'Finished' || (se.athlete_comment || '').trim());

function mapRow(t, it, title) {
  t = t || ''; title = title || '';
  if (/aguas abiertas/i.test(t) || /an[aá]l[ií]?sis/i.test(title)) return 'NOTE';
  if (isTest(t)) return 'TEST';
  if (/competici/i.test(t) && !/modelaci/i.test(t)) return 'COMP';
  if (/modelaci/i.test(t)) return it === 'HIT' ? 'VO2MAX' : it === 'LIT' ? 'ENDURANCE' : 'UMBRAL';
  if (/recuperaci/i.test(t)) return 'RECUPERACIÓN';
  if (/endurance|mantenimiento|fondo/i.test(t)) return 'ENDURANCE';
  if (/tempo/i.test(t)) return 'TEMPO';
  if (/umbral|ftp|mlss/i.test(t)) return 'UMBRAL';
  if (/neuromuscular|velocidad|rst/i.test(t)) return 'SPRINT';
  if (/hiit largo/i.test(t)) return 'SUPRAUMBRAL';
  if (/hiit corto/i.test(t)) return 'VO2MAX';
  if (/glucol/i.test(t)) return 'GLUCOLÍTICA';
  if (/fuerza|gym|core|strength/i.test(t)) return 'FUERZA';
  return 'ENDURANCE';
}
const PHASE = (h, m, l) => (m >= 50 ? 'ESPECÍFICO' : l >= 50 ? 'PREPARATORIO' : h >= 25 ? 'COMPETITIVO' : 'MIXTO');
const phaseInf = (h, m, l) => (m >= 50 ? 'Específico/Umbral (inf.)' : l >= 50 ? 'Base/General (inf.)' : h >= 25 ? 'Competitivo/VO2 (inf.)' : 'Mixto (inf.)');
const periodKey = (ph) => (ph === 'PREPARATORIO' ? 'preparacion_general' : ph === 'COMPETITIVO' ? 'competencia' : 'preparacion_especial');
function minDate(mic) { const sl = mic.sessions || {}; let d = []; ['am', 'pm'].forEach((k) => (sl[k] || []).forEach((se) => { if (se && se.date) d.push(se.date); })); d.sort(); return d[0] || '9999'; }
function sess(mic) { const sl = mic.sessions || {}; let a = []; ['am', 'pm'].forEach((k) => (sl[k] || []).forEach((se) => { if (se && se.id) a.push(se); })); return a; }
function fmtPace(secPerKm) { const m = Math.floor(secPerKm / 60); const s = Math.round(secPerKm % 60); return `${m}'${String(s).padStart(2, '0')}"/km`; }
function splits(laps) {
  let cum = 0, dist = 0, out = [], next = 5;
  for (const l of laps) { cum += l.total_elapsed_time || l.total_timer_time || 0; dist += l.total_distance || 0; while (dist >= next - 0.15) { out.push(`${next}K ${hms(cum)}`); next += 5; } }
  out.push(`Total ${dist.toFixed(1)}K ${hms(cum)}`); return out.join(' · ');
}
function hms(s) { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : '' + m) + ':' + String(ss).padStart(2, '0'); }

function mesoAgg(plan, meso) {
  const micros = (meso.micros || []).slice().sort((a, b) => (minDate(a) < minDate(b) ? -1 : 1));
  let ss = [], dates = [], weeks = [];
  for (const mic of micros) {
    const s = sess(mic); ss = ss.concat(s);
    const ds = s.map((x) => x.date).filter(Boolean).sort();
    const rows = {}; RO.forEach((r) => (rows[r] = { p: 0, e: 0 }));
    let test = null, km = 0, qual = [], longrun = null, longd = 0;
    for (const se of s) {
      const it = (se.type && se.type.intensity_type) || '';
      const r = mapRow(se.type_name, it, se.title);
      if (r === 'NOTE') continue;
      if (r === 'TEST') test = se.type_name; else if (r === 'COMP') { } else if (rows[r]) { rows[r].p++; if (exec(se)) rows[r].e++; }
      const d = se.distance && se.distance.magnitude ? se.distance.magnitude / 1000 : 0; km += d;
      const title = (se.title || '').trim();
      if (QUAL.has(r) && title) qual.push(title);
      if (r === 'ENDURANCE' && d > longd) { longd = d; longrun = title || ('Largo ' + Math.round(d) + 'k'); }
    }
    const key = []; if (longrun && longd >= 12) key.push(longrun); qual.forEach((q) => { if (!key.includes(q)) key.push(q); });
    const comps = (plan.competitions || []).filter((c) => c.date && ds.length && c.date >= ds[0] && c.date <= ds[ds.length - 1]).map((c) => ({ date: c.date, name: c.name || c.title, prio: c.priority }));
    const cHere = (plan.competitions || []).find((c) => c.date && ds.length && c.date >= ds[0] && c.date <= ds[ds.length - 1]);
    weeks.push({ meso: meso.number, phase: PHASE(meso.high_zone, meso.mid_zone, meso.low_zone), start: ds[0] || meso.start_date, end: ds[ds.length - 1] || meso.end_date, rows, test, comp: cHere ? (cHere.name || cHere.title) : null, km: Math.round(km), keyTitles: key.slice(0, 4) });
  }
  const start = meso.start_date || weeks[0] && weeks[0].start, end = meso.end_date || (weeks.length && weeks[weeks.length - 1].end);
  const runs = ss.filter((s) => isRun(s.type_name));
  const executed = ss.filter(exec);
  const comments = ss.filter((s) => (s.athlete_comment || '').trim()).map((s) => ({ date: s.date, type: s.type_name, rpe: s.athlete_rpe, c: (s.athlete_comment || '').trim() }));
  const pains = comments.filter((x) => LIB.classifyPain(x.c) === 'active').map((x) => `${x.date}: ${x.c.slice(0, 70)}`);
  const srpe = ss.filter((s) => s.athlete_rpe != null).map((s) => s.athlete_rpe);
  const tests = ss.filter((s) => isTest(s.type_name)).map((s) => `${s.date} ${s.type_name}`);
  const comps = (plan.competitions || []).filter((c) => c.date && c.date >= start && c.date <= end).map((c) => ({ date: c.date, name: c.name || c.title, prio: c.priority }));
  return {
    id: meso.id, number: meso.number, start, end, weeks: weeks.length, volProg: meso.volume,
    zonesPct: { high: meso.high_zone, mid: meso.mid_zone, low: meso.low_zone }, phaseInf: phaseInf(meso.high_zone, meso.mid_zone, meso.low_zone),
    sessions: ss.length, runs: runs.length, executed: executed.length,
    srpeAvg: srpe.length ? (srpe.reduce((a, b) => a + b, 0) / srpe.length).toFixed(1) : null,
    keySessions: ss.filter((s) => s.key_session).length, tests, pains, comps, comments, weekRows: weeks,
  };
}

async function main() {
  const email = process.env.ET_EMAIL, password = process.env.ET_PASSWORD;
  if (!email || !password) { console.error('Faltan ET_EMAIL/ET_PASSWORD'); process.exit(1); }
  const argv = process.argv.slice(2);
  const idArg = argv[argv.indexOf('--id') + 1]; const nameArg = argv[argv.indexOf('--name') + 1];
  const s = await ET.login(email, password);
  const aths = await ET.athleteList(s);
  let ath;
  if (argv.includes('--id')) ath = aths.find((a) => String(a.id) === String(idArg));
  else { const q = ET.norm(nameArg); ath = aths.find((a) => ET.norm(a.full_name) === q) || aths.find((a) => ET.norm(a.full_name).includes(q)) || aths.find((a) => q.split(' ').every((t) => ET.norm(a.full_name).includes(t))); }
  if (!ath) { console.error('Atleta no encontrado:', nameArg || idArg); process.exit(1); }
  const AID = ath.id;
  console.error('Atleta:', ath.full_name, '(id', AID + ')');

  let plans = await ET.trainingPlanList(s, AID);
  // dedup por (start,end): quedarse con el de más ejecución
  const execCount = {};
  const full = {};
  for (const p of plans) { full[p.id] = await ET.trainingPlan(s, p.id); }
  function planExec(tp) { let n = 0; const ms = (tp.plan && tp.plan.macro && tp.plan.macro.mesos) || []; ms.forEach((m) => (m.micros || []).forEach((mi) => sess(mi).forEach((se) => { if (exec(se)) n++; }))); return n; }
  plans.forEach((p) => (execCount[p.id] = planExec(full[p.id])));
  const byRange = {};
  plans.forEach((p) => { const k = p.start_date + '|' + p.end_date; if (!byRange[k] || execCount[p.id] > execCount[byRange[k].id]) byRange[k] = p; });
  plans = Object.values(byRange)
    // descartar borradores: inactivos sin ninguna ejecución
    .filter((p) => !(/inactive/i.test(p.get_status_display || p.status || '') && execCount[p.id] === 0))
    .sort((a, b) => (a.start_date < b.start_date ? -1 : 1));

  const out = { athleteId: AID, athlete: ath.full_name, generatedAt: new Date().toISOString().slice(0, 10), plans: [], allComps: [], allTests: [], completedComps: [], zones: null, analisis: [], rowOrder: RO };
  let zonesSession = null;
  const compSeen = new Set();
  for (const p of plans) {
    const tp = full[p.id]; const plan = tp.plan || {};
    const mesos = (plan.macro && plan.macro.mesos) || [];
    const mesoA = mesos.map((m) => mesoAgg(plan, m));
    // weeks planos + numeración global
    let wn = 0; const weeks = [];
    mesoA.forEach((m) => m.weekRows.forEach((w) => { wn++; weeks.push({ ...w, n: wn }); }));
    mesoA.forEach((m) => delete m.weekRows);
    out.plans.push({ id: p.id, title: p.title, start: p.start_date, end: p.end_date, status: p.get_status_display || p.status, goal: plan.goal || '', mesos: mesoA, weeks });
    // competencias (todas + completadas) + tests + zonas + analisis
    (plan.competitions || []).forEach((c) => {
      const key = c.date + '|' + (c.name || c.title);
      if (!compSeen.has(key)) { compSeen.add(key); out.allComps.push({ date: c.date, name: c.name || c.title, prio: c.priority, status: c.status || c.get_status_display, dur: (c.athlete_duration && c.athlete_duration.format) || '', comment: (c.athlete_comment || '').trim() }); }
      if (c.status === 'finished' || c.get_status_display === 'Finished') out.completedComps.push({ date: c.date, name: c.name || c.title, dur: (c.athlete_duration && c.athlete_duration.format) || '', rpe: c.athlete_rpe, comment: (c.athlete_comment || '').trim() });
    });
    mesos.forEach((m) => (m.micros || []).forEach((mi) => sess(mi).forEach((se) => {
      if (isTest(se.type_name)) out.allTests.push({ date: se.date, type: se.type_name });
      if (!zonesSession) zonesSession = se.id;
    })));
  }
  out.allComps.sort((a, b) => (a.date < b.date ? -1 : 1));
  out.allTests.sort((a, b) => (a.date < b.date ? -1 : 1));

  // RACES (Competición) con FIT: ritmo/FC/splits/comentario
  for (const p of plans) {
    const tp = full[p.id]; const mesos = (tp.plan && tp.plan.macro && tp.plan.macro.mesos) || [];
    for (const m of mesos) for (const mi of (m.micros || [])) for (const se of sess(mi)) {
      if (!/competici/i.test(se.type_name || '')) continue;
      const det = await ET.session(s, se.id); const rz = det.resume || {}; const fit = LIB.fitMetric(det);
      const km = rz.total_distance ? rz.total_distance / 1000 : 0;
      const secs = rz.total_elapsed_time || rz.total_timer_time || 0;
      const pace = (km && secs) ? fmtPace(secs / km) : '';
      out.races = out.races || [];
      out.races.push({ date: se.date, name: se.title, km: km ? km.toFixed(2) : '', time: secs ? hms(secs) : (se.athlete_duration && se.athlete_duration.format) || '', pace, hr: rz.avg_heart_rate || (fit && fit.hr) || '', parciales: (rz.laps && rz.laps.length) ? splits(rz.laps) : '', comment: (se.athlete_comment || det.athlete_comment || '').trim() });
    }
  }

  // ZONAS (MAS + HR) y ANÁLISIS
  if (zonesSession) {
    const det = await ET.session(s, zonesSession); const tz = det.training_zones || {};
    const pick = (crit) => { const z = tz[crit]; if (!z) return null; return { criteria: crit, model: z.model_name, unit: z.unit, zones: (z.zones || []).map((x) => ({ n: x.number, name: x.name, phase: x.get_phase_display, range: x.range })) }; };
    out.zones = { MAS: pick('MAS'), HR: pick('HR') };
    // vVO2max: punto medio de la zona VO2max de MAS -> km/h
    if (out.zones.MAS) { const z = out.zones.MAS.zones.find((x) => /vo/i.test(x.name)); out.vVO2maxZone = z ? z.range : ''; }
  }
  const RE = /an[aá]l[ií]?sis/i;
  for (const p of plans) {
    const tp = full[p.id]; const mesos = (tp.plan && tp.plan.macro && tp.plan.macro.mesos) || [];
    for (const m of mesos) for (const mi of (m.micros || [])) for (const se of sess(mi)) {
      if (!(/aguas abiertas/i.test(se.type_name || '') || RE.test(se.title || ''))) continue;
      const det = await ET.session(s, se.id); let notes = [];
      (det.activities || []).forEach((a) => (a.sections || []).forEach((sec) => { const ws = Array.isArray(sec.work) ? sec.work : (sec.work ? [sec.work] : []); ws.forEach((w) => { if (w && w.notes) notes.push(w.notes); }); }));
      if (notes.length) out.analisis.push({ date: det.date, notes: notes.join('\n\n').trim() });
    }
  }

  // PERFIL (de cualquier tp.athlete)
  const a = full[plans[0] && plans[0].id] && full[plans[0].id].athlete || {};
  out.profile = { gender: a.gender === 'F' ? 'Femenino' : a.gender === 'M' ? 'Masculino' : (a.gender || ''), age: a.age || '', birth: a.birthdate || '', height: (a.height && a.height.format) || '', weight: (a.weight && a.weight.format) || '', province: a.get_province_display || a.province || '', level: a.get_level_display || a.level || '' };

  // DERIVADOS
  const today = out.generatedAt;
  const starts = plans.map((p) => p.start_date).filter(Boolean); const fy = starts.length ? starts.sort()[0] : today;
  const d0 = new Date(fy), d1 = new Date(today); const mo = (d1.getFullYear() - d0.getFullYear()) * 12 + (d1.getMonth() - d0.getMonth());
  out.anios = { months: mo, texto: `${Math.floor(mo / 12)} año(s) ${mo % 12} mes(es) (desde ${fy})` };
  let volMax = null; out.plans.forEach((p) => p.weeks.forEach((w) => { if (w.km && (!volMax || w.km > volMax.km)) volMax = { km: w.km, date: w.start }; }));
  out.volMax = volMax;
  const act = out.plans.find((p) => p.status === 'Active') || out.plans[out.plans.length - 1];
  out.activePlanId = act && act.id;
  const past = act ? act.weeks.filter((w) => w.start <= today && w.km) : [];
  const l4 = past.slice(-4);
  out.volAvg = l4.length ? Math.round(l4.reduce((s, w) => s + w.km, 0) / l4.length) : 0;
  out.lastWeeksKm = l4.map((w) => w.km);
  // disciplina + período actual inferidos
  let maxk = 0; out.allComps.forEach((c) => { const m = (c.name || '').match(/(\d+)\s*k/i); if (m) maxk = Math.max(maxk, +m[1]); });
  out.disciplina = maxk >= 21 ? '21.1-42.2km' : maxk >= 5 ? '5000-10000m' : '800-3000m';
  const curW = act && (act.weeks.find((w) => w.start <= today && today <= w.end) || past[past.length - 1]);
  const curMeso = act && curW && act.mesos.find((m) => m.number === curW.meso);
  out.currentPhase = curW ? curW.phase : '';
  out.currentPeriodKey = periodKey(out.currentPhase);
  out.currentMeso = curMeso ? { number: curMeso.number, phaseInf: curMeso.phaseInf, volProg: curMeso.volProg } : null;

  if (!fs.existsSync('report')) fs.mkdirSync('report');
  const outf = `report/master-${AID}-data.json`;
  fs.writeFileSync(outf, JSON.stringify(out, null, 1));
  console.error('OK ->', outf, '| planes', out.plans.length, '| carreras', (out.races || []).length, '| análisis', out.analisis.length);
  console.log(outf);
}
main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
