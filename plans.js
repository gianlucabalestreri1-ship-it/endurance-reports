#!/usr/bin/env node
'use strict';
/*
 * Endurance Tool — plans expiry report & athlete dossiers.
 *
 * Modes (combinable):
 *   node plans.js --report            Weekly report data: plans expiring in the
 *                                     next ~7 days + recently expired plans +
 *                                     upcoming competitions.
 *                                     -> report/plans-expiry-data.json
 *   node plans.js --dossiers          For each plan whose last session is exactly
 *                                     DUE_DAYS away (default 7), fetch the full
 *                                     plan and dump every reported session.
 *                                     -> report/dossier-<planId>-data.json (one per plan)
 *   node plans.js --dossiers --all-expiring   Dossiers for EVERY plan in the
 *                                     expiring window (not just exactly-7-days).
 *   node plans.js --plan <id>         Dossier for one specific plan id.
 *
 * Then: python3 make_xlsx.py expiry | python3 make_xlsx.py dossier <data.json>
 */
const fs = require('fs');
const path = require('path');
const ET = require('./lib/endurance');

const OUT_DIR = path.join(__dirname, 'report');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const DUE_DAYS = parseInt(process.env.DOSSIER_DUE_DAYS || '7', 10);

function todayAR() {
  // Buenos Aires calendar date (UTC-3), independent of server TZ.
  const now = new Date(Date.now() - 3 * 3600 * 1000);
  return now.toISOString().slice(0, 10);
}
function daysUntil(dateStr) {
  return Math.round((new Date(dateStr + 'T00:00:00Z') - new Date(todayAR() + 'T00:00:00Z')) / 86400000);
}
const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');

async function dossierFor(session, planId) {
  const tp = await ET.getTrainingPlan(session, planId);
  const flat = ET.flattenPlanSessions(tp, true);
  const athleteName = (flat.athlete && flat.athlete.name) || '';
  const data = {
    generatedAt: new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }),
    athleteName, ...flat,
    counts: {
      sessions: flat.sessions.length,
      hot: flat.sessions.filter((s) => s.rpe >= 6).length,
      pain: flat.sessions.filter((s) => s.pain).length,
      competitions: flat.competitions.length,
    },
  };
  const file = path.join(OUT_DIR, `dossier-${planId}-data.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  console.log(`  dossier: ${athleteName || '#' + planId} · "${data.plan.title}" (${data.plan.startDate} → ${data.plan.endDate}) · ${data.counts.sessions} sesiones reportadas · sRPE>=6: ${data.counts.hot} · dolor: ${data.counts.pain} -> ${path.basename(file)}`);
  return file;
}

async function main() {
  const email = process.env.ET_EMAIL, password = process.env.ET_PASSWORD;
  if (!email || !password) { console.error('Faltan ET_EMAIL / ET_PASSWORD'); process.exit(1); }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const { session } = await ET.login(email, password);
  const ua = await ET.getUpcomingActivities(session);
  const plans = (ua.plans || []).map((p) => ({ ...p, days_left: daysUntil(p.last_session_date) }));
  const expired = (ua.expired_plans || []).map((p) => ({ ...p, days_ago: -daysUntil(p.last_session_date) }));
  const competitions = ua.competitions || [];

  if (has('--report') || argv.length === 0) {
    const data = {
      generatedAt: new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }),
      today: todayAR(),
      expiring: plans.sort((a, b) => (a.last_session_date < b.last_session_date ? -1 : 1)),
      expired: expired.sort((a, b) => (a.last_session_date > b.last_session_date ? -1 : 1)),
      competitions,
    };
    fs.writeFileSync(path.join(OUT_DIR, 'plans-expiry-data.json'), JSON.stringify(data, null, 2));
    console.log(`Planes por vencer (≤7 días): ${plans.length} · Vencidos sin renovar: ${expired.length} · Competencias próximas: ${competitions.length}`);
    plans.forEach((p) => console.log(`  vence ${p.last_session_date} (${p.days_left}d)  ${p.athlete_name} · ${p.title}`));
  }

  if (has('--plan')) {
    const id = argv[argv.indexOf('--plan') + 1];
    await dossierFor(session, id);
  }

  if (has('--dossiers')) {
    const due = has('--all-expiring') ? plans : plans.filter((p) => p.days_left === DUE_DAYS);
    console.log(`Dossiers (${has('--all-expiring') ? 'todos los que vencen ≤7d' : `planes a exactamente ${DUE_DAYS} días`}): ${due.length}`);
    for (const p of due) await dossierFor(session, p.plan_id);
  }
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
