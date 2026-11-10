#!/usr/bin/env node
'use strict';
/*
 * Endurance Tool — informe de RENOVACIÓN en HTML (formato oficial; reemplaza al Excel).
 *
 * Lee TODOS los report/renewal-<id>-data.json (los genera `node renewal.js <ids>`),
 * arma una ficha por atleta con: respuestas del formulario de renovación (concisas),
 * feedback del último mesociclo (ritmo obj→real, laps de pausa >8'/km descartadas),
 * adherencia (solo runs) y una sugerencia automática. Los que respondieron el
 * formulario van PRIMERO. Si existe report/altas.json, agrega la sección de
 * "Altas / nuevos ingresos" con la acción de cada uno.
 *
 * Pipeline:  node renewal.js <plan_id ...>   →   node renewal-html.js
 * Salida:    report/Informe-Renovacion.html   (report/ está en .gitignore: datos sensibles)
 *
 * Nota de frescura: los atletas cargan feedback/formularios a lo largo del día;
 * conviene correr renewal.js tarde (o re-correr) antes de generar el informe.
 */
const fs=require("fs"), path=require("path");
const DIR=path.join(__dirname,"report");
const files=fs.readdirSync(DIR).filter(f=>/^renewal-\d+-data\.json$/.test(f)).map(f=>path.join(DIR,f));
const FORMS=(()=>{try{return Object.values(JSON.parse(fs.readFileSync(DIR+"/form-responses.json","utf8")));}catch(e){return [];}})();
const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const norm=s=>String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/\([^)]*\)/g," ").replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim();
const toks=s=>norm(s).split(" ").filter(w=>w.length>=3);
function matchForm(name){const nt=toks(name);let best=null,bo=0;for(const v of FORMS){const ft=toks(v.name);let sc=0;for(const a of ft)if(nt.some(b=>a===b||(a.length>=3&&b.length>=3&&(a.startsWith(b)||b.startsWith(a)))))sc++;if(sc>bo){bo=sc;best=v;}}return bo>=2?best:null;}
function painAns(a){a=norm(a);return a&&!/^(no|nada|ningun|sin )/.test(a);}
// ritmo lap min/km (null si no parseable)
function paceMin(fmt){if(!fmt)return null;const h=String(fmt).match(/(\d+)\s*h/);const m=String(fmt).match(/(\d+)'(\d+)/);let p=m?(+m[1]+(+m[2])/60):null;if(h)p=(p==null?0:p)+(+h[1])*60;return p;}
const PAUSE=8.0;
function intChip(c){const k=(c||"").toUpperCase();const m={LIT:["LIT","lit"],THT:["ThT","tht"],HIT:["HIT","hit"]}[k];return m?`<span class="int ${m[1]}">${m[0]}</span>`:(c?`<span class="int">${esc(c)}</span>`:"");}
function painChip(p){if(p==="active")return `<span class="pn act">Dolor SÍ</span>`;if(p==="improving")return `<span class="pn mej">Mejora</span>`;return "";}
// parseo de ritmos a mano del comentario
function parseManual(txt){if(!txt)return{paces:[],stripped:txt};const re=/(\d{1,2})\s*[.:'’;]\s*(\d{2})(?!\d)/g;const paces=[],ranges=[];let m;while((m=re.exec(txt))!==null){const mm=+m[1],ss=+m[2];if(ss>=60)continue;const tot=mm+ss/60;if(tot<2.4||tot>12)continue;const after=txt.slice(re.lastIndex,re.lastIndex+6);if(/^\s*km/i.test(after)&&!/^\s*\/\s*km/i.test(after))continue;paces.push(`${mm}'${String(ss).padStart(2,"0")}"/km`);ranges.push([m.index,re.lastIndex]);}if(!paces.length)return{paces:[],stripped:txt};let st=txt;for(let i=ranges.length-1;i>=0;i--){const[a,b]=ranges[i];let e=b;const mk=txt.slice(b,b+6).match(/^\s*(?:"|”)?\s*\/?\s*km/i);if(mk)e=b+mk[0].length;st=st.slice(0,a)+" "+st.slice(e);}st=st.replace(/\s+[-–·,;:]+(?=\s|$)/g," ").replace(/\s{2,}/g," ").replace(/^[\s\-–·,;:]+/,"").trim();return{paces,stripped:st};}
function ritmoCell(s){
  const obj=s.targetPace?`<span class="obj">obj ${esc(s.targetPace)}</span>`:"";
  if(s.hasFit&&Array.isArray(s.laps)&&s.laps.length){
    const kept=s.laps.filter(l=>{const p=paceMin(l.pace);return p===null?true:p<=PAUSE;});
    if(kept.length){const laps=kept.map(l=>{const km=l.distKm!=null?Number(l.distKm).toFixed(2):"";const fc=(l.hrA||l.hrM)?` (${l.hrA||"–"} ${l.hrM||"–"})`:"";return `<span class="lap">${km} ${esc(l.pace||"")}${fc}</span>`;}).join("");
      return `${obj}<div class="laps">${laps}</div>`;}
  }
  if(s.comment){const mp=parseManual(s.comment);if(mp.paces.length)return `${obj}<div class="laps"><span class="mano">ritmos: </span>${mp.paces.map(p=>`<span class="lap">${esc(p)}</span>`).join("")}</div>`;}
  if(s.realPace)return `${obj}<div class="laps"><span class="lap">real ${esc(s.realPace)}</span></div>`;
  return obj||'<span class="dash">—</span>';
}
function fbTable(d){
  const rows=[];
  for(const mi of d.micros) for(const s of (mi.sessions||[])){
    if(s.strength) continue;
    const hasFb=s.executed||s.comment||s.sRPE!=null;
    if(!hasFb) continue;
    let comment=s.comment||"";
    if(!(s.hasFit&&s.laps&&s.laps.length)){const mp=parseManual(comment);if(mp.paces.length)comment=mp.stripped;}
    const sr=(s.sRPE!=null)?`<span class="${s.sRPE>=6?"srpe-hi":""}">${esc(s.sRPE)}</span>`:(s.progRpe!=null?`<span class="dim">${esc(s.progRpe)}*</span>`:"—");
    const dcell=`${esc(s.date.slice(5))}${(s.execDate&&s.execDate!==s.date)?`<div class="exec">ejec. ${esc(s.execDate.slice(5))}</div>`:""}`;
    rows.push(`<tr><td class="c">${dcell}</td><td>${s.key?"★ ":""}${esc(s.title||"")}</td><td class="c">${intChip(s.cat)}</td><td class="c">${sr}</td><td class="cm">${comment?esc(comment):'<span class="dash">—</span>'}</td><td class="c">${painChip(s.painClass)||'<span class="dash">—</span>'}</td><td class="fitc">${ritmoCell(s)}</td></tr>`);
  }
  if(!rows.length) return `<div class="nofb">Sin feedback cargado en el último mesociclo.</div>`;
  return `<div class="fbwrap"><table class="fb"><thead><tr><th>Fecha</th><th>Sesión</th><th>Tipo</th><th>sRPE</th><th>Comentario del atleta</th><th>Dolor</th><th>Ritmo obj → real</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}
function adh(d){let t=0,done=0;for(const m of d.micros){t+=m.progSessions;done+=m.doneSessions;}return{t,done,pct:t?Math.round(100*done/t):0};}
// ---- clasificación por TIPO DE CORREDOR (batching de contexto, Newport) ----
// El tier sale del NIVEL REAL del atleta (pico de volumen del plan, no la semana de receso) +
// un PISO por disciplina (un fondista en receso NO es un iniciante) + override manual opcional.
const cacoRe=/camin|caco|trote\s*\d+.?\s*[-·x].?\s*camin/i;
const OVERRIDE=(()=>{try{return JSON.parse(fs.readFileSync(DIR+"/tier-overrides.json","utf8"));}catch(e){return {};}})();
// Notas del coach por atleta (planificación / recordatorios para la próxima renovación).
// report/athlete-notes.json = { <nombre_norm>: {updated, title, text(\n-separado)} }  (gitignored)
const NOTES=(()=>{try{return JSON.parse(fs.readFileSync(DIR+"/athlete-notes.json","utf8"));}catch(e){return {};}})();
function noteOf(name){const nt=norm(name).split(" ").filter(w=>w.length>=3);let best=null,bo=0;
  for(const k of Object.keys(NOTES)){const kt=k.split(" ").filter(w=>w.length>=3);let sc=0;for(const a of kt)if(nt.some(b=>a===b||(a.length>=3&&b.length>=3&&(a.startsWith(b)||b.startsWith(a)))))sc++;if(sc>bo){bo=sc;best=NOTES[k];}}
  return bo>=2?best:null;}
function noteBlock(d){const n=noteOf(d.athlete);if(!n)return "";
  const body=String(n.text||"").split("\n").map(l=>l.trim()?`<div>${esc(l)}</div>`:"").join("");
  return `<div class="cnote"><div class="cnoteh">Nota del coach${n.updated?` · ${esc(n.updated)}`:""}${n.title?` — ${esc(n.title)}`:""}</div><div class="cnotebody">${body}</div></div>`;}
// volumen semanal de referencia = pico del plan (planPeakKm) o, si falta, pico del meso actual
function weeklyKm(d){let mx=0;for(const m of d.micros){if(m.future)continue;const v=parseFloat(String(m.progVol||"").replace(/[^\d.]/g,""))||0;if(v>mx)mx=v;}return Math.max(mx/1000, d.planPeakKm||0);}
function isCaco(d){let c=0;for(const m of d.micros)for(const s of (m.sessions||[])){if(s.strength)continue;if(cacoRe.test(s.title||""))c++;}return c>=2;}
const DISC_FLOOR=[[/ultra|50\s?k|100\s?k|gran\s?fondo|80\s?k/i,5],[/marat|42\s?k|trail\s?-?\s?42/i,4],[/21\s?k|media|half|trail\s?-?\s?21/i,3],[/10\s?k|calle\s?-?\s?10|trail\s?-?\s?10/i,2]];
function discFloor(d){const s=d.discipline||"";for(const[re,n]of DISC_FLOOR)if(re.test(s))return n;return 0;}
function tierOf(d){
  const ov=OVERRIDE[norm(d.athlete)];
  if(ov){const t=(typeof ov==="object")?ov.tier:ov; if(typeof ov==="object"&&ov.note)d._overNote=ov.note; d._receso=false; return /^t[1-5]$/.test(String(t))?String(t):("t"+t);}
  const fl=discFloor(d), k=d._km;
  if(d._caco && fl<3){d._receso=false;return "t1";}      // caminar-correr real (no un fondista en receso)
  let n = k<30?2 : k<50?3 : k<70?4 : 5;
  if(fl>n) n=fl;                                          // piso por disciplina
  d._receso = (k<15 && fl>=3);                            // volumen actual bajo + disciplina de fondo = receso/transición
  return "t"+n;
}
const TIERS=[
 {id:"t1",label:"Iniciantes · caminar-correr"},
 {id:"t2",label:"Consolidando al corredor · 15-30 km/sem"},
 {id:"t3",label:"Desarrollo · 30-50 km/sem"},
 {id:"t4",label:"Fondo · 50-70 km/sem"},
 {id:"t5",label:"Alto volumen · +70 km/sem"},
];
function fdate(iso){const m=String(iso||"").match(/(\d{4})-(\d{2})-(\d{2})/);return m?`${m[3]}/${m[2]}`:esc(iso||"");}
function trivial(a){const n=norm(a).replace(/[^a-z0-9 ]/g,"").trim();return !n||(n.length<=12&&/^(no|nada|ningun|ninguna|ninguno|sin|nop)/.test(n));}
function trunc(a,n){a=String(a||"").replace(/\s+/g," ").trim();if(a.length<=n)return a;let c=a.slice(0,n);const sp=c.lastIndexOf(" ");if(sp>n*0.6)c=c.slice(0,sp);return c+"…";}
function formBlock(fr){
  if(!fr) return "";
  const q={}; for(const [l,a] of (fr.qa||[])) q[l]=a;
  const L=[];
  const mol=q["Dolores/molestias"];
  if(mol&&painAns(mol)) L.push(`<div class="fl pain"><span class="flk">Molestia</span><span class="flv">${esc(trunc(mol,170))}</span></div>`);
  const met=[];
  if(q["Sueño"]) met.push(`Sueño ${esc(trunc(q["Sueño"],42))}`);
  if(q["Estrés"]) met.push(`Estrés ${esc(q["Estrés"])}`);
  if(q["Energía"]) met.push(`Energía ${esc(q["Energía"])}/10`);
  if(q["Motivación"]) met.push(`Motivación ${esc(q["Motivación"])}/10`);
  if(met.length) L.push(`<div class="fl"><span class="flk">Estado</span><span class="flv">${met.join(" · ")}</span></div>`);
  if(!trivial(q["Calendario competitivo"])) L.push(`<div class="fl"><span class="flk">Carreras</span><span class="flv">${esc(trunc(q["Calendario competitivo"],150))}</span></div>`);
  if(!trivial(q["Cambios logísticos"])) L.push(`<div class="fl"><span class="flk">Cambios</span><span class="flv">${esc(trunc(q["Cambios logísticos"],150))}</span></div>`);
  if(!trivial(q["Variación de peso"])) L.push(`<div class="fl"><span class="flk">Peso</span><span class="flv">${esc(trunc(q["Variación de peso"],110))}</span></div>`);
  if(!trivial(q["Intensidades/volúmenes"])) L.push(`<div class="fl"><span class="flk">Sensación</span><span class="flv">${esc(trunc(q["Intensidades/volúmenes"],130))}</span></div>`);
  if(!trivial(q["Algo extra"])) L.push(`<div class="fl"><span class="flk">Nota</span><span class="flv">${esc(trunc(q["Algo extra"],170))}</span></div>`);
  return `<div class="formb"><div class="formh">Formulario de renovación · ${fdate(fr.date)}</div>${L.join("")}</div>`;
}
function sugerencia(d,a){
  const pain=d.micros.some(m=>(m.sessions||[]).some(s=>s.painClass==="active"));
  if(a.done===0) return `<b>Sin ejecución</b> en el período → perseguir feedback / revisar continuidad antes de renovar.`;
  if(pain) return `Molestia activa en el meso → <b>cuidar</b> al renovar.`;
  if(a.pct<40) return `Adherencia baja (${a.pct}%) → revisar causas / ajustar carga.`;
  if(a.pct>=80) return `Buena adherencia (${a.pct}%) → renovar progresando (objetivo: lo define el coach).`;
  return `Adherencia ${a.pct}% → renovar según objetivo (lo define el coach).`;
}
function card(d){
  const a=adh(d), fr=matchForm(d.athlete);
  const pill=fr?`<span class="pill form">Formulario ✓</span>`:"";
  const apill=`<span class="pill adh ${a.pct===0?"a0":a.pct<40?"alo":a.pct>=80?"ahi":"amid"}">${a.pct}% · ${a.done}/${a.t}</span>`;
  return `<div class="card">
    <h3>${esc(d.athlete)} ${apill} ${pill}</h3>
    <div class="plan">${esc(d.plan.title)} · período ${d.periodMesos.join(" + ")} · ${esc(d.plan.start)}→${esc(d.plan.end)}${(d._km>=1&&!d._caco)?` · ~${Math.round(d._km)} km/sem`:""}${d.discipline?` · <span class="disc">${esc(d.discipline)}</span>`:""}${d._receso?` · <span class="receso">en receso · tier por nivel/disciplina</span>`:""}${d._overNote?` · <span class="receso">${esc(d._overNote)}</span>`:""}</div>
    ${noteBlock(d)}
    ${formBlock(fr)}
    <div class="fblabel">Feedback del último mesociclo</div>
    ${fbTable(d)}
    <div class="sug">Sugerencia (auto) → ${sugerencia(d,a)}</div>
  </div>`;
}
// ---- cargar y ordenar ----
const plans=files.map(f=>JSON.parse(fs.readFileSync(f,"utf8")));
for(const p of plans){p._caco=isCaco(p);p._km=weeklyKm(p);p._form=!!matchForm(p.athlete);p._tier=tierOf(p);}
const nForm=plans.filter(p=>p._form).length;
// dentro de cada tier: los que respondieron el formulario primero, luego por adherencia asc.
function tierSort(a,b){return (a._form?0:1)-(b._form?0:1) || adh(a).pct-adh(b).pct;}
function tierSection(t){
  const grp=plans.filter(p=>p._tier===t.id).sort(tierSort);
  if(!grp.length) return "";
  const nf=grp.filter(p=>p._form).length;
  return `<h2 class="sec ${t.id}">${esc(t.label)} <span class="count">— ${grp.length}${nf?` · ${nf} con formulario`:""}</span></h2>\n`+grp.map(card).join("\n");
}
// ---- Altas / nuevos ingresos (opcional): report/altas.json = [{n,s,warn,acc,dat}, ...] ----
const ALTAS=(()=>{try{return JSON.parse(fs.readFileSync(DIR+"/altas.json","utf8"));}catch(e){return [];}})();
function altaCard(x){return `<div class="card alta ${x.warn?"warn":""}"><h3>${esc(x.n)} <span class="pill ${x.warn?"alertp":"newp"}">${esc(x.s)}</span></h3><div class="acc"><b>Acción →</b> ${esc(x.acc)}</div><div class="dat"><b>Formulario de inicio:</b> ${esc(x.dat)}</div></div>`;}

const css=`:root{--ink:#1c2430;--muted:#5b6672;--line:#e2e7ee;--bg:#f6f8fb;--navy:#1f3a5f;--red:#c0392b}
*{box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:var(--bg);margin:0;line-height:1.46;font-size:14px}
.wrap{max-width:1060px;margin:0 auto;padding:24px 18px 60px}
header.top{border-bottom:3px solid var(--ink);padding-bottom:12px}h1{font-size:20px;margin:0 0 3px}.sub{color:var(--muted);font-size:13px}
.meta{display:flex;flex-wrap:wrap;gap:4px 18px;margin-top:8px;font-size:12.5px;color:var(--muted)}.meta b{color:var(--ink)}
.howto{background:#eef2f7;border-left:4px solid var(--ink);padding:10px 14px;border-radius:6px;margin:14px 0;font-size:12.7px}
h2.sec{font-size:15.5px;margin:26px 0 4px;padding:7px 12px;border-radius:7px;border:1px solid var(--line);background:#fff}
h2.t1{background:#eaf5ee;color:#2f7d4f}h2.t2{background:#fbf3e0;color:#b07d16}h2.t3{background:#e9f1fb;color:#1f5fae}h2.t4{background:#f0e8fb;color:#7a3fc0}h2.t5{background:#fbe9e7;color:#c0392b}h2.s-alta{background:#fbf0e4;color:#b5641a}
h2 .count{font-weight:400;color:var(--muted);font-size:12.5px}
.card{background:#fff;border:1px solid var(--line);border-left:5px solid #9fb2c8;border-radius:10px;padding:12px 15px;margin:11px 0;box-shadow:0 1px 2px rgba(20,30,45,.04)}
.card h3{margin:0 0 5px;font-size:15.5px;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.plan{font-size:12px;color:var(--muted);margin-bottom:8px}
.pill{font-size:10.5px;font-weight:600;padding:2px 8px;border-radius:20px;border:1px solid var(--line)}
.pill.form{background:#e9f5ee;color:#2f7d4f;border-color:#cfe8d8}
.pill.adh{font-variant-numeric:tabular-nums}.adh.a0{background:#fbe0dd;color:#c0392b;border-color:#f3c9c3}.adh.alo{background:#fdf3e6;color:#b5641a;border-color:#f0d9bf}.adh.amid{background:#eef2f7;color:#44505d}.adh.ahi{background:#e7f6ee;color:#2f7d4f;border-color:#cfe8d8}
.formb{background:#f3f8f4;border:1px solid #d8e9dd;border-radius:7px;padding:8px 11px;margin:6px 0 9px}
.formh{font-size:11px;font-weight:700;color:#2f7d4f;margin-bottom:5px;text-transform:uppercase;letter-spacing:.4px}
.fl{display:grid;grid-template-columns:78px 1fr;gap:2px 10px;font-size:12px;margin:2px 0}
.fl .flk{color:var(--muted);font-weight:700}.fl .flv{color:#1c2430}
.fl.pain .flv{color:var(--red);font-weight:600}.fl.pain .flk{color:var(--red)}
.fblabel{font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin:4px 0 3px}
.fbwrap{overflow-x:auto}
table.fb{width:100%;border-collapse:collapse;font-size:11.8px;margin-top:2px}
table.fb th{background:#33404f;color:#fff;text-align:left;padding:4px 7px;font-size:10px;font-weight:600}
table.fb td{border-bottom:1px solid #eef1f5;padding:4px 7px;vertical-align:top}
table.fb td.c{text-align:center;white-space:nowrap}table.fb td.cm{min-width:230px}
.int{display:inline-block;font-size:9.5px;font-weight:700;padding:1px 5px;border-radius:4px;background:#e7ebf0;color:#44505d}
.int.lit{background:#e3eefb;color:#1f5fae}.int.tht{background:#fbf1cf;color:#8a6d10}.int.hit{background:#fbe0dd;color:#c0392b}
.srpe-hi{color:#c0392b;font-weight:700}.dim{color:#aab3bf}
.pn{font-size:9.5px;font-weight:700;padding:1px 5px;border-radius:4px}.pn.act{background:#fbe0dd;color:#c0392b}.pn.mej{background:#efe3fb;color:#7a3fc0}
td.fitc{min-width:150px;font-size:10.8px}.obj{font-weight:700;color:#1f5fae;white-space:nowrap}
.laps{display:flex;flex-direction:column;gap:1px;margin-top:2px}.lap{font-size:10.2px;color:#44505d;white-space:nowrap;font-variant-numeric:tabular-nums}.mano{color:#8a6d10;font-weight:600}
.dash{color:#c3ccd6}
.sug{margin-top:8px;background:#0f1b2b;color:#fff;border-radius:6px;padding:7px 11px;font-size:12.5px}.sug b{color:#8fd0ff}
.disc{background:#eef2f7;color:#44505d;border-radius:4px;padding:0 5px;font-size:11px;font-weight:600}.receso{background:#fdf3e6;color:#b5641a;border-radius:4px;padding:0 5px;font-size:11px;font-weight:700}
.exec{font-size:9.5px;color:#b5641a;font-weight:600;white-space:nowrap}
.cnote{background:#fff8ec;border:1px solid #f0dcb8;border-left:4px solid #d98a2b;border-radius:7px;padding:9px 12px;margin:6px 0 9px}
.cnoteh{font-size:11px;font-weight:800;color:#9a5a12;text-transform:uppercase;letter-spacing:.4px;margin-bottom:5px}
.cnotebody{font-size:12px;color:#4a3b22;line-height:1.5}.cnotebody div{margin:1px 0}
.nofb{font-size:12px;color:#b5641a;background:#fff6ec;border-radius:6px;padding:6px 10px}
.card.alta{border-left-color:#b5641a}.card.alta.warn{border-left-color:var(--red)}
.pill.newp{background:#fbf0e4;color:#b5641a;border-color:#f0d9bf}.pill.alertp{background:#fbe0dd;color:#c0392b;border-color:#f3c9c3}
.acc{font-size:13px;margin:3px 0}.dat{font-size:12px;color:var(--muted);margin-top:4px}
footer{margin-top:26px;border-top:1px solid var(--line);padding-top:10px;font-size:11.5px;color:var(--muted)}
@media print{body{background:#fff;font-size:11px}.wrap{max-width:none;padding:0}.card{box-shadow:none;break-inside:avoid}h2.sec{break-after:avoid}}`;

const total=plans.length;
const TODAY=new Date(Date.now()-3*3600*1000); // Buenos Aires (UTC-3)
const todayStr=`${String(TODAY.getUTCDate()).padStart(2,"0")}/${String(TODAY.getUTCMonth()+1).padStart(2,"0")}/${TODAY.getUTCFullYear()}`;
const SUBTITLE=process.argv.slice(2).find(a=>!a.startsWith("--"))||""; // etiqueta opcional del lote (ej. "por vencer ≤7 días")
const titleExtra=SUBTITLE?` — ${esc(SUBTITLE)}`:"";
const altasSec=ALTAS.length?`<h2 class="sec s-alta">Altas / nuevos ingresos <span class="count">— ${ALTAS.length}</span></h2>
${ALTAS.map(altaCard).join("\n")}`:"";
const OUT=DIR+"/Informe-Renovacion.html";
const html=`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Informe de renovación</title><style>${css}</style></head><body><div class="wrap">
<header class="top"><h1>Informe de renovación${titleExtra}</h1>
<div class="sub">Una ficha por atleta con su feedback del último mesociclo · los que respondieron el formulario van primero</div>
<div class="meta"><span><b>Fecha:</b> ${todayStr}</span><span><b>Atletas:</b> ${total}</span><span><b>Respondieron formulario:</b> ${nForm}</span>${ALTAS.length?`<span><b>Altas nuevas:</b> ${ALTAS.length}</span>`:""}<span><b>Fuente:</b> Endurance Tool + formulario de renovación/inicio</span></div></header>
<div class="howto"><b>Cómo leerlo:</b> agrupado por <b>tipo de corredor</b> (volumen semanal) para trabajar en bloques afines y bajar el cambio de contexto. Dentro de cada bloque, los que <b>respondieron el formulario</b> van primero (con sus respuestas arriba de la ficha). Cada ficha trae el <b>feedback del último mesociclo</b> (ritmo obj→real; laps de pausa &gt;8'/km descartadas), la <b>adherencia</b> (solo runs) y una <b>sugerencia automática</b> (heurística: adherencia + molestia). Los objetivos de destino los define el coach.${ALTAS.length?" Al final, las <b>altas / nuevos ingresos</b> con qué hacer con cada uno.":""}</div>
${TIERS.map(tierSection).filter(Boolean).join("\n")}
${altasSec}
<footer>Generado desde Endurance Tool (último mesociclo del plan vigente) + formulario de renovación (Google Form) + formulario de inicio (intake). Adherencia = solo runs, sesiones vencidas. Sugerencia = heurística (no reemplaza el criterio del coach). Objetivos de destino: los define el coach.</footer>
</div></body></html>`;
fs.writeFileSync(OUT,html);
console.log("OK ->",OUT,"| atletas:",total,"| conForm:",nForm,"| altas:",ALTAS.length,"| bytes:",html.length);
TIERS.forEach(t=>{const n=plans.filter(p=>p._tier===t.id).length;if(n)console.log("   ",t.label,"->",n);});
