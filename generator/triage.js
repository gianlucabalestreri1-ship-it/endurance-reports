#!/usr/bin/env node
'use strict';
/*
 * TRIAGE de renovaciones por ARQUETIPO de trabajo.
 * Lee report/plans-expiry-data.json (vencidos + por vencer ≤7d), y por cada plan
 * baja training_plan(full), clasifica al atleta en un arquetipo, DETECTA con qué
 * plantilla de la librería ET viene entrenando (plan/meso/sesiones), y calcula los
 * flags de decisión (ejecución vs programado, feedback sí/no, molestia, próx comp).
 * Salida: report/triage-data.json  (para make_triage_xlsx.py).
 */
const fs = require('fs');
const ET = require('./et-client');
const LIB = require('../lib/endurance');
const ROOT = __dirname + '/../';
const TODAY = new Date().toISOString().slice(0, 10);
const LIBE = JSON.parse(fs.readFileSync(ROOT + 'data/libreria-et.json', 'utf8'));

const nz = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const exec = (se) => !!(se.has_feedback || se.athlete_rpe != null || se.resume_fit || se.get_status_display === 'Finished' || (se.athlete_comment || '').trim());
const isRun = (t) => !/fuerza|gym|core|strength|movilidad/i.test(t || '');
function sess(mic) { const sl = mic.sessions || {}; let a = []; ['am', 'pm'].forEach((k) => (sl[k] || []).forEach((se) => { if (se && se.id) a.push(se); })); return a; }
function daysAgo(d) { return (new Date(TODAY) - new Date(d)) / 86400000; }
// book_shop_template -> {name, folder} resumido (el campo autoritativo: de qué plantilla de librería salió)
function bst(o) {
  const b = o && o.book_shop_template; if (!b) return null;
  return { name: b.name || '', folder: b.folder_name || '', desc: b.description || '' };
}
// "VERDICTO EXPRESS ..." u otra línea de cierre del filtro de decisión del coach
function verdict(desc) {
  if (!desc) return '';
  const m = desc.match(/VERDICTO[^\n]*/i); if (m) return m[0].trim().slice(0, 240);
  return '';
}
function nextMesoHint(name) { const m = (name || '').match(/mesociclo\s*(\d+)/i) || (name || '').match(/mes\s*(\d+)/i); return m ? `siguiente: Mesociclo ${+m[1] + 1}` : ''; }
// frase alrededor de la palabra de dolor (para que la molestia se explique sola)
const PAIN_W = /(dolor|molest|duele|duelen|lesi[oó]n|pinchazo|contractur|sobrecarg|tir[oó]n|calambr|inflama|resent|pincha|hinch|adolor)/i;
function painPhrase(c) { c = (c || '').replace(/\s+/g, ' ').trim(); const m = PAIN_W.exec(c); if (!m) return c.slice(0, 60); const i = m.index; return (i > 22 ? '…' : '') + c.slice(Math.max(0, i - 22), i + 48).trim() + (i + 48 < c.length ? '…' : ''); }

// ---- arquetipos ----  (usa discipline oficial + roadmap de librería, no la distancia de una carrera lejana)
function discToArq(dname) {
  const d = nz(dname);
  if (/42|marat/.test(d)) return 'A5';
  if (/21|media|half/.test(d)) return 'A4';
  if (/10k|calle-10/.test(d)) return 'A3';
  if (/5k|calle-5/.test(d)) return 'A3';
  if (/1500|800|pista|medio fondo/.test(d)) return 'A6';
  return null;
}
function archetype(planTitle, discName, libFolder, libMeso, libPlan, sesSig, volAvg) {
  const lib = nz((libFolder || '') + ' ' + (libMeso || '') + ' ' + (libPlan || ''));
  const t = nz(planTitle);
  // 1) roadmap AUTORITATIVO de librería (book_shop_template) — manda sobre el título
  if (/consolidando al corredor/.test(lib)) return 'A1';
  if (/caminar\s*-?\s*correr|inicio de este camino|primeras zancadas/.test(lib)) return 'A0';
  // 2) objetivo explícito en el título del plan
  if (/42k|marat|ultra|trail|utachh|canalla|100k|50k/.test(t)) return 'A5';
  if (/\b21k|media|half/.test(t)) return 'A4';
  if (/1000m|1500|800m|\b800\b|vvo2|medio fondo|mil metros/.test(t)) return 'A6';
  if (/\b10k|\b5k|5k10k/.test(t)) return 'A3';
  // 3) roadmap por título (fallback si no hubo book_shop_template)
  if (/consolidando al corredor/.test(t)) return 'A1';
  if (/primeras zancadas|inicio de este camino/.test(t)) return 'A0';
  // 4) plan de bienvenida / inicio sin plantilla -> primeros pasos
  if (/bienvenid|inicio de proceso|empezamos proceso|arrancamos|comienzo de proceso|vuelta al entrenamiento/.test(t)) return volAvg < 14 ? 'A0' : 'A1';
  // 5) disciplina oficial de ET
  const da = discToArq(discName); if (da) return da;
  // 6) firma de sesiones (principiante si domina trote continuo / caminata y poco volumen)
  if (/trote continuo|caminata|caminar/.test(sesSig) && volAvg < 15) return 'A1';
  return 'A2';
}
const ARQ_NAME = {
  A0: 'Primeros pasos (caminar / correr)',
  A1: 'Post primeros pasos (consolidando al corredor)',
  A2: 'Corredor en base / desarrollo (sin carrera inminente)',
  A3: 'Prepara 10K (5-10K)',
  A4: 'Prepara 21K',
  A5: 'Prepara 42K / ultra / trail',
  A6: 'Medio fondo / velocidad (800-1500-3000, vVO2)',
};

async function analyzePlan(s, planId, athleteName, urg) {
  const tp = await ET.trainingPlan(s, planId);
  const plan = tp.plan || {};
  const mesos = (plan.macro && plan.macro.mesos) || [];
  const discName = (plan.discipline && plan.discipline.name) || '';
  const planBST = bst(plan);
  let progRun = 0, execRun = 0, progKm = 0, execKm = 0, fbCount = 0, pains = [], sesTitles = [], weeksN = new Set();
  let curMeso = null, recentMeso = null, recentDate = '';
  const mesoStats = [];  // adherencia por meso (para tendencia)
  for (const m of mesos) {
    const inNow = m.start_date && m.end_date && m.start_date <= TODAY && TODAY <= m.end_date;
    if (inNow) curMeso = m;
    // adherencia propia del meso (todas sus sesiones de carrera)
    let mp = 0, me = 0, lastD = '';
    for (const mic of (m.micros || [])) for (const se of sess(mic)) {
      if (!isRun(se.type_name)) continue;
      mp++; if (exec(se)) me++; if (se.date && se.date > lastD) lastD = se.date;
    }
    const ended = (m.end_date && m.end_date < TODAY) || (lastD && lastD < TODAY && daysAgo(lastD) > 7);
    if (mp > 0 && ended) mesoStats.push({ num: m.number, end: m.end_date || lastD, adh: Math.round(100 * me / mp), prog: mp, exec: me });
    for (const mic of (m.micros || [])) for (const se of sess(mic)) {
      const d = se.date || '';
      // adherencia SOLO sobre semanas realizadas: excluir sesiones FUTURAS (fecha > hoy)
      if (!d || daysAgo(d) > 40 || daysAgo(d) < 0) continue;
      if (d > recentDate) { recentDate = d; recentMeso = m; }
      weeksN.add(d.slice(0, 7) + '-' + Math.floor(new Date(d).getDate() / 7));
      if (se.title && isRun(se.type_name)) sesTitles.push(se.title);
      if (isRun(se.type_name)) {
        progRun++; if (exec(se)) execRun++;
        const km = se.distance && se.distance.magnitude ? se.distance.magnitude / 1000 : 0; progKm += km;
        const akm = se.athlete_distance && se.athlete_distance.magnitude ? se.athlete_distance.magnitude / 1000 : 0; execKm += akm;
      }
      if ((se.athlete_comment || '').trim()) { fbCount++; if (LIB.classifyPain(se.athlete_comment) === 'active') pains.push(painPhrase(se.athlete_comment)); }
    }
  }
  // meso con el que entrenó ESTE mes (el que contiene hoy, o el más reciente con sesiones)
  const mNow = curMeso || recentMeso || mesos[mesos.length - 1] || {};
  const mesoBST = bst(mNow);
  // librería que está usando: plantilla del MESO ACTUAL (autoritativa para el arquetipo)
  const libMesoName = mesoBST ? mesoBST.name : '';
  const mesoFolder = (mesoBST && mesoBST.folder) || '';
  const libFolder = mesoFolder || (planBST && planBST.folder) || '';
  const libPlanName = planBST ? (planBST.name || planBST.folder) : '';
  const libVerdict = verdict((mesoBST && mesoBST.desc) || '');
  const roadmapNext = nextMesoHint(libMesoName);
  // firma de sesiones (para principiantes sin plantilla)
  const sig = {}; sesTitles.forEach((t) => { const k = nz(t); sig[k] = (sig[k] || 0) + 1; });
  const topSes = Object.entries(sig).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, c]) => ({ sig: k, count: c }));
  const sesSig = sesTitles.map(nz).join(' | ');
  // próxima competencia
  const fut = (plan.competitions || []).filter((c) => c.date && c.date > TODAY).sort((a, b) => (a.date < b.date ? -1 : 1));
  const prox = fut[0] ? { name: fut[0].name || fut[0].title, date: fut[0].date, prio: fut[0].priority } : null;
  const nw = Math.max(1, weeksN.size);
  const volProg = Math.round(progKm / nw), volExec = Math.round(execKm / nw);
  const adh = progRun ? Math.round(100 * execRun / progRun) : null;
  const arq = archetype(plan.title, discName, mesoFolder, libMesoName, '', sesSig, volProg);
  // tendencia de adherencia (últimos 2 mesos con datos)
  mesoStats.sort((a, b) => ((a.end || '') < (b.end || '') ? -1 : 1));
  const last2 = mesoStats.slice(-2);
  let tendencia = 's/d', riesgoAbandono = false;
  if (last2.length === 2) {
    const diff = last2[1].adh - last2[0].adh;
    tendencia = diff >= 12 ? 'sube' : diff <= -12 ? 'baja' : 'estable';
    riesgoAbandono = (last2[1].adh < 45 && diff <= -12) || last2[1].adh <= 20;
  } else if (last2.length === 1) { tendencia = 'estable'; riesgoAbandono = last2[0].adh <= 20; }
  // días a la próxima competencia
  const diasComp = prox ? Math.round((new Date(prox.date) - new Date(TODAY)) / 86400000) : null;
  const afinar = diasComp != null && diasComp > 0 && diasComp <= 28;
  // luz verde "listo para avanzar": alta adherencia + sin molestia + con feedback
  const listoAvanzar = !pains.length && fbCount > 0 && adh != null && adh >= 80;
  // acción sugerida (prioridad)
  let accion;
  if (pains.length) accion = 'CUIDAR / ajustar (molestia)';
  else if (progRun > 0 && execRun === 0) accion = 'PEDIR FEEDBACK (renueva a ciegas)';
  else if (afinar) accion = `AFINAR / taper (comp en ${diasComp}d)`;
  else if (adh != null && adh < 50) accion = 'MANTENER (no progresar: <50% vol)';
  else if (listoAvanzar) accion = 'LISTO -> progresar (siguiente bloque)';
  else accion = 'REVISAR (ejecución parcial)';
  return {
    athlete: athleteName, planId, planTitle: plan.title, urgencia: urg,
    arquetipo: arq, arquetipoNombre: ARQ_NAME[arq], disciplina: discName,
    libPlan: libPlanName, libMeso: libMesoName, libFolder, roadmapNext, libVerdict,
    topSes, tendencia, riesgoAbandono, listoAvanzar, diasComp, afinar,
    volProg, volExec, progRun, execRun, adherencia: adh, fbCount,
    molestia: pains.length ? pains[0] : '', proxComp: prox, accion,
  };
}

async function main() {
  const exp = JSON.parse(fs.readFileSync(ROOT + 'report/plans-expiry-data.json', 'utf8'));
  const items = [];
  (exp.expired || []).forEach((p) => items.push({ planId: p.plan_id || p.planId || p.id, name: p.athlete_name, urg: 'VENCIDO', venc: p.last_session_date }));
  (exp.expiring || []).forEach((p) => items.push({ planId: p.plan_id || p.planId || p.id, name: p.athlete_name, urg: 'POR VENCER', venc: p.last_session_date }));
  const s = await ET.login(process.env.ET_EMAIL, process.env.ET_PASSWORD);
  const out = [];
  for (const it of items) {
    try { const r = await analyzePlan(s, it.planId, it.name, it.urg); r.vence = it.venc; out.push(r); console.error('OK', it.name, '->', r.arquetipo, '· lib:', r.libMeso || r.libPlan || '—'); }
    catch (e) { console.error('FAIL', it.name, e.message); out.push({ athlete: it.name, planId: it.planId, urgencia: it.urg, vence: it.venc, arquetipo: 'A2', arquetipoNombre: ARQ_NAME.A2, error: e.message, accion: 'REVISAR (sin datos)' }); }
  }
  fs.writeFileSync(ROOT + 'report/triage-data.json', JSON.stringify({ generatedAt: TODAY, athletes: out }, null, 2));
  console.error('\n-> report/triage-data.json |', out.length, 'atletas');
}
main().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
