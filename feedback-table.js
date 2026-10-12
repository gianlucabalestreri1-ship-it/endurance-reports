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

const ONLY_UNREAD = !process.argv.includes('--all');
const OUT_DIR = path.join(__dirname, 'report');

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

  const sessionRow = (r) => `
    <tr class="${r.unread ? 'unread' : 'read'} ${r.pain ? 'has-pain' : ''} ${r.rpe >= 6 ? 'has-hot' : ''}">
      <td>${r.unread ? '<span class="dot green"></span>' : '<span class="dot"></span>'}</td>
      <td>${esc(r.athlete)}</td>
      <td>${esc(r.date)} ${r.moment ? `<span class="mo">${r.moment}</span>` : ''}</td>
      <td>${esc(r.session)}</td>
      <td>${esc(r.sport)}</td>
      <td>${r.sessionType ? badge(r.intensity) + '<br><span class="sub">' + esc(r.sessionType) + '</span>' : ''}</td>
      <td class="rpe ${r.rpe >= 6 ? 'hot' : ''}">${r.rpe != null ? r.rpe : '—'}</td>
      <td class="cmt">${nl2br(r.comment) || '<span class="muted">sin comentario</span>'}</td>
      <td>${r.pain ? '<span class="flag pain">⚠ sí</span>' : '<span class="muted">—</span>'}</td>
      <td class="fit">${r.hasFit ? `<span class="flag fit">FIT</span> ${esc(r.fitDistance || '')}${r.fitDuration ? ' · ' + esc(r.fitDuration) : ''}` : '<span class="muted">—</span>'}</td>
    </tr>`;

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
  td.cmt{max-width:440px;white-space:normal} td.rpe{font-weight:700;text-align:center;width:44px} td.rpe.hot{color:#e5484d}
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
    <span><span class="flag fit">FIT</span> archivo de dispositivo asociado</span>
  </div>

  <h2>🏃 Feedback por sesión — Atletas <span class="count">(${sessionRows.length})</span></h2>
  <div class="scroll"><table>
    <thead><tr><th></th><th>Atleta</th><th>Fecha</th><th>Sesión</th><th>Deporte</th><th>Tipo</th><th>sRPE</th><th>Feedback / comentario</th><th>Dolor</th><th>FIT (métrica)</th></tr></thead>
    <tbody>${sessionRows.map(sessionRow).join('') || emptyRow(10)}</tbody>
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

async function main() {
  const email = process.env.ET_EMAIL, password = process.env.ET_PASSWORD;
  if (!email || !password) { console.error('Faltan ET_EMAIL / ET_PASSWORD'); process.exit(1); }

  const { session, profile } = await ET.login(email, password);
  const coach = (profile.full_name || `${profile.first_name || ''} ${profile.last_name || ''}`).trim() || `#${profile.id}`;
  const raw = await ET.listNotifications(session);
  let records = raw.map(ET.parseNotification);
  if (ONLY_UNREAD) records = records.filter((r) => r.unread);

  // Upcoming competitions: the control-panel agenda gives near-term ones with
  // exact dates; countdown notifications add the weeks-out alerts.
  let agenda = [];
  try { agenda = ((await ET.getUpcomingActivities(session)).competitions || []); }
  catch (e) { console.error('  (aviso: no se pudo leer la agenda de competencias:', e.message + ')'); }

  const atletas = records.filter((r) => r.section === 'Atletas');
  const fit = records.filter((r) => r.section === 'FIT');
  const competitions = records.filter((r) => r.type === 'competition_feedback');
  const countdowns = records.filter((r) => r.type === 'competition_countdown')
    .sort((a, b) => (a.priority > b.priority ? 1 : -1));

  // Unified upcoming-competitions table: agenda rows (exact date, next days)
  // + countdown alerts ("N semanas para competición de X", priority A).
  const upcoming = [];
  for (const c of agenda) {
    upcoming.push({ source: 'agenda', athlete: c.athlete_name, competition: c.name, date: c.date, aviso: '', priority: '', unread: true });
  }
  for (const n of countdowns) {
    const mW = (n.title || '').match(/(\d+)\s*semanas?/i);
    // n.date is when the alert fired, NOT the race date — keep them apart.
    upcoming.push({
      source: 'countdown', athlete: n.athlete, competition: n.competition || '',
      date: '', avisadoEl: n.date || '',
      aviso: mW ? `${mW[1]} semana${mW[1] === '1' ? '' : 's'}` : (n.title || ''),
      weeks: mW ? parseInt(mW[1], 10) : null, priority: n.priority || 'A', unread: n.unread,
    });
  }
  upcoming.sort((a, b) => {
    const ka = a.source === 'agenda' ? 0 : 1, kb = b.source === 'agenda' ? 0 : 1;
    if (ka !== kb) return ka - kb;
    if (a.source === 'agenda') return a.date < b.date ? -1 : 1;
    return (a.weeks || 99) - (b.weeks || 99);
  });

  // Session-grouped table merges Atletas feedback with its FIT activity.
  const sessionRows = ET.groupBySession(atletas.concat(fit))
    .sort((a, b) => (b.unread - a.unread) || (b.pain - a.pain) || ((b.rpe || 0) - (a.rpe || 0)));

  // Enriquecer cada fila con la MÉTRICA REAL DEL DISPOSITIVO (FIT): la notificación
  // key_session_fit solo existe para sesiones clave, así que para el resto leemos el
  // detalle de la sesión (`session` → resume) igual que renovación/adherencia.
  async function enrichFit(r) {
    if (!r.sessionId) return;
    try {
      const fm = ET.fitMetric(await ET.getSession(session, r.sessionId));
      if (fm) { r.hasFit = true; r.fitDistance = fm.distance || r.fitDistance; r.fitDuration = fm.duration || r.fitDuration; r.fitHr = fm.hr; r.fitLaps = fm.laps; }
    } catch (_) { /* sesión sin detalle accesible */ }
  }
  for (let i = 0; i < sessionRows.length; i += 6) {
    await Promise.all(sessionRows.slice(i, i + 6).map(enrichFit));
  }

  // "Atletas" is the notification SECTION (panel tab), not a headcount. Track the
  // distinct-athlete count separately so the numbers are never misread.
  const athletes = new Set(atletas.concat(fit).map((r) => (r.athlete || '').trim()).filter(Boolean)).size;
  const counts = {
    totalUnread: records.filter((r) => r.unread).length, // all sections
    athletes,                       // distinct athletes with pending feedback
    atletasNotifs: atletas.length,  // unread session-feedback notifications
    atletas: sessionRows.length,    // rows after grouping feedback+FIT by session
    fit: fit.length,
    competitions: competitions.length,
    countdowns: countdowns.length,
    upcoming: upcoming.length,
    hot: sessionRows.filter((r) => r.rpe >= 6).length + competitions.filter((r) => r.rpe >= 6).length,
    pain: sessionRows.filter((r) => r.pain).length + competitions.filter((r) => r.pain).length,
  };

  const generatedAt = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
  const model = { generatedAt, coach, onlyUnread: ONLY_UNREAD, counts, atletas, fit, sessionRows, competitions, countdowns, upcoming };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'feedback-table.html'), buildHtml(model));
  fs.writeFileSync(path.join(OUT_DIR, 'feedback-data.json'), JSON.stringify({ generatedAt, coach, counts, sessionRows, fit, competitions, countdowns, upcoming }, null, 2));

  // Console summary
  console.log(`\nEndurance Tool — feedback (${ONLY_UNREAD ? 'sin leer' : 'todas'}) — coach ${coach}`);
  console.log(`  Sin leer (total): ${counts.totalUnread}  ·  Atletas distintos: ${counts.athletes}`);
  console.log(`  Feedbacks de sesión: ${counts.atletasNotifs} (${counts.atletas} filas agrupadas) · FIT: ${counts.fit} · Competencias hechas: ${counts.competitions} · Próximas competencias: ${counts.upcoming}`);
  console.log(`  sRPE>=6: ${counts.hot} · Dolor/molestia: ${counts.pain}`);
  console.log(`  -> report/feedback-table.html`);
  return model;
}

if (require.main === module) {
  main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
}
module.exports = { main, buildHtml };
