#!/usr/bin/env node
'use strict';
/*
 * Endurance Tool — ALERTA DE ADHERENCIA.
 *
 * Cruza los atletas activos (athlete_list con plan vigente) contra su última
 * actividad registrada en ET y marca a quienes llevan MÁS DE UNA SEMANA sin
 * dejar señal (feedback manual = comentario/sRPE, o FIT = actividad de
 * dispositivo). La idea es avisarle al coach para que les escriba en privado.
 *
 * "Última actividad" por atleta (de su plan vigente):
 *   - feedback manual: sesión con athlete_rpe / has_feedback / finished
 *   - FIT: micros[].fits[].session_date (actividad de dispositivo)
 *
 * Uso: node alert.js                 (todos los atletas con plan vigente)
 *      node alert.js --days 7        (umbral de días, default 7)
 *      node alert.js --names "A" ... (restringe a esos atletas)
 * Salida: report/alert-data.json
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
function todayAR() { return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10); }
function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000); }

function lastActivityOfPlan(tp, today) {
  const plan = tp.plan || {};
  const mesos = (plan.macro && plan.macro.mesos) || [];
  // Actividad por sesión: feedback manual (athlete_rpe/has_feedback/finished) o FIT
  // (campo s.resume_fit — el fits[] del plan trae session_date vacío, no sirve).
  let lastFeedback = null, lastFit = null, lastActivity = null, nPast = 0;
  for (const meso of mesos) {
    for (const mi of (meso.micros || [])) {
      const slots = mi.sessions || {};
      for (const mom of ['am', 'pm']) for (const s of (slots[mom] || [])) {
        if (!s || !s.id || !s.date || s.date > today) continue;
        nPast++;
        const manual = s.athlete_rpe != null || s.has_feedback || s.status === 'finished';
        const fit = !!s.resume_fit;
        if (manual && (!lastFeedback || s.date > lastFeedback)) lastFeedback = s.date;
        if (fit && (!lastFit || s.date > lastFit)) lastFit = s.date;
        if ((manual || fit) && (!lastActivity || s.date > lastActivity)) lastActivity = s.date;
      }
    }
  }
  return { lastFeedback, lastFit, lastActivity, nPast, notStarted: nPast === 0,
    planTitle: plan.title, planEnd: plan.end_date,
    planExpired: plan.end_date ? plan.end_date < today : false };
}

async function main() {
  const { session } = await ET.login(process.env.ET_EMAIL, process.env.ET_PASSWORD);
  const argv = process.argv.slice(2);
  const di = argv.indexOf('--days');
  const thr = di >= 0 ? parseInt(argv[di + 1], 10) : 7;
  const namesIdx = argv.indexOf('--names');
  const onlyNames = namesIdx >= 0 ? argv.slice(namesIdx + 1).filter((a) => !/^--/.test(a)).map((s) => s.toLowerCase()) : null;
  const today = todayAR();

  // Config de estados (standby / off) — atletas activos en el equipo pero sin entrenar.
  let cfg = { standby: [], off: [] };
  try { cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config-standby.json'), 'utf8')); } catch (_) {}
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const matchCfg = (name, list) => (list || []).find((e) => { const en = norm(e.name || e); const nn = norm(name); return en === nn || nn.includes(en) || en.includes(nn); });

  const al = await call('athlete_list', {}, session);
  const roster = (Array.isArray(al) ? al : (al.athletes || al.athlete_list || Object.values(al)));
  // Activo = tiene plan activo y figura la fecha de su última sesión programada.
  let active = roster.filter((a) => (a.active_plan || a.current_plan_id) && a.last_programmed_session);
  if (onlyNames) active = active.filter((a) => onlyNames.some((n) => (a.full_name || '').toLowerCase().includes(n)));

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rows = [];
  for (const a of active) {
    const off = matchCfg(a.full_name, cfg.off);
    const sb = matchCfg(a.full_name, cfg.standby);
    const planId = a.active_plan || a.current_plan_id;
    // fetch con reintentos: un plan largo puede dar timeout y NO debe convertirse en falsa alerta.
    let tp = null, err = null;
    for (let i = 0; i < 3 && !tp; i++) { try { tp = await ET.getTrainingPlan(session, planId); } catch (e) { err = e; await sleep(600 * (i + 1)); } }
    const info = tp ? lastActivityOfPlan(tp, today)
      : { lastActivity: null, lastFeedback: null, lastFit: null, nPast: null, notStarted: false, planTitle: '', planEnd: '', planExpired: false };
    const days = info.lastActivity ? daysBetween(info.lastActivity, today) : null;
    let status, motivo = '';
    if (!tp) { status = 'sin_dato'; motivo = (err && err.message) || 'no se pudo leer el plan'; }
    else if (off) { status = 'off'; motivo = off.motivo || ''; }
    else if (sb) { status = 'standby'; motivo = sb.motivo || ''; }
    else if (info.notStarted) status = 'por_comenzar';            // plan futuro, aún no arrancó
    else if (days == null || days > thr) status = 'alerta';       // plan vencido reciente aplica igual
    else status = 'ok';
    rows.push({ athlete: a.full_name, athlete_id: a.id, planId, lastProgrammed: a.last_programmed_session,
      ...info, daysSince: days, status, motivo });
  }
  rows.sort((x, y) => (y.daysSince == null ? 1e9 : y.daysSince) - (x.daysSince == null ? 1e9 : x.daysSince));

  const by = (st) => rows.filter((r) => r.status === st);
  const data = { generatedAt: new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }),
    today, thresholdDays: thr, total: rows.length,
    counts: { alerta: by('alerta').length, standby: by('standby').length, off: by('off').length, por_comenzar: by('por_comenzar').length, ok: by('ok').length, sin_dato: by('sin_dato').length },
    rows };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'alert-data.json'), JSON.stringify(data, null, 2));
  console.log(`Activos: ${rows.length} · ALERTA (>${thr}d sin reportar): ${data.counts.alerta} · standby: ${data.counts.standby} · off: ${data.counts.off} · por comenzar: ${data.counts.por_comenzar} · ok: ${data.counts.ok} · sin dato: ${data.counts.sin_dato}`);
  console.log('\n— ALERTA (escribirles): —');
  for (const r of by('alerta')) console.log(`  ⚠ ${r.athlete} — ${r.daysSince == null ? 'SIN actividad registrada' : r.daysSince + ' días'} (último: ${r.lastActivity || '—'})${r.planExpired ? ' · plan vencido' : ''}`);
  for (const [st, lbl] of [['standby', 'Standby (no se alertan)'], ['por_comenzar', 'Plan por comenzar'], ['sin_dato', 'Sin dato (reintentar)'], ['off', 'Off']]) {
    if (by(st).length) { console.log(`\n— ${lbl}: —`); for (const r of by(st)) console.log(`  · ${r.athlete}${r.motivo ? ' — ' + r.motivo : ''}`); }
  }
}
main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
