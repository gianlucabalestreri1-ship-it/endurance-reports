'use strict';
/*
 * Cliente ET de bajo nivel para el generador (self-contained, no toca lib/).
 * Reutiliza el mismo backend JSON-RPC documentado en CLAUDE.md.
 */
const https = require('https');
const fs = require('fs');
const API = 'https://api.app.endurancegroup.org/front_ws/call/';
const CA = '/root/.ccr/ca-bundle.crt';
const agent = new https.Agent(fs.existsSync(CA) ? { ca: fs.readFileSync(CA), keepAlive: true } : { keepAlive: true });

function call(name, args, auth) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ id: null, session: '', name, args: args || {} });
    const req = https.request(API, {
      method: 'POST', agent,
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
        try { const j = JSON.parse(b); if (j.error) return reject(new Error(`${name}: ${j.error_msg || j.error_code}`)); resolve(j.response); }
        catch (e) { reject(new Error(`${name}: bad JSON ${b.slice(0, 120)}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error(`${name}: timeout`)));
    req.write(payload); req.end();
  });
}

async function login(email, password) { const r = await call('login_coach', { email, password }); return r.session; }
function athleteList(s) { return call('athlete_list', {}, s).then((r) => r.athletes || findArr(r)); }
function trainingPlanList(s, athleteId) { return call('training_plan_list', { athlete_id: athleteId }, s).then((r) => r.training_plans || r.plans || findArr(r)); }
function trainingPlan(s, planId) { return call('training_plan', { training_plan_id: String(planId), full: true, athlete: true }, s); }
function session(s, sessionId) { return call('session', { session_id: String(sessionId) }, s); }
function findArr(r) { for (const k of Object.keys(r || {})) { if (Array.isArray(r[k]) && r[k][0] && (r[k][0].title || r[k][0].full_name)) return r[k]; } return []; }

// normalización para matching de nombres (acentos + minúsculas)
function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }

module.exports = { call, login, athleteList, trainingPlanList, trainingPlan, session, norm };
