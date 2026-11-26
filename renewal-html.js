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
// ritmo "6:47" / "6'47\"" -> "6'47\""  ·  rango "8:03–6:54" -> "8:03 - 6:54"
function fmtPaceV(p){return esc(String(p).replace(/(\d{1,2})[:'’](\d{2})(?:"|”)?/,function(_,a,b){return a+"'"+b+'"';}));}
function fmtRangeV(r){return esc(String(r||"").replace(/\s*–\s*/g," - "));}
// ritmo "M:SS"/"M'SS\"" -> segundos; rango de ritmos -> [rápido,lento] en seg (null si es RPE, no ritmo)
function paceToSec(v){const m=String(v).match(/(\d{1,2})\s*[:'’]\s*(\d{2})/);return m?(+m[1])*60+(+m[2]):null;}
function rangeSecs(r){const nums=String(r||"").match(/\d{1,2}\s*[:'’]\s*\d{2}/g);if(!nums||nums.length<2)return null;const a=paceToSec(nums[0]),b=paceToSec(nums[1]);if(a==null||b==null)return null;return [Math.min(a,b),Math.max(a,b)];}
// PROGRAMADO → EJECUTADO por bloque (dosis + zona + rango objetivo, con los ritmos ejecutados debajo).
function ritmoCell(s){
  if(Array.isArray(s.blocks)&&s.blocks.length){
    const out=s.blocks.map(b=>{
      if(b.kind==="warm") return `<div class="blk"><span class="blh">Bloque ${b.n} - ${esc(b.label)}${b.dur?" "+esc(b.dur):""}</span></div>`;
      if(b.kind==="pause") return `<div class="blk pau"><span class="blh">Bloque ${b.n} - ${b.dur?esc(b.dur)+" ":""}${esc(b.label)}</span></div>`;
      if(b.kind==="total"){const ex=(b.exec||[]).map(v=>b.bike?esc(v):fmtPaceV(v)).join("  ");return `<div class="blk"><span class="blh">${esc(b.label)}</span><div class="ex">${ex}${b.hr?` <span class="fc">FC ${b.hr}</span>`:""}</div></div>`;}
      const zone=b.zone!=null?` (Z${b.zone})`:"";
      const rng=b.range?` (${fmtRangeV(b.range)}${b.isPaceRange&&!b.bike?"/km":""})`:"";
      const rec=b.rec&&b.rec.dur?` <span class="rec">con ${esc(b.rec.dur)} pausa pasiva</span>`:"";
      let ex="";
      if(b.noExec) ex=`<div class="ex no">— (no ejecutado)</div>`;
      else if((b.exec||[]).length){const vals=b.exec.map(v=>b.bike?esc(v):fmtPaceV(v)).join("  ");ex=`<div class="ex">${vals}${b.hr?` <span class="fc">FC ${b.hr}</span>`:""}</div>`;}
      return `<div class="blk"><span class="blh">Bloque ${b.n} - ${esc(b.label)}${zone}${rng}${rec}</span>${ex}</div>`;
    }).join("");
    return `<div class="blocks">${out}</div>`;
  }
  // fallback (sesión sin breakdown): objetivo + real medio
  const obj=s.targetPace?`<span class="obj">obj ${esc(s.targetPace)}</span>`:"";
  if(s.realPace)return `${obj}<div class="laps"><span class="lap">real ${esc(s.realPace)}</span></div>`;
  return obj||'<span class="dash">—</span>';
}
// ---- VISTA SEMANAL (calendario tipo Endurance Tool): 1 grilla por microciclo, columnas Lun→Dom ----
function fmtDMY(iso){const m=String(iso||"").match(/(\d{4})-(\d{2})-(\d{2})/);return m?`${m[3]}/${m[2]}`:"";}
const DOW=["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];
function weekDays(startIso){
  const m=String(startIso||"").match(/(\d{4})-(\d{2})-(\d{2})/);if(!m)return [];
  const base=Date.UTC(+m[1],+m[2]-1,+m[3]);
  return Array.from({length:7},(_,i)=>new Date(base+i*86400000).toISOString().slice(0,10));
}
// breakdown COMPACTO para la celda del día (B1, dosis+zona+rango, ritmos debajo; pausas en una línea tenue)
function ritmoCompact(s){
  if(Array.isArray(s.blocks)&&s.blocks.length){
    return s.blocks.map(b=>{
      if(b.kind==="pause") return `<div class="blc pau">↺ ${b.dur?esc(b.dur)+" ":""}pausa</div>`;
      if(b.kind==="warm") return `<div class="blc">B${b.n} entrada${b.dur?" "+esc(b.dur):""}</div>`;
      if(b.kind==="total"){const ex=(b.exec||[]).map(v=>b.bike?esc(v):fmtPaceV(v)).join(" ");return `<div class="ex">${ex}${b.hr?` <span class="fc">FC${b.hr}</span>`:""}</div>`;}
      const zone=b.zone!=null?` Z${b.zone}`:"";
      const rng=b.range?` <span class="rg">(${fmtRangeV(b.range)})</span>`:"";
      let ex="";
      if(b.noExec) ex=`<div class="ex no">no ejec.</div>`;
      else if((b.exec||[]).length) ex=`<div class="ex">${b.exec.map(v=>b.bike?esc(v):fmtPaceV(v)).join(" ")}${b.hr?` <span class="fc">FC${b.hr}</span>`:""}</div>`;
      return `<div class="blc"><b>B${b.n}</b> ${esc(b.label)}${zone}${rng}</div>${ex}`;
    }).join("");
  }
  return s.realPace?`<div class="ex">real ${esc(s.realPace)}</div>`:"";
}
function sessCard(s,today){
  const future=s.date&&s.date>today;
  const cat=(s.cat||"").toUpperCase();
  const catCls=cat==="HIT"?"cHIT":cat==="THT"?"cThT":cat==="LIT"?"cLIT":"cOtr";
  const sr=(s.sRPE!=null)?`<span class="srp ${s.sRPE>=6?"srpe-hi":""}">sRPE ${esc(s.sRPE)}</span>`:"";
  const mom=s.moment?`<span class="mom">${esc(s.moment)}</span>`:"";
  const exc=(s.execDate&&s.execDate!==s.date)?`<span class="exc">ejec. ${fmtDMY(s.execDate)}</span>`:"";
  const body=s.strength?`<div class="fz">Fuerza</div>`:(future?`<div class="prog">programada</div>`:ritmoCompact(s));
  const noRep=(!s.strength&&!future&&!s.executed&&s.sRPE==null&&!s.comment)?`<div class="prog">sin reporte</div>`:"";
  const cm=(!s.strength&&s.comment)?`<div class="cm">${esc(s.comment)}</div>`:"";
  return `<div class="sess ${catCls}${future?" fut":""}">
    <div class="sh">${mom}${s.key?"★ ":""}${esc(s.title||"")} ${intChip(s.cat)}</div>
    <div class="sm">${sr}${painChip(s.painClass)}${exc}</div>
    ${body}${noRep}${cm}</div>`;
}
function weekGrid(mi,today){
  const days=weekDays(mi.start);if(!days.length)return "";
  const byDay={};for(const s of (mi.sessions||[]))if(s.date)(byDay[s.date]=byDay[s.date]||[]).push(s);
  // SOLO los días con sesión (se omiten los descansos) → las columnas con muchos datos se ensanchan.
  const active=days.map((d,i)=>({d,dow:DOW[i]})).filter(x=>byDay[x.d]&&byDay[x.d].length);
  if(!active.length) return "";
  const heads=active.map(x=>`<th>${x.dow} ${x.d.slice(8,10)}</th>`).join("");
  const cells=active.map(x=>{
    const ss=byDay[x.d].slice().sort((a,b)=>(a.moment||"")<(b.moment||"")?-1:1);
    return `<td>${ss.map(s=>sessCard(s,today)).join("")}</td>`;
  }).join("");
  const rv=(mi.realVol&&!/^0\s*m$/.test(String(mi.realVol).trim()))?` · ${esc(mi.realVol)}`:"";
  const banner=`Microciclo ${esc(mi.number||"")} · ${esc(mi.meso||"")} — ${fmtDMY(mi.start)} al ${fmtDMY(mi.end)} <span class="wkadh">${mi.doneSessions}/${mi.progSessions} ejecutadas${rv}</span>`;
  const minw=Math.max(360,active.length*150);
  return `<div class="wk"><div class="wkhead">${banner}</div><div class="wkscroll"><table class="wkgrid" style="min-width:${minw}px"><thead><tr>${heads}</tr></thead><tbody><tr>${cells}</tr></tbody></table></div></div>`;
}
function fbTable(d){
  const today=new Date(Date.now()-3*3600*1000).toISOString().slice(0,10);
  const anyFb=d.micros.some(mi=>(mi.sessions||[]).some(s=>s.executed||s.comment||s.sRPE!=null));
  if(!anyFb) return `<div class="nofb">Sin feedback cargado en el último mesociclo.</div>`;
  return d.micros.map(mi=>weekGrid(mi,today)).filter(Boolean).join("");
}
// ===== EJECUCIÓN DEL MESOCICLO, CONDENSADA =====
// El coach quiere VER toda la ejecución del mes (no un veredicto que lo deje ciego), pero SIN la grilla-calendario
// gigante que obliga a scrollear. Solución: 1 LÍNEA por sesión (fecha · tipo · sesión · sRPE · dolor · obj→real),
// agrupada por microciclo, + una línea de conteos arriba para orientar. Todo visible, el dato crudo a la vista.
function isSessDone(s){return !s.future&&!s.strength&&(s.executed||s.sRPE!=null||(s.comment&&s.comment.trim())||(Array.isArray(s.blocks)&&s.blocks.some(b=>(b.exec||[]).length)));}
// bloques de trabajo INLINE: "label Zx (obj rango) → ejecutado [FC]", separados por · (para la celda de la fila)
function blocksInline(s){
  const ws=(s.blocks||[]).filter(b=>b.kind==="work");
  if(!ws.length){ if(s.realPace)return `<b>${fmtPaceV(s.realPace)}</b>`; return s.targetPace?`<span class="bil">obj ${esc(s.targetPace)}</span>`:`<span class="dash">—</span>`; }
  let anyExec=false;
  const parts=ws.map(b=>{
    const z=b.zone!=null?` Z${b.zone}`:"";
    const obj=b.range?` <span class="bil">(${fmtRangeV(b.range)})</span>`:"";
    let ex="";
    if((b.exec||[]).length){ anyExec=true; ex=`<b>${b.exec.map(v=>b.bike?esc(v):fmtPaceV(v)).join(" ")}</b>`+(b.hr?` <span class="fc">FC${b.hr}</span>`:""); }
    else if(b.noExec && !s.hasFit){ ex=`<span class="no">no ejec.</span>`; } // "no ejec." SOLO si no hay FIT (si hay FIT, un bloque sin alinear es ruido de alineación, no un bloque saltado)
    return `<span class="bi">${esc(b.label)}${z}${obj}${ex?` → ${ex}`:""}</span>`;
  }).join(" · ");
  // FIT presente pero ningún bloque quedó alineado (continuo/por tiempo, o cross-day) → mostrar el ritmo medio real del dispositivo
  if(!anyExec && s.realPace) return parts+` · <b>${fmtPaceV(s.realPace)}</b> <span class="bil">(ritmo medio FIT)</span>`;
  return parts;
}
const metersOf=v=>{const m=String(v||"").match(/([\d.]+)\s*m/);return m?parseFloat(m[1]):0;};
const km1=m=>Math.round(m/100)/10;
// ¿es sesión de CALIDAD (moderada-alta)? tempo/umbral, intervalos/HIIT/VO2, o un fondo/long run, o clave marcada.
const LONG_RE=/fondo|long\s*run|larg|tirada|rodaje\s*larg/i;
function isQuality(s){if(s.strength)return false;const c=(s.cat||"").toUpperCase();return c==="THT"||c==="HIT"||!!s.key||LONG_RE.test(s.title||"");}
// una fila calma por sesión de calidad: fecha · nombre · sRPE · obj→real  (marca de intensidad = borde izq.)
function keyRow(s,today){
  const future=s.date&&s.date>today;
  const cat=(s.cat||"").toUpperCase();
  const bar=cat==="HIT"?"kb-hit":cat==="THT"?"kb-tht":LONG_RE.test(s.title||"")?"kb-long":"kb-lit";
  const sr=(s.sRPE!=null)?`<span class="ksr ${s.sRPE>=6?"hi":""}">sRPE ${esc(s.sRPE)}</span>`:"";
  const exc=(s.execDate&&s.execDate!==s.date)?` <span class="exc">ejec.${fmtDMY(s.execDate)}</span>`:"";
  const pc=s.painClass==="active"?`<span class="kpain">dolor</span>`:(s.painClass==="improving"?`<span class="kmej">mejora</span>`:"");
  let exe;
  if(future) exe=`<span class="prog">programada</span>`;
  else if(isSessDone(s)) exe=blocksInline(s);
  else exe=`<span class="miss">no ejecutada</span>`;
  const cm=(!future&&s.comment)?`<div class="kcm">${esc(trunc(s.comment,170))}</div>`:"";
  return `<div class="krow ${bar}${future?" futr":""}">
    <div class="kh"><span class="kdate">${fmtDMY(s.date)}${exc}</span> <span class="ktitle">${s.key?"★ ":""}${esc(s.title||"")}</span> ${sr}${pc}</div>
    <div class="kx">${exe}</div>${cm}</div>`;
}
function resumenBlock(d){
  const today=new Date(Date.now()-3*3600*1000).toISOString().slice(0,10);
  // ---- carga del mes: VOLUMEN prog→ejec + distribución de INTENSIDAD por sesiones (prog→hechas) ----
  let pVol=0,rVol=0; const cnt={LIT:[0,0],THT:[0,0],HIT:[0,0]}; let painS=null;
  for(const m of d.micros){
    pVol+=metersOf(m.progVol); rVol+=metersOf(m.realVol);
    for(const s of (m.sessions||[])){
      const future=s.date&&s.date>today;
      if(future||s.strength)continue;
      const c=(s.cat||"").toUpperCase(); if(cnt[c]){cnt[c][0]++; if(isSessDone(s))cnt[c][1]++;}
      if(s.painClass==="active"&&!painS)painS=s;
    }
  }
  const volPct=pVol?Math.round(100*rVol/pVol):0;
  const volBar=`<div class="vbar"><i style="width:${Math.min(100,volPct)}%"></i></div>`;
  const intPart=(lbl,c)=>cnt[c][0]?`<span class="ip ${c.toLowerCase()}"><i></i>${lbl} <b>${cnt[c][1]}/${cnt[c][0]}</b></span>`:"";
  const dash=`<div class="dash">
    <div class="dvol"><span class="dk">Volumen</span> <b>${km1(rVol)} / ${km1(pVol)} km</b> <span class="dpct">${volPct}%</span>${volBar}</div>
    <div class="dint"><span class="dk">Sesiones</span> ${intPart("Fácil","LIT")}${intPart("Moderada","THT")}${intPart("Alta","HIT")}</div>
    ${painS?`<div class="dpain">⚠ Molestia reportada${painS.comment?`: ${esc(trunc(painS.comment,110))}`:""}</div>`:""}
  </div>`;
  // ---- SESIONES DE CALIDAD (moderada-alta + fondos): obj→real, lo único con detalle ----
  const q=[];
  for(const m of d.micros)for(const s of (m.sessions||[]))if(isQuality(s))q.push(s);
  q.sort((a,b)=>(a.date||"")<(b.date||"")?-1:(a.date||"")>(b.date||"")?1:0);
  const anyFb=d.micros.some(mi=>(mi.sessions||[]).some(s=>isSessDone(s)));
  if(!anyFb&&!(cnt.LIT[0]+cnt.THT[0]+cnt.HIT[0])) return `<div class="nofb">Sin feedback cargado en el último mesociclo.</div>`;
  const keyList=q.length?`<div class="klabel">Sesiones de calidad · objetivo → ejecutado</div><div class="klist">${q.map(s=>keyRow(s,today)).join("")}</div>`
    :`<div class="klabel">Sesiones de calidad</div><div class="nofb">No hubo sesiones de moderada-alta intensidad en el período.</div>`;
  return dash+keyList;
}
// Adherencia = MESOCICLO ACTUAL (el que estamos renovando). selectPeriod agrega el meso PREVIO
// solo como contexto cuando el actual es corto (≤2 micros); no debe arrastrar la adherencia ni la
// sugerencia (caso Martin Sueta: meso actual 100%, pero el de arranque lo bajaba a 59%). Si el meso
// actual todavía no tiene ejecución suficiente (recién arrancó: <4 sesiones vencidas o 0 hechas),
// cae al período completo para no mostrar un 0% falso.
function adh(d){
  const groups=[];
  for(const m of d.micros){const k=String(m.meso!=null?m.meso:m.number);let g=groups.find(x=>x.k===k);if(!g){g={k,t:0,done:0};groups.push(g);}g.t+=m.progSessions;g.done+=m.doneSessions;}
  const allT=groups.reduce((s,g)=>s+g.t,0),allDone=groups.reduce((s,g)=>s+g.done,0);
  const cur=groups[groups.length-1]||{t:0,done:0};
  const useCur=groups.length>1 && cur.t>=4 && cur.done>0;
  const t=useCur?cur.t:allT,done=useCur?cur.done:allDone;
  const overallPct=allT?Math.round(100*allDone/allT):0;
  return {t,done,pct:t?Math.round(100*done/t):0,useCur,overallPct,overallT:allT,overallDone:allDone};
}
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
// --- Mesociclo de LIBRERÍA en curso (book_shop_template del meso actual): nombre + folder + próximo paso
//     + el FILTRO DE DECISIÓN que el coach escribió para la renovación (colapsable). ---
function libBlock(d){
  const lib=d.libMeso; if(!lib||!(lib.name||lib.description)) return "";
  const desc=lib.description?`<details class="libdet"><summary>Filtro de decisión del coach — apto/no-apto · alertas · veredicto</summary><pre class="libpre">${esc(lib.description)}</pre></details>`:"";
  return `<div class="libb"><div class="libh">📚 Mesociclo de librería en curso</div>`
    +`<div class="libr"><b>${esc(lib.name||"—")}</b>${lib.folder?` <span class="libf">· ${esc(lib.folder)}</span>`:""}${lib.next?` <span class="libn">→ próximo paso: ${esc(lib.next)}</span>`:""}</div>${desc}</div>`;
}
// señales del formulario que condicionan la carga a programar
function formSignals(fr){
  const q={}; if(fr) for(const [l,a] of (fr.qa||[])) q[l]=a;
  const num=s=>{const m=String(s||"").match(/(\d+(?:[.,]\d+)?)/);return m?parseFloat(m[1].replace(",",".")):null;};
  return {
    has:!!fr,
    molForm: !!(q["Dolores/molestias"]&&painAns(q["Dolores/molestias"])),
    energia:num(q["Energía"]), motiv:num(q["Motivación"]),
    estresAlto:/alto|elevad|much/i.test(q["Estrés"]||""),
    suenoMal:/mal|poco|insuf|interrump|regular|cuesta/i.test(q["Sueño"]||""),
    carreras: !trivial(q["Calendario competitivo"]) ? q["Calendario competitivo"] : "",
    cambios: !trivial(q["Cambios logísticos"]) ? q["Cambios logísticos"] : "",
  };
}
// Sugerencia = motor de reglas: (1) veredicto de progresión (contra adherencia + molestia + filtro de decisión del
// meso de librería), (2) señales del formulario que condicionan la carga, (3) foco metodológico ANCLADO a la base
// (data/: Magness amateur para recreacionales · corpus noruego para fondo). NO reemplaza al coach.
function sugerencia(d,a,fr){
  const painMeso=d.micros.some(m=>(m.sessions||[]).some(s=>s.painClass==="active"));
  const sig=formSignals(fr), lib=d.libMeso, P=[];
  let v;
  if(a.done===0) v=`<b>Sin ejecución</b> en el meso → perseguir feedback y revisar continuidad ANTES de renovar.`;
  else if(painMeso||sig.molForm) v=`<b>Cuidar</b>: molestia reportada → mantener/retroceder dosis, bajar impacto y asegurar tolerancia tisular antes de progresar.`;
  else if(a.pct<50) v=`Adherencia ${a.pct}% → <b>no avanzar</b>: repetir/ajustar el mismo mesociclo para consolidar.`;
  else if(a.pct>=80) v=`Adherencia ${a.pct}% sin molestia${sig.has?" + formulario OK":""} → <b>apto para progresar</b>${lib&&lib.next?` al <b>${esc(lib.next)}</b>`:""}${lib?` (verificar contra tu filtro de decisión del meso)`:""}.`;
  else v=`Adherencia ${a.pct}% → progresar con cautela o repetir según objetivo${lib?` (ver filtro de decisión)`:""}.`;
  P.push(`<div><span class="sgk">Progresión:</span> ${v}</div>`);
  const fl=[];
  if(sig.estresAlto||sig.suenoMal) fl.push("carga alostática alta (sueño/estrés) → NO sumar densidad, priorizar recuperación");
  if(sig.energia!=null&&sig.energia<=5) fl.push(`energía ${sig.energia}/10 → consolidar, no forzar`);
  if(sig.motiv!=null&&sig.motiv<=5) fl.push(`motivación ${sig.motiv}/10 → variar estímulo / meta corta`);
  if(sig.carreras) fl.push("hay calendario competitivo → si la carrera está ≤6 sem, entrar a afinamiento");
  if(sig.cambios) fl.push("cambios logísticos reportados → recalcular días/volumen disponibles");
  if(fl.length) P.push(`<div><span class="sgk">Formulario:</span> ${esc(fl.join(" · "))}</div>`);
  const km=d._km||0, tier=d._tier||"", caco=!!d._caco;
  let src;
  if(/t4|t5/.test(tier)) src=`Fondo/alto volumen → <b>volumen aeróbico primero</b> + umbral fraccionado controlado (<b>corpus noruego</b>: sub-umbral Z3-Z4 @2.5-3.5 mmol; fondo ≤21 km, base sin anaeróbico); la velocidad es mantenimiento.`;
  else if(caco||tier==="t1") src=`Caminar-correr / iniciante → <b>NO correr continuo largo</b> (no lo tolera). Progresar la <b>duración del trote de a poco</b> y reducir las pausas de caminata gradualmente (p.ej. +1-2' de trote ó −1 pausa por microciclo); meta de mediano plazo ~20-30' continuos ANTES de pensar en calidad. Prioridad = tolerancia tisular + hábito (<b>Magness amateur</b>: idiot-proofing · consistencia&gt;heroísmo).`;
  else if(/t3/.test(tier)&&km>=35) src=`Desarrollo (corre ~${Math.round(km)} km) → equilibrio umbral + economía (~2:1 aeróbico:velocidad, <b>Magness</b>); progresión GRADUAL de volumen antes de sumar intensidad (base noruega: aeróbico primero).`;
  else src=`Consolidando (corre continuo, ~${km>=1?Math.round(km)+' km':'<30 km'}) → base aeróbica <b>Magness amateur</b>: llevar los rodajes <b>HACIA</b> 45-60' continuos 4-5 días SIN saltos bruscos + strides 'feel-good-fast'; recién después un toque de sub-umbral Z3-Z4 (≤2/sem). Progresar por duración/densidad, no por ritmo.`;
  P.push(`<div><span class="sgk">Foco (base):</span> ${src}</div>`);
  P.push(`<div class="sgc">El objetivo de destino y la decisión final los define el coach. Para un análisis fino por atleta (cruce completo con la base de datos), pedir el detalle.</div>`);
  return P.join("");
}
function card(d){
  const a=adh(d), fr=matchForm(d.athlete);
  const pill=fr?`<span class="pill form">Formulario ✓</span>`:"";
  const apill=`<span class="pill adh ${a.pct===0?"a0":a.pct<40?"alo":a.pct>=80?"ahi":"amid"}" title="${a.useCur?"mesociclo actual (el que se renueva)":"período completo"}">${a.pct}% · ${a.done}/${a.t}${a.useCur?" · meso actual":""}</span>`;
  return `<div class="card">
    <h3>${esc(d.athlete)} ${apill} ${pill}</h3>
    <div class="plan">${esc(d.plan.title)} · período ${d.periodMesos.join(" + ")} · ${esc(d.plan.start)}→${esc(d.plan.end)}${(d._km>=1&&!d._caco)?` · ~${Math.round(d._km)} km/sem`:""}${a.useCur?` · <span class="disc">adher. período completo ${a.overallPct}% (${a.overallDone}/${a.overallT}, incl. meso previo de contexto)</span>`:""}${d.discipline?` · <span class="disc">${esc(d.discipline)}</span>`:""}${d._receso?` · <span class="receso">en receso · tier por nivel/disciplina</span>`:""}${d._overNote?` · <span class="receso">${esc(d._overNote)}</span>`:""}</div>
    ${noteBlock(d)}
    <div class="fblabel">Qué hizo este mes</div>
    ${resumenBlock(d)}
    ${libBlock(d)}
    ${formBlock(fr)}
    <div class="sug"><div class="sugt">Sugerencia automática (referencia · NO reemplaza al coach)</div>${sugerencia(d,a,fr)}</div>
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
/* ---- Dashboard de carga (calmo, mínimo color) ---- */
.dash{background:#f7f9fb;border:1px solid #e6ebf1;border-radius:8px;padding:9px 12px;margin-bottom:9px}
.dvol,.dint{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px;color:#2a3542}
.dint{margin-top:6px}
.dk{font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;color:#8a97a5;min-width:68px}
.dvol b,.dint b{color:#13202e;font-variant-numeric:tabular-nums}.dpct{color:#5a6673;font-weight:700}
.vbar{flex:1;min-width:90px;height:7px;background:#e4e9ef;border-radius:4px;overflow:hidden}.vbar i{display:block;height:100%;background:#3f6fd1}
.ip{display:inline-flex;align-items:center;gap:4px;font-size:12.5px;color:#48535f}.ip i{width:8px;height:8px;border-radius:2px;display:inline-block}
.ip.lit i{background:#6aa0e0}.ip.tht i{background:#e0b64c}.ip.hit i{background:#d9534f}
.dpain{margin-top:6px;color:#9c2a1e;font-weight:700;font-size:12px}
/* ---- Sesiones de calidad (lo único con detalle) ---- */
.klabel{font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;margin:4px 0 4px}
.klist{display:flex;flex-direction:column;gap:5px}
.krow{border:1px solid #e9edf2;border-left:3px solid #c7ced6;border-radius:6px;padding:6px 10px;background:#fff}
.krow.kb-hit{border-left-color:#d9534f}.krow.kb-tht{border-left-color:#e0b64c}.krow.kb-long{border-left-color:#5a8fd6}.krow.kb-lit{border-left-color:#9fb4c8}
.krow.futr{opacity:.5}
.kh{display:flex;align-items:baseline;gap:7px;flex-wrap:wrap;font-size:13px}
.kdate{color:#6b7682;font-variant-numeric:tabular-nums;font-size:11.5px;white-space:nowrap}
.ktitle{font-weight:700;color:#1b2733;flex:1}
.ksr{font-size:11px;font-weight:700;color:#55606d}.ksr.hi{color:#b23121}
.kpain{font-size:11px;font-weight:700;color:#b23121}.kmej{font-size:11px;font-weight:700;color:#7a4fb0}
.kx{font-size:12px;color:#39434e;line-height:1.5;margin-top:2px}
.kx .bil{color:#78838f}.kx b{color:#13202e}.kx .no,.kx .miss{color:#c0392b;font-weight:700}.kx .fc{color:#7a6a45;font-size:10.5px}
.kx .prog{color:#9aa6b2;font-style:italic}
.kcm{color:#5a6673;font-size:11px;font-style:italic;margin-top:2px}
.exc{color:#b5641a;font-size:10px;font-weight:600}
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
.blocks{display:flex;flex-direction:column;gap:2px}
.blk{line-height:1.3}.blk .blh{font-size:10.6px;color:#2b3440;font-weight:600}
.blk .ex{font-size:11px;color:#1a6b2e;font-variant-numeric:tabular-nums;padding-left:9px}
.blk .ex.no{color:#c0392b;font-weight:600}
.blk.pau .blh{color:#8a94a0;font-weight:500}
.blk .rec{color:#8a94a0;font-weight:400}.blk .fc{color:#8a94a0;font-weight:400}
/* ---- vista semanal (calendario) ---- */
.wk{margin:8px 0 12px;border:1px solid var(--line);border-radius:8px;overflow:hidden}
.wkhead{background:var(--navy);color:#fff;font-size:12.5px;font-weight:600;padding:6px 10px}
.wkhead .wkadh{float:right;font-weight:400;opacity:.9}
.wkscroll{overflow-x:auto}
table.wkgrid{width:100%;table-layout:fixed;border-collapse:collapse}
table.wkgrid th{background:#eef2f7;color:#2b3440;font-size:11px;font-weight:700;text-align:center;padding:4px 3px;border:1px solid var(--line)}
table.wkgrid td{border:1px solid var(--line);vertical-align:top;padding:4px 5px;height:100%}
.sess{border-left:3px solid #c9d2dc;border-radius:4px;background:#fbfcfd;padding:3px 4px;margin-bottom:3px}
.sess.cLIT{border-left-color:#6fa8dc}.sess.cThT{border-left-color:#ffd24d}.sess.cHIT{border-left-color:#e06666}.sess.cOtr{border-left-color:#c9d2dc}
.sess.fut{opacity:.6}
.sess .sh{font-size:11px;font-weight:600;color:#1c2430;line-height:1.25;margin-bottom:1px}
.sess .mom{font-size:9px;background:#e3e9f0;color:#5b6672;border-radius:3px;padding:0 3px;margin-right:2px;vertical-align:middle}
.sess .sm{display:flex;flex-wrap:wrap;gap:3px;margin:1px 0}
.sess .srp{font-size:9.5px;color:#44505d;background:#eef2f7;border-radius:3px;padding:0 3px}.sess .srp.srpe-hi{background:#fde2df;color:#b23b2e;font-weight:700}
.sess .exc{font-size:9px;color:#8a6d10}
.sess .fz,.sess .prog{font-size:10px;color:#8a94a0;font-style:italic}
.blc{font-size:9.8px;color:#2b3440;line-height:1.25}.blc b{color:#1c2430}.blc .rg{color:#7a8491}.blc.pau{color:#aab2bd}
.sess .ex{font-size:10px;color:#1a6b2e;font-variant-numeric:tabular-nums;padding-left:4px;line-height:1.25}.sess .ex.no{color:#c0392b}.sess .ex .fc{color:#8a94a0}
.sess .cm{font-size:9.7px;color:#55606c;margin-top:2px;line-height:1.3}
.dash{color:#c3ccd6}
.sug{margin-top:8px;background:#0f1b2b;color:#e9f1fb;border-radius:6px;padding:9px 12px;font-size:12.5px;line-height:1.5}.sug b{color:#8fd0ff}.sug>div{margin:3px 0}
.sugt{font-size:10.5px;font-weight:800;color:#9fb4ca;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px}
.sgk{display:inline-block;min-width:78px;font-weight:800;color:#ffd27a}
.sgc{margin-top:5px;font-size:11px;color:#9fb4ca;font-style:italic}
.libb{background:#eef4ff;border:1px solid #c7d9f5;border-left:4px solid #3f6fd1;border-radius:7px;padding:9px 12px;margin:6px 0 9px}
.libh{font-size:10.5px;font-weight:800;color:#2d5bb0;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px}
.libr{font-size:13px;color:#1e3a5f}.libf{color:#5a6b80;font-weight:600;font-size:11.5px}.libn{background:#dde9ff;color:#2d5bb0;border-radius:4px;padding:0 6px;font-size:11px;font-weight:700;white-space:nowrap}
.libdet{margin-top:6px}.libdet summary{cursor:pointer;font-size:11px;font-weight:700;color:#2d5bb0}
.libpre{white-space:pre-wrap;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;color:#2a3b50;background:#fbfdff;border:1px solid #d7e3f5;border-radius:6px;padding:8px 10px;margin:6px 0 0;max-height:280px;overflow:auto}
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
<div class="howto"><b>Cómo leerlo:</b> agrupado por <b>tipo de corredor</b> (volumen semanal) para trabajar en bloques afines y bajar el cambio de contexto. Dentro de cada bloque, los que <b>respondieron el formulario</b> van primero (con sus respuestas arriba de la ficha). Cada ficha trae el <b>feedback del último mesociclo</b> (ritmo obj→real; laps de pausa &gt;8'/km descartadas), la <b>adherencia del mesociclo actual</b> (el que se renueva; si el período trae el meso previo como contexto, su adherencia global va aclarada al lado) y una <b>sugerencia automática</b> (heurística: adherencia + molestia). Los objetivos de destino los define el coach.${ALTAS.length?" Al final, las <b>altas / nuevos ingresos</b> con qué hacer con cada uno.":""}</div>
${TIERS.map(tierSection).filter(Boolean).join("\n")}
${altasSec}
<footer>Generado desde Endurance Tool (último mesociclo del plan vigente) + formulario de renovación (Google Form) + formulario de inicio (intake). Adherencia = sesiones vencidas del <b>mesociclo actual</b> (el meso previo, si se muestra, es contexto). Sugerencia = heurística (no reemplaza el criterio del coach). Objetivos de destino: los define el coach.</footer>
</div></body></html>`;
fs.writeFileSync(OUT,html);
console.log("OK ->",OUT,"| atletas:",total,"| conForm:",nForm,"| altas:",ALTAS.length,"| bytes:",html.length);
TIERS.forEach(t=>{const n=plans.filter(p=>p._tier===t.id).length;if(n)console.log("   ",t.label,"->",n);});
