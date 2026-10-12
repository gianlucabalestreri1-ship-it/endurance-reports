'use strict';
/*
 * Endurance Tool API client + notification parser.
 *
 * Auth flow (reverse-engineered from the web app https://et.endurancegroup.org):
 *   1. POST front_ws/call/  {name:'login_coach', args:{email,password}}  -> response.session (token)
 *   2. POST front_ws/call/  {name:'list_web_notification', args:{}} with header Authorization: <token>
 *
 * The web notification `body` already carries the feedback payload the coach
 * manual describes (Atleta, Fecha, Tipo de sesion, RPE/sRPE, Comentario, dolor,
 * Distance for FIT/device activities), so no per-session drill-down is needed.
 */
const https = require('https');
const fs = require('fs');

const API = 'https://api.app.endurancegroup.org/front_ws/call/';
const CA_BUNDLE = '/root/.ccr/ca-bundle.crt'; // agent-proxy CA (also bundles public roots)

function buildAgent() {
  // In the managed remote environment egress is MITM'd by the agent proxy, so
  // Node must trust its CA. The bundle also contains the public roots, so it is
  // safe to use as the sole CA. Outside that environment we fall back to defaults.
  try {
    if (fs.existsSync(CA_BUNDLE)) {
      return new https.Agent({ ca: fs.readFileSync(CA_BUNDLE), keepAlive: true });
    }
  } catch (_) { /* ignore */ }
  return new https.Agent({ keepAlive: true });
}
const agent = buildAgent();

function call(name, args, auth) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ id: null, session: '', name, args: args || {} });
    const req = https.request(API, {
      method: 'POST',
      agent,
      headers: {
        'content-type': 'application/json;charset=UTF-8',
        'accept': 'application/json, text/plain, */*',
        'referer': 'https://etangular.endurancegroup.org/',
        ...(auth ? { authorization: auth } : {}),
      },
    }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(b);
          if (j.error) return reject(new Error(`${name} failed: ${j.error_msg || j.error_code}`));
          resolve(j.response);
        } catch (e) { reject(new Error(`${name}: bad JSON (${b.slice(0, 120)})`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error(`${name}: timeout`)));
    req.write(payload);
    req.end();
  });
}

async function login(email, password) {
  const r = await call('login_coach', { email, password });
  return { session: r.session, profile: r.profile };
}

function listNotifications(session) {
  return call('list_web_notification', {}, session).then((r) => r.web_notifications || []);
}

// Mark notifications as read (status pending -> read) so the next run doesn't
// re-report them. `ids` is an array of web-notification ids. Única escritura
// permitida del flujo. Devuelve {} en caso de éxito.
function markNotificationsRead(session, ids) {
  if (!ids || !ids.length) return Promise.resolve({ skipped: true });
  return call('web_notifications_readed', { notifications_ids: ids }, session);
}

// Control-panel agenda: plans whose last session falls within the next ~7 days,
// recently expired plans, and upcoming competitions with exact dates.
// Response: { plans:[{plan_id,athlete_id,title,last_session_date,athlete_name}],
//             expired_plans:[...same], competitions:[{plan_id,athlete_id,name,date,athlete_name}], controls:[] }
function getUpcomingActivities(session) {
  return call('get_upcoming_activities', {}, session);
}

// Full training plan: header (title, start/end dates, athlete, competitions with
// athlete RPE/comment) + macro.mesos[].micros[].sessions.{am,pm} — 7 day-slots per
// micro, each slot null or a session carrying the athlete's reported data
// (athlete_rpe = sRPE, athlete_comment, athlete_duration/distance, status,
// type.intensity_type LIT/THT/HIT and its official colour).
function getTrainingPlan(session, planId) {
  return call('training_plan', { training_plan_id: String(planId), full: true, athlete: true }, session);
}

// Full detail of one session: programado (activities[].sections[].work), zonas
// del atleta, el resume del dispositivo (laps) y métricas. `resume_fit` marca si
// hay FIT. Útil para enriquecer el feedback con la métrica real del dispositivo.
function getSession(session, sessionId) {
  return call('session', { session_id: String(sessionId) }, session);
}

// Extrae la métrica de dispositivo (si hay FIT) de una respuesta de `session`:
// distancia y duración reales + FC media. Devuelve null si no hay dispositivo.
function fitMetric(sessionResp) {
  const rz = sessionResp && sessionResp.resume;
  if (!rz || !(rz.id || (rz.laps && rz.laps.length) || rz.total_distance)) return null;
  const km = (rz.total_distance || 0) / 1000;
  const secs = rz.total_timer_time || rz.total_elapsed_time || 0;
  const dur = secs ? `${Math.floor(secs / 60)}'${String(Math.round(secs % 60)).padStart(2, '0')}"` : '';
  const hr = rz.avg_heart_rate || (rz.laps && rz.laps[0] && rz.laps[0].avg_heart_rate) || null;
  return { distance: km ? km.toFixed(2) + ' km' : '', duration: dur, hr: hr || null, laps: (rz.laps || []).length };
}

// Flatten a training_plan response into one row per session (chronological),
// keeping the athlete's reported feedback. `onlyReported` keeps sessions that
// have feedback or were finished.
function flattenPlanSessions(tp, onlyReported) {
  const plan = tp.plan || {};
  const rows = [];
  const mesos = (plan.macro && plan.macro.mesos) || [];
  for (const meso of mesos) {
    for (const micro of (meso.micros || [])) {
      const slots = micro.sessions || {};
      for (const moment of ['am', 'pm']) {
        for (const s of (slots[moment] || [])) {
          if (!s || !s.id) continue;
          const comment = (s.athlete_comment || '').trim();
          const reported = s.has_feedback || s.athlete_rpe != null || !!comment || s.status === 'finished';
          if (onlyReported && !reported) continue;
          const it = (s.type && s.type.intensity_type) || '';
          const cat = it === 'THT' ? 'ThT' : (it === 'LIT' ? 'LIT' : (it === 'HIT' ? 'HIT' : (it || 'OTRO')));
          rows.push({
            sessionId: s.id,
            date: s.date,
            moment: moment.toUpperCase(),
            title: s.title,
            sport: (s.sport && s.sport.name) || '',
            sessionType: s.type_name || (s.type && s.type.name) || '',
            intensity: { cat, color: cat === 'HIT' ? 'red' : cat === 'ThT' ? 'yellow' : cat === 'LIT' ? 'blue' : 'gray', hex: (s.type && s.type.color) || '' },
            status: s.status,
            statusDisplay: s.get_status_display,
            keySession: !!s.key_session,
            progRpe: s.rpe != null ? s.rpe : null,
            rpe: s.athlete_rpe != null ? s.athlete_rpe : null,   // sRPE reported by the athlete
            progDuration: (s.duration && s.duration.format) || '',
            duration: (s.athlete_duration && s.athlete_duration.magnitude != null) ? s.athlete_duration.format : '',
            distance: (s.athlete_distance && s.athlete_distance.magnitude != null) ? s.athlete_distance.format : '',
            comment,
            pain: detectPain(comment), painClass: classifyPain(comment),
            hasFeedback: !!s.has_feedback,
          });
        }
      }
    }
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.moment < b.moment ? -1 : 1));
  const competitions = (plan.competitions || []).map((c) => ({
    date: c.date, name: c.name || c.title, priority: c.priority || '',
    status: c.status, rpe: c.athlete_rpe != null ? c.athlete_rpe : null,
    duration: (c.athlete_duration && c.athlete_duration.magnitude != null) ? c.athlete_duration.format : '',
    distance: (c.athlete_distance && c.athlete_distance.magnitude != null) ? c.athlete_distance.format : '',
    comment: (c.athlete_comment || '').trim(),
  }));
  return {
    plan: {
      id: plan.id, title: plan.title, startDate: plan.start_date, endDate: plan.end_date,
      status: plan.get_status_display || plan.status, goal: plan.goal || '',
      athleteId: plan.athlete_id,
    },
    athlete: tp.athlete ? { id: tp.athlete.id, name: tp.athlete.full_name || `${tp.athlete.first_name || ''} ${tp.athlete.last_name || ''}`.trim() } : null,
    sessions: rows,
    competitions,
  };
}

// ---------------------------------------------------------------------------
// Body parsing
// ---------------------------------------------------------------------------

function decode(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'").replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

// Extract "Label: value" allowing bilingual labels. Value runs to end of line
// (or to the next known label for the comment field, which can be multi-line).
function field(text, labels) {
  for (const label of labels) {
    const re = new RegExp(`(?:^|\\n)\\s*${label}\\s*:\\s*([^\\n]*)`, 'i');
    const m = text.match(re);
    if (m && m[1].trim()) return m[1].trim();
  }
  return '';
}

// The comment/feedback is the free-text tail; capture everything after the label.
function tailField(text, labels) {
  for (const label of labels) {
    const re = new RegExp(`${label}\\s*:\\s*`, 'i');
    const m = text.match(re);
    if (m) return text.slice(m.index + m[0].length).trim();
  }
  return '';
}

// Session-type -> intensity bucket, per the coach manual colour code:
//   azul = LIT · amarillo = ThT (tempo/umbral) · rojo = HIT
const TYPE_RULES = [
  { cat: 'HIT', color: 'red', re: /hiit|hit\b|vo2|neuromuscular|velocidad|sprint|anaer|pot\b|potencia|pista|series|interval/i },
  { cat: 'ThT', color: 'yellow', re: /tempo|umbral|threshold|ftp|mlss|tht|tirada|ritmo|fartlek|mit\b/i },
  { cat: 'LIT', color: 'blue', re: /resistencia|endurance|fondo|mantenimiento|regenerat|rodaje|base|continu|suave|z2|aer[oó]bic|aguas abiertas|recuper/i },
];
function classifyType(sessionType) {
  const t = sessionType || '';
  for (const r of TYPE_RULES) if (r.re.test(t)) return { cat: r.cat, color: r.color };
  if (/fuerza|strength|gym|core/i.test(t)) return { cat: 'FZA', color: 'gray' };
  if (/test|valoraci|control/i.test(t)) return { cat: 'TEST', color: 'gray' };
  return { cat: 'OTRO', color: 'gray' };
}

// Pain / discomfort detector. Flags a comment only when it carries a pain word
// that is NOT negated. Negation is checked PER CLAUSE: we look back to the last
// clause boundary before the pain word, so "No presento molestias en mi pie",
// "sin dolor", "no me molestó" are negated, while "me duele y mucho" is not.
const PAIN_G = /(dolor|molest|duele|duelen|lesi[oó]n|pinchazo|contractur|sobrecarg|tir[oó]n|calambr|inflama|resent|pincha|hinch|adolor)/gi;
// body parts + progression words → context that makes a negated pain mention a "good news" signal
const PAIN_CTX = /(pie|rodilla|tobillo|cadera|gemelo|isquio|cu[aá]driceps|cuadriceps|espalda|tend[oó]n|planta|tal[oó]n|talon|pantorrilla|aductor|psoas|lumbar|r[oó]tula|rotula|fascia|fascitis|empeine|tibial|mejor|recuper|progres|cada vez|menos|molest[oó] menos)/i;
const NEG_W = /\b(sin|no|ni|ning\w*|cero|nunca|tampoco|niego|niega)\b/;
function _painNegated(c, idx) {
  const before = c.slice(Math.max(0, idx - 40), idx);
  const clause = before.split(/[.;,:!?]|\bpero\b|\baunque\b|\bsalvo\b/).pop(); // última cláusula antes de la palabra
  return NEG_W.test(clause);
}
// 'active' = dolor real · 'improving' = mención negada con contexto (progresión buena) · 'none'
function classifyPain(comment) {
  if (!comment) return 'none';
  const c = comment.toLowerCase();
  PAIN_G.lastIndex = 0;
  let m, improving = false;
  while ((m = PAIN_G.exec(c)) !== null) {
    if (!_painNegated(c, m.index)) return 'active';
    const win = c.slice(Math.max(0, m.index - 25), m.index + 45);
    if (PAIN_CTX.test(win)) improving = true;
  }
  return improving ? 'improving' : 'none';
}
function detectPain(comment) { return classifyPain(comment) === 'active'; }

const ATH = ['Atleta', 'Athlete'];
const DATE = ['Fecha', 'Date'];
const TITLE = ['Titulo', 'Título', 'Denominación', 'Denominacion', 'Title'];
const SPORT = ['Deporte', 'Sport'];
const STYPE = ['Tipo de sesion', 'Tipo de sesión', 'Session type'];
const DUR = ['Duración', 'Duracion', 'Duration'];
const PLAN = ['Plan de entrenamiento', 'Training Plan', 'Plan'];
const RPE = ['RPE', 'sRPE'];
const COMMENT = ['Comentario', 'Comment'];
const DIST = ['Distance', 'Distancia'];
const COMP = ['Competición', 'Competicion', 'Competition'];
const PRIO = ['Prioridad', 'Priority'];

// Section per the manual's notification tabs.
function sectionOf(type) {
  if (type === 'session_comment' || type === 'key_session_feedback') return 'Atletas';
  if (type === 'key_session_fit') return 'FIT';
  if (type === 'competition_feedback' || type === 'competition_countdown') return 'Competencias';
  return 'Otras';
}

function parseNotification(n) {
  const text = decode(n.body);
  const dateRaw = field(text, DATE) || n.date || '';
  const moment = /\bPM\b/i.test(dateRaw) ? 'PM' : (/\bAM\b/i.test(dateRaw) ? 'AM' : '');
  const rpeRaw = field(text, RPE);
  const rpe = rpeRaw ? parseInt(rpeRaw, 10) : null;
  const sessionType = field(text, STYPE);
  const comment = tailField(text, COMMENT);
  const rec = {
    id: n.id,
    type: n.type,
    section: sectionOf(n.type),
    status: n.status,              // pending = unread (green), read, accepted
    unread: n.status === 'pending',
    title: n.title,
    athlete: field(text, ATH) || (n.title || '').replace(/^.*? de /, ''),
    plan: field(text, PLAN),
    date: (dateRaw.replace(/\s*(AM|PM)\s*$/i, '').trim()) || n.date,
    moment,
    session: field(text, TITLE),
    sport: field(text, SPORT),
    sessionType,
    intensity: classifyType(sessionType),
    duration: field(text, DUR),
    distance: field(text, DIST),
    rpe,
    comment,
    pain: detectPain(comment), painClass: classifyPain(comment), // comment only — avoids false hits from plan names like "post lesión"
    competition: field(text, COMP),
    priority: field(text, PRIO),
    data: n.data || {},
    sessionId: (n.data && (n.data.session_id)) || null,
    rawDate: n.date,
  };
  return rec;
}

// Group Atletas + FIT records by session_id so a key session's subjective
// feedback and its device (FIT) activity land on one row.
function groupBySession(records) {
  const groups = new Map();
  for (const r of records) {
    const key = r.sessionId ? `s${r.sessionId}` : `n${r.id}`;
    if (!groups.has(key)) groups.set(key, { key, sessionId: r.sessionId, items: [] });
    groups.get(key).items.push(r);
  }
  const rows = [];
  for (const g of groups.values()) {
    const fb = g.items.find((x) => x.type !== 'key_session_fit') || g.items[0];
    const fit = g.items.find((x) => x.type === 'key_session_fit');
    rows.push({
      sessionId: g.sessionId,
      athlete: fb.athlete,
      date: fb.date,
      moment: fb.moment,
      session: fb.session || fit && fit.session,
      sport: fb.sport || (fit && fit.sport),
      sessionType: fb.sessionType || (fit && fit.sessionType),
      intensity: fb.intensity.cat !== 'OTRO' ? fb.intensity : (fit ? fit.intensity : fb.intensity),
      rpe: fb.rpe != null ? fb.rpe : (fit ? fit.rpe : null),
      duration: fb.duration || (fit && fit.duration),
      comment: fb.comment,
      pain: fb.pain, painClass: fb.painClass || (fb.pain ? 'active' : 'none'),
      unread: g.items.some((x) => x.unread),
      hasFit: !!fit,
      fitDistance: fit ? fit.distance : (fb.distance || ''),
      fitDuration: fit ? fit.duration : '',
      types: g.items.map((x) => x.type),
    });
  }
  return rows;
}

module.exports = {
  login, listNotifications, markNotificationsRead, parseNotification, groupBySession,
  classifyType, detectPain, classifyPain, decode, field, tailField, sectionOf,
  getUpcomingActivities, getTrainingPlan, getSession, fitMetric, flattenPlanSessions,
};
