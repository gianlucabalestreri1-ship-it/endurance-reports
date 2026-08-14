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
// that is NOT negated ("sin dolor", "sin molestias", "no molesta", "sin dolores
// ni molestias"). Each occurrence is checked against a short preceding window
// so negated and genuine mentions in the same comment are told apart.
const PAIN_G = /(dolor|molest|duele|duelen|lesi[oó]n|pinchazo|contractur|sobrecarg|tir[oó]n|calambr|inflama|resent|pincha|hinch|adolor)/gi;
const NEG_END = /(^|\W)(sin|no|ni|ning\w*|cero|nunca|0)\s*$/i;
function detectPain(comment) {
  if (!comment) return false;
  const c = comment.toLowerCase();
  PAIN_G.lastIndex = 0;
  let m;
  while ((m = PAIN_G.exec(c)) !== null) {
    const before = c.slice(Math.max(0, m.index - 14), m.index);
    if (!NEG_END.test(before)) return true; // a non-negated pain mention
  }
  return false;
}

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
    pain: detectPain(comment), // comment only — avoids false hits from plan names like "post lesión"
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
      pain: fb.pain,
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
  login, listNotifications, parseNotification, groupBySession,
  classifyType, detectPain, decode, field, tailField, sectionOf,
};
