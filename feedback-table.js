#!/usr/bin/env node
'use strict';
/*
 * Endurance Tool — feedback table generator (scheduled task).
 *
 * Logs into Endurance Tool with ET_EMAIL / ET_PASSWORD, reads the web
 * notifications, and builds a coach feedback table grouped by session.
 *
 *   - Sections mirror the notification tabs: Atletas, FIT, Competencias.
 *   - Highlights: sRPE >= 6, completed competitions, pain / discomfort.
 *   - Session type colour code (manual): azul=LIT · amarillo=ThT · rojo=HIT.
 *   - MIT/HIIT/LIT rows show device metrics (distance) only when a FIT
 *     (device) activity is associated with the session.
 *
 * Output: report/feedback-table.html + report/feedback-data.json, and a
 * concise console summary. Use --all to include already-read notifications
 * (default: only unread / pending, i.e. what still needs the coach's review).
 */
const fs = require('fs');
const path = require('path');
const ET = require('./lib/endurance');
const SB = require('./lib/session-blocks');

const ONLY_UNREAD = !process.argv.includes('--all');
const OUT_DIR = path.join(__dirname, 'report');

// Stale-feedback guard: notifications left unread for a long time (old sessions
// never marked read) otherwise surface in the daily report (e.g. 2025 feedbacks
// in an Oct-2026 run). Default window: 30 days. Override with `--days N`
// (0 = no age filter); `--all` and `--all-dates` also disable the age filter.
function argVal(flag) { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : null; }
const NO_AGE_FILTER = process.argv.includes('--all') || process.argv.includes('--all-dates');
const MAX_AGE_DAYS = NO_AGE_FILTER ? Infinity
  : Number(argVal('--days') || process.env.FEEDBACK_MAX_AGE_DAYS || 30) || Infinity;
function parseDMY(s) {
  const m = String(s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])) : null;
}
function tooOld(r) {
  if (!isFinite(MAX_AGE_DAYS)) return false;
  // Age by FEEDBACK date (rawDate = notification date), not the session date:
  // a feedback left today for an old session is still recent (e.g. Melisa Oliva
  // reported 29/10 a session dated 14/10). Falls back to session date.
  const d = parseDMY(r.rawDate || r.date);
  if (!d) return false;                               // no parseable date → keep
  return (Date.now() - d.getTime()) / 86400000 > MAX_AGE_DAYS;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function nl2br(s) { return esc(s).replace(/\n/g, '<br>'); }

const INTENSITY_LABEL = { HIT: 'HIT', ThT: 'ThT', LIT: 'LIT', FZA: 'Fuerza', TEST: 'Test', OTRO: '—' };

function badge(intensity) {
  const label = INTENSITY_LABEL[intensity.cat] || intensity.cat;
  return `<span class="badge ${intensity.color}">${esc(label)}</span>`;
}

function buildHtml(model) {
  const { generatedAt, coach, onlyUnread, counts, atletas, fit, sessionRows, competitions, countdowns } = model;

  const notifRow = (r) => `
    <tr class="${r.unread ? 'unread' : 'read'}">
      <td>${r.unread ? '<span class="dot green" title="Sin leer"></span>' : '<span class="dot" title="Leída"></span>'}</td>
      <td>${esc(r.athlete)}</td>
      <td>${esc(r.date)} ${r.moment ? `<span class="mo">${r.moment}</span>` : ''}</td>
      <td>${esc(r.session || r.title)}</td>
      <td>${r.sessionType ? badge(r.intensity) + ' ' + esc(r.sessionType) : ''}</td>
      <td class="rpe ${r.rpe >= 6 ? 'hot' : ''}">${r.rpe != null ? r.rpe : ''}</td>
      <td class="cmt">${nl2br(r.comment)}${r.pain ? ' <span class="flag pain">⚠ dolor/molestia</span>' : ''}</td>
    </tr>`;

  const blocksHtml = (blocks) => {
    if (!blocks || !blocks.length) return '';
    return '<div class="blocks">' + blocks.map((l) => {
      const cls = l.kind === 'pause' ? 'bpause' : l.kind === 'warm' ? 'bwarm'
        : l.kind === 'rec' ? 'brec' : /no ejecutado/.test(l.text) ? 'bno' : 'bwork';
      return `<div class="${cls}">${esc(l.text)}</div>`;
    }).join('') + '</div>';
  };

  const execNote = (r) => {
    if (!r.execDate) return '';
    const m = String(r.execDate).match(/\d{4}-(\d{2})-(\d{2})/);
    return m ? ` <span class="mo" title="ejecutado en otro día (FIT emparejado)">ejec. ${m[2]}-${m[1]}</span>` : '';
  };
  const sessionRow = (r) => `
    <tr class="${r.unread ? 'unread' : 'read'} ${r.pain ? 'has-pain' : ''} ${r.rpe >= 6 ? 'has-hot' : ''}">
      <td>${r.unread ? '<span class="dot green"></span>' : '<span class="dot"></span>'}</td>
      <td>${esc(r.date)} ${r.moment ? `<span class="mo">${r.moment}</span>` : ''}${execNote(r)}</td>
      <td>${esc(r.reportedAt || '—')}${r.reportedAt && r.date && r.reportedAt !== r.date ? ' <span class="mo" title="feedback cargado después de la sesión">tarde</span>' : ''}</td>
      <td class="sesion"><div class="stitle">${esc(r.session || '—')}</div>${blocksHtml(r.blocks)}${(r.blocks && r.blocks.length && !r.hasFit && !r.fromComment) ? '<div class="nodev">sin dispositivo — sin ritmos en el comentario</div>' : ''}</td>
      <td>${esc(r.sport)}</td>
      <td>${r.sessionType ? badge(r.intensity) + '<br><span class="sub">' + esc(r.sessionType) + '</span>' : ''}</td>
      <td class="rpe ${r.rpe >= 6 ? 'hot' : ''}">${r.rpe != null ? r.rpe : '—'}</td>
      <td class="cmt">${nl2br(r.comment) || '<span class="muted">sin comentario</span>'}</td>
      <td>${r.pain ? '<span class="flag pain">⚠ sí</span>' : '<span class="muted">—</span>'}</td>
    </tr>`;

  const groupedSessions = (list) => {
    let out = '', cur = null;
    for (const r of list) {
      const a = (r.athlete || '—').trim();
      if (normA(a) !== normA(cur)) { cur = a; out += `<tr class="athsep"><td colspan="9">${esc(a)}${r.bike ? ' <span class="biketag">🚲 ciclismo</span>' : ''}</td></tr>`; }
      out += sessionRow(r);
    }
    return out;
  };

  const compRow = (r) => `
    <tr class="${r.unread ? 'unread' : 'read'} done ${r.pain ? 'has-pain' : ''} ${r.rpe >= 6 ? 'has-hot' : ''}">
      <td>${r.unread ? '<span class="dot green"></span>' : '<span class="dot"></span>'}</td>
      <td>${esc(r.athlete)}</td>
      <td>${esc(r.date)}</td>
      <td>${esc(r.competition || r.session)}</td>
      <td>${r.priority ? `<span class="prio p${esc(r.priority)}">${esc(r.priority)}</span>` : ''}</td>
      <td class="rpe ${r.rpe >= 6 ? 'hot' : ''}">${r.rpe != null ? r.rpe : ''}</td>
      <td class="cmt">${nl2br(r.comment)}${r.pain ? ' <span class="flag pain">⚠ dolor/molestia</span>' : ''} <span class="flag done">✓ completada</span></td>
    </tr>`;

  const cdRow = (r) => `
    <tr class="${r.unread ? 'unread' : 'read'}">
      <td>${r.unread ? '<span class="dot green"></span>' : '<span class="dot"></span>'}</td>
      <td>${esc(r.athlete)}</td>
      <td>${esc(r.title)}</td>
      <td>${r.priority ? `<span class="prio p${esc(r.priority)}">${esc(r.priority)}</span>` : ''}</td>
    </tr>`;

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Endurance Tool — Tabla de feedback</title>
<style>
  :root { color-scheme: light dark; --bg:#fff; --fg:#1a1a1a; --muted:#8a8a8a; --line:#e6e6e6;
    --head:#f6f6f7; --unread:#eafaf0; --hot:#fdecea; --pain:#fff4e5; --card:#fafafa; }
  @media (prefers-color-scheme: dark){ :root{ --bg:#16181c; --fg:#e8e8ea; --muted:#8a8f98; --line:#2a2d34;
    --head:#1e2127; --unread:#12241a; --hot:#2a1614; --pain:#2a2110; --card:#1b1e24; } }
  *{box-sizing:border-box} body{margin:0;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:var(--bg);color:var(--fg)}
  .wrap{max-width:1180px;margin:0 auto;padding:24px 18px 60px}
  h1{font-size:22px;margin:0 0 2px} h2{font-size:16px;margin:34px 0 10px;display:flex;align-items:center;gap:8px}
  .meta{color:var(--muted);font-size:13px;margin-bottom:18px}
  .cards{display:flex;flex-wrap:wrap;gap:10px;margin:14px 0 6px}
  .kpi{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 14px;min-width:120px}
  .kpi .n{font-size:22px;font-weight:700} .kpi .l{color:var(--muted);font-size:12px}
  .scroll{overflow-x:auto;border:1px solid var(--line);border-radius:10px}
  table{border-collapse:collapse;width:100%;min-width:720px} th,td{padding:8px 10px;text-align:left;vertical-align:top;border-bottom:1px solid var(--line)}
  th{background:var(--head);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.02em;color:var(--muted);position:sticky;top:0}
  tr.unread{background:var(--unread)} tr.has-hot{box-shadow:inset 3px 0 0 #e5484d} tr.has-pain{background:var(--pain)}
  tr.athsep td{background:#1F3A5F;color:#fff;font-weight:700;font-size:14px;padding:7px 10px;position:sticky;left:0}
  .biketag{font-size:11px;font-weight:600;background:rgba(255,255,255,.2);border-radius:5px;padding:1px 6px;margin-left:6px}
  td.cmt{max-width:360px;white-space:normal} td.rpe{font-weight:700;text-align:center;width:44px} td.rpe.hot{color:#e5484d}
  td.sesion{min-width:320px;max-width:440px} .stitle{font-weight:600;margin-bottom:3px}
  .blocks{font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:normal}
  .blocks>div{padding:1px 0;border-left:2px solid transparent;padding-left:6px}
  .bwork{border-left-color:#3b82f6} .bno{color:#e5484d;border-left-color:#e5484d} .brec{color:var(--muted);font-size:11px}
  .bpause,.bwarm{color:var(--muted)} .nodev{color:var(--muted);font-size:11px;margin-top:2px;font-style:italic}
  .sub{color:var(--muted);font-size:11px} .muted{color:var(--muted)} .mo{color:var(--muted);font-size:11px;border:1px solid var(--line);border-radius:4px;padding:0 4px}
  .badge{display:inline-block;font-size:11px;font-weight:700;color:#fff;border-radius:5px;padding:1px 6px}
  .badge.red{background:#e5484d} .badge.yellow{background:#d9a400} .badge.blue{background:#3b82f6} .badge.gray{background:#8a8f98}
  .flag{display:inline-block;font-size:11px;font-weight:600;border-radius:5px;padding:1px 6px}
  .flag.pain{background:#e5484d;color:#fff} .flag.fit{background:#3b82f6;color:#fff} .flag.done{background:#2e9e5b;color:#fff}
  .dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--line)} .dot.green{background:#2e9e5b}
  .prio{font-weight:700;border-radius:5px;padding:1px 7px} .prio.pA{background:#e5484d;color:#fff} .prio.pB{background:#d9a400;color:#fff} .prio.pC{background:#8a8f98;color:#fff}
  .count{font-size:12px;color:var(--muted);font-weight:400}
  .legend{display:flex;flex-wrap:wrap;gap:14px;margin:8px 0 0;color:var(--muted);font-size:12px}
</style></head>
<body><div class="wrap">
  <h1>Endurance Tool — Tabla de feedback</h1>
  <div class="meta">Coach: <b>${esc(coach)}</b> · Generado ${esc(generatedAt)} · ${onlyUnread ? 'Solo <b>sin leer</b> (pendientes)' : 'Todas las notificaciones'}</div>

  <div class="cards">
    <div class="kpi"><div class="n">${counts.atletas}</div><div class="l">Atletas (sesiones)</div></div>
    <div class="kpi"><div class="n">${counts.fit}</div><div class="l">FIT / dispositivo</div></div>
    <div class="kpi"><div class="n">${counts.competitions}</div><div class="l">Competencias hechas</div></div>
    <div class="kpi"><div class="n">${counts.countdowns}</div><div class="l">Cuenta regresiva A</div></div>
    <div class="kpi"><div class="n" style="color:#e5484d">${counts.hot}</div><div class="l">sRPE ≥ 6</div></div>
    <div class="kpi"><div class="n" style="color:#e5484d">${counts.pain}</div><div class="l">Dolor / molestia</div></div>
  </div>
  <div class="legend">
    <span><span class="badge blue">LIT</span> baja intensidad (azul)</span>
    <span><span class="badge yellow">ThT</span> tempo/umbral (amarillo)</span>
    <span><span class="badge red">HIT</span> alta intensidad (rojo)</span>
    <span><span class="dot green"></span> sin leer</span>
    <span>Sesión = bloques programados → ritmo/potencia ejecutado por lap (azul) · <span style="color:#e5484d">rojo</span> = no ejecutado</span>
  </div>

  <h2>🏃 Feedback por sesión — agrupado por atleta <span class="count">(${sessionRows.length})</span></h2>
  <div class="scroll"><table class="feedtable">
    <thead><tr><th></th><th>Fecha sesión</th><th>Fecha feedback</th><th>Sesión — programado → ejecutado (por bloque)</th><th>Deporte</th><th>Tipo</th><th>sRPE</th><th>Feedback / comentario</th><th>Dolor</th></tr></thead>
    <tbody>${groupedSessions(sessionRows) || emptyRow(9)}</tbody>
  </table></div>

  <h2>⌚ FIT — Feedback de dispositivo <span class="count">(${fit.length})</span></h2>
  <div class="scroll"><table>
    <thead><tr><th></th><th>Atleta</th><th>Fecha</th><th>Sesión</th><th>Tipo</th><th>sRPE</th><th>Detalle (distancia / duración)</th></tr></thead>
    <tbody>${fit.map((r) => `
      <tr class="${r.unread ? 'unread' : 'read'}">
        <td>${r.unread ? '<span class="dot green"></span>' : '<span class="dot"></span>'}</td>
        <td>${esc(r.athlete)}</td><td>${esc(r.date)} ${r.moment ? `<span class="mo">${r.moment}</span>` : ''}</td>
        <td>${esc(r.session || r.title)}</td><td>${r.sessionType ? badge(r.intensity) + ' ' + esc(r.sessionType) : ''}</td>
        <td class="rpe">${r.rpe != null ? r.rpe : ''}</td>
        <td>${esc(r.distance || '')}${r.duration ? ' · ' + esc(r.duration) : ''}</td></tr>`).join('') || emptyRow(7)}</tbody>
  </table></div>

  <h2>🏅 Competencias completadas <span class="count">(${competitions.length})</span></h2>
  <div class="scroll"><table>
    <thead><tr><th></th><th>Atleta</th><th>Fecha</th><th>Competición</th><th>Prio</th><th>sRPE</th><th>Feedback</th></tr></thead>
    <tbody>${competitions.map(compRow).join('') || emptyRow(7)}</tbody>
  </table></div>

  <h2>⏳ Cuenta regresiva — prioridad A <span class="count">(${countdowns.length})</span></h2>
  <div class="scroll"><table>
    <thead><tr><th></th><th>Atleta</th><th>Aviso</th><th>Prio</th></tr></thead>
    <tbody>${countdowns.map(cdRow).join('') || emptyRow(4)}</tbody>
  </table></div>
</div></body></html>`;
}

function emptyRow(cols) { return `<tr><td colspan="${cols}" class="muted" style="text-align:center;padding:18px">Sin registros</td></tr>`; }

const normA = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Procesa UNA cuenta de coach (runners o ciclistas): login + notificaciones +
// enriquecido por bloque (programado→ejecutado) + cross-day FITs. Devuelve los datos.
async function processAccount(email, password) {
  const { session, profile } = await ET.login(email, password);
  const coach = (profile.full_name || `${profile.first_name || ''} ${profile.last_name || ''}`).trim() || `#${profile.id}`;
  const raw = await ET.listNotifications(session);
  let records = raw.map(ET.parseNotification);
  if (ONLY_UNREAD) records = records.filter((r) => r.unread);
  const beforeAge = records.length;
  records = records.filter((r) => !tooOld(r));
  const droppedStale = beforeAge - records.length;

  let agenda = [];
  try { agenda = ((await ET.getUpcomingActivities(session)).competitions || []); }
  catch (e) { console.error('  (aviso: no se pudo leer la agenda de competencias:', e.message + ')'); }

  const atletas = records.filter((r) => r.section === 'Atletas');
  const fit = records.filter((r) => r.section === 'FIT');
  const competitions = records.filter((r) => r.type === 'competition_feedback');
  const countdowns = records.filter((r) => r.type === 'competition_countdown').sort((a, b) => (a.priority > b.priority ? 1 : -1));

  const upcoming = [];
  for (const c of agenda) upcoming.push({ source: 'agenda', athlete: c.athlete_name, competition: c.name, date: c.date, aviso: '', priority: '', unread: true });
  for (const n of countdowns) {
    const mW = (n.title || '').match(/(\d+)\s*semanas?/i);
    upcoming.push({ source: 'countdown', athlete: n.athlete, competition: n.competition || '', date: '', avisadoEl: n.date || '',
      aviso: mW ? `${mW[1]} semana${mW[1] === '1' ? '' : 's'}` : (n.title || ''), weeks: mW ? parseInt(mW[1], 10) : null, priority: n.priority || 'A', unread: n.unread });
  }

  const sessionRows = ET.groupBySession(atletas.concat(fit));
  // Enriquecer: detalle de la sesión → bloques programado→ejecutado; si no hay FIT pegado,
  // buscar un FIT real ejecutado en OTRO día del micro (igual que renovación).
  const microCache = new Map(), usedFits = new Set();
  async function enrichFit(r) {
    if (!r.sessionId) return;
    try {
      const full = await ET.getSession(session, r.sessionId);
      if (!(full.resume && full.resume.laps && full.resume.laps.length) && full.micro) {
        const cd = await SB.crossDayLaps(ET, session, full, microCache, usedFits);
        if (cd) { full.resume = cd.resume; r.execDate = cd.execDate; }
      }
      const bd = SB.sessionBreakdown(full);
      r.blocks = bd.lines;
      r.hasFit = bd.hasFit || r.hasFit;
      r.bike = bd.bike;
      if (bd.sport) r.sport = bd.sport;
      if (bd.fromComment && bd.commentClean) r.comment = bd.commentClean;   // comentario limpio (sin el volcado de ritmos)
      r.fromComment = bd.fromComment;
    } catch (_) { /* sesión sin detalle accesible */ }
  }
  for (let i = 0; i < sessionRows.length; i += 6) await Promise.all(sessionRows.slice(i, i + 6).map(enrichFit));

  return { coach, records, atletas, fit, competitions, countdowns, upcoming, sessionRows, droppedStale };
}

async function main() {
  const email = process.env.ET_EMAIL, password = process.env.ET_PASSWORD;
  if (!email || !password) { console.error('Faltan ET_EMAIL / ET_PASSWORD'); process.exit(1); }

  const accts = [await processAccount(email, password)];
  // Cuenta secundaria opcional (p.ej. los CICLISTAS, que están en otra cuenta de coach):
  // credenciales por entorno ET_EMAIL2 / ET_PASSWORD2 (nunca hardcodear — repo público).
  if (process.env.ET_EMAIL2 && process.env.ET_PASSWORD2) {
    try { accts.push(await processAccount(process.env.ET_EMAIL2, process.env.ET_PASSWORD2)); }
    catch (e) { console.error('  (aviso: cuenta secundaria falló:', e.message + ')'); }
  }

  // Merge de cuentas
  const coach = accts.map((a) => a.coach).join(' + ');
  const records = accts.flatMap((a) => a.records);
  const atletas = accts.flatMap((a) => a.atletas);
  const fit = accts.flatMap((a) => a.fit);
  const competitions = accts.flatMap((a) => a.competitions);
  const countdowns = accts.flatMap((a) => a.countdowns);
  const droppedStale = accts.reduce((s, a) => s + a.droppedStale, 0);

  const upcoming = accts.flatMap((a) => a.upcoming).sort((a, b) => {
    const ka = a.source === 'agenda' ? 0 : 1, kb = b.source === 'agenda' ? 0 : 1;
    if (ka !== kb) return ka - kb;
    if (a.source === 'agenda') return a.date < b.date ? -1 : 1;
    return (a.weeks || 99) - (b.weeks || 99);
  });

  // AGRUPAR por atleta (alfabético, sin acentos) → evita el switch de contexto (§0).
  const sessionRows = accts.flatMap((a) => a.sessionRows).sort((a, b) => {
    const ak = normA(a.athlete), bk = normA(b.athlete);
    if (ak !== bk) return ak < bk ? -1 : 1;
    if ((a.date || '') !== (b.date || '')) return (a.date || '') < (b.date || '') ? -1 : 1;
    return (a.moment || '') < (b.moment || '') ? -1 : 1;
  });

  const athletes = new Set(atletas.concat(fit).map((r) => (r.athlete || '').trim()).filter(Boolean)).size;
  const counts = {
    totalUnread: records.filter((r) => r.unread).length,
    athletes, atletasNotifs: atletas.length, atletas: sessionRows.length, fit: fit.length,
    competitions: competitions.length, countdowns: countdowns.length, upcoming: upcoming.length,
    hot: sessionRows.filter((r) => r.rpe >= 6).length + competitions.filter((r) => r.rpe >= 6).length,
    pain: sessionRows.filter((r) => r.pain).length + competitions.filter((r) => r.pain).length,
  };

  const generatedAt = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
  const model = { generatedAt, coach, onlyUnread: ONLY_UNREAD, counts, atletas, fit, sessionRows, competitions, countdowns, upcoming };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'feedback-table.html'), buildHtml(model));
  fs.writeFileSync(path.join(OUT_DIR, 'feedback-data.json'), JSON.stringify({ generatedAt, coach, counts, sessionRows, fit, competitions, countdowns, upcoming }, null, 2));

  console.log(`\nEndurance Tool — feedback (${ONLY_UNREAD ? 'sin leer' : 'todas'}) — ${coach}`);
  console.log(`  Cuentas: ${accts.length} · Atletas distintos: ${counts.athletes}`);
  console.log(`  Feedbacks de sesión: ${counts.atletasNotifs} (${counts.atletas} filas) · FIT: ${counts.fit} · Competencias: ${counts.competitions} · Próximas: ${counts.upcoming}`);
  console.log(`  sRPE>=6: ${counts.hot} · Dolor/molestia: ${counts.pain}`);
  if (droppedStale > 0) console.log(`  (filtradas ${droppedStale} notificaciones viejas > ${MAX_AGE_DAYS} días)`);
  console.log(`  -> report/feedback-table.html`);
  return model;
}

if (require.main === module) {
  main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
}
module.exports = { main, buildHtml };
