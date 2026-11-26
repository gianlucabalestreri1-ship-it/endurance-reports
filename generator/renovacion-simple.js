#!/usr/bin/env node
// Renovación — diseño RUDIMENTARIO (pedido coach 2026-11-26): por atleta solo
// nombre · formulario · tabla de ejecución (semanas×días) · análisis fino + próximo paso.
// Sin chips/pills/barras/colores de alerta. El análisis lo escribe el coach-asistente en
// report/renovacion-analisis.json (razonado y contrastado contra data/) y acá se inyecta.
// Uso: node generator/renovacion-simple.js  → report/Renovacion-Simple.html
const fs=require("fs"),path=require("path");
const DIR=path.join(__dirname,"..","report");
const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const norm=s=>String(s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9\s]/g," ").replace(/\s+/g," ").trim();
const toks=s=>norm(s).split(" ").filter(Boolean);
const FORMS=(()=>{try{return Object.values(JSON.parse(fs.readFileSync(DIR+"/form-responses.json","utf8")));}catch(e){return [];}})();
const ANA=(()=>{try{return JSON.parse(fs.readFileSync(DIR+"/renovacion-analisis.json","utf8"));}catch(e){return {};}})();
function matchForm(name){const nt=toks(name);let best=null,bo=0;for(const v of FORMS){const ft=toks(v.name);let sc=0;for(const a of ft)if(nt.some(b=>a===b||(a.length>=3&&b.length>=3&&(a.startsWith(b)||b.startsWith(a)))))sc++;if(sc>bo){bo=sc;best=v;}}return bo>=2?best:null;}
function lookupAna(name){const n=norm(name);if(ANA[n])return ANA[n];const hit=Object.keys(ANA).find(k=>{const kt=k.split(" ");return kt.length>=2&&kt.every(t=>n.includes(t));});return hit?ANA[hit]:null;}

const isDone=s=>!s.future&&!s.strength&&(s.executed||s.sRPE!=null||(s.comment&&s.comment.trim())||(Array.isArray(s.blocks)&&s.blocks.some(b=>(b.exec||[]).length)));
const fmtDM=d=>{const m=String(d||"").match(/^(\d{4})-(\d{2})-(\d{2})/);return m?`${m[3]}/${m[2]}`:esc(d);};
const DOW=["Do","Lu","Ma","Mi","Ju","Vi","Sa"], ORDER=[1,2,3,4,5,6,0];

function cellSessions(list){
  return list.map(s=>{
    if(s.strength) return `<div class="fz">Fuerza</div>`;
    let det="";
    const ws=(s.blocks||[]).filter(b=>b.kind==="work");
    if(s.future) det=`<span class="mut">(programada)</span>`;
    else if(!isDone(s)) det=`<span class="mut">— no reportada</span>`;
    else if(ws.length){
      let anyExec=false;
      det=ws.map(b=>{
        const z=b.zone!=null?` Z${b.zone}`:"";
        const obj=b.range?` (${esc(b.range)})`:"";
        let ex="";
        if((b.exec||[]).length){anyExec=true; ex=" = "+esc(b.exec.join(" "));}
        else if(b.noExec&&!s.hasFit) ex=" = —";
        return `<div class="bl">${esc(b.label||"")}${z}${obj}${ex}</div>`;
      }).join("");
      if(!anyExec&&s.realPace) det+=`<div class="bl">= ${esc(s.realPace)} <span class="mut">(medio)</span></div>`;
    } else if(s.realPace) det=`${s.targetPace?"("+esc(s.targetPace)+") ":""}= ${esc(s.realPace)}`;
    const sr=s.sRPE!=null?` <span class="mut">sRPE ${esc(s.sRPE)}</span>`:"";
    const pain=s.painClass==="active"?` <span class="pain">dolor</span>`:"";
    const mom=s.moment==="PM"?` <span class="mut">(PM)</span>`:"";
    return `<div class="sx"><span class="st">${esc(s.title||"")}</span>${mom}${sr}${pain}<div class="dt">${det}</div></div>`;
  }).join("");
}
function execTable(d){
  const micros=(d.micros||[]).filter(m=>!m.future);
  const colset=new Set();
  const rows=micros.map(m=>{
    const byDow={};
    for(const s of (m.sessions||[])){
      if(s.strength) continue;
      const dw=new Date(s.date+"T00:00:00").getDay();
      (byDow[dw]=byDow[dw]||[]).push(s); colset.add(dw);
    }
    return {m,byDow};
  });
  const cols=ORDER.filter(dw=>colset.has(dw));
  if(!cols.length) return `<p class="mut">Sin ejecución registrada en el período.</p>`;
  const head=`<tr><th class="wk"></th>${cols.map(dw=>`<th>${DOW[dw]}</th>`).join("")}</tr>`;
  const body=rows.map((r,i)=>{
    const tds=cols.map(dw=>`<td>${r.byDow[dw]?cellSessions(r.byDow[dw]):""}</td>`).join("");
    return `<tr><th class="wk">S${i+1}<div class="mut">${fmtDM(r.m.start)}</div></th>${tds}</tr>`;
  }).join("");
  return `<table class="ex"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}
function formB(fr){
  if(!fr) return `<p class="mut">Sin formulario en la ventana.</p>`;
  const map={}; for(const [q,a] of fr.qa) map[q]=a;
  const order=["Molestia","Carreras","Cambios","Sueño","Estrés","Energía","Motivación","Peso","Recup. pre-sesión","Nota"];
  const lines=order.filter(k=>map[k]&&map[k].trim()).map(k=>`<div><b>${esc(k)}:</b> ${esc(String(map[k]).replace(/\s+/g," ").slice(0,200))}</div>`);
  return `<div class="mut mb">Respondido ${fmtDM(fr.date)}</div>${lines.join("")}`;
}
function anaB(d){
  const a=lookupAna(d.athlete);
  if(!a) return `<p class="mut">Análisis pendiente (lo completo si el formato te cierra).</p>`;
  const row=(lab,v)=>v?`<div class="ar"><div class="al">${lab}</div><div class="av">${esc(v).replace(/\n/g,"<br>")}</div></div>`:"";
  return row("Objetivo / carreras",a.objetivo)+row("Volumen (histórico vs actual)",a.km)+row("El mes",a.mes)
    +row("Próximo paso",a.paso)+row("Estímulos",a.estimulos)+row("Microciclo típico",a.micro)+row("Qué comunicarle",a.comunicar);
}
function block(d){
  const fr=matchForm(d.athlete);
  return `<section class="at">
    <h2>${esc(d.athlete)}</h2>
    <div class="meta">${esc(d.plan.title)} · ${esc(d.discipline||"")}${d.planPeakKm?` · pico ${d.planPeakKm} km`:""} · plan ${esc(d.plan.start)}→${esc(d.plan.end)}</div>
    <h3>Formulario</h3>${formB(fr)}
    <h3>Ejecución del mes</h3>${execTable(d)}
    <h3>Análisis y próximo paso</h3>${anaB(d)}
  </section>`;
}

const files=fs.readdirSync(DIR).filter(f=>/^renewal-\d+-data\.json$/.test(f)).map(f=>JSON.parse(fs.readFileSync(path.join(DIR,f),"utf8")));
files.sort((a,b)=>String(a.athlete).localeCompare(String(b.athlete),"es"));

const css=`*{box-sizing:border-box}body{margin:0;background:#fff;color:#111;font:14px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif}
.wrap{max-width:1000px;margin:0 auto;padding:20px 16px 60px}
h1{font-size:19px;margin:0 0 16px;border-bottom:2px solid #111;padding-bottom:6px}
.at{margin:0 0 30px;padding-bottom:22px;border-bottom:1px solid #ddd}
.at h2{font-size:17px;margin:14px 0 2px}
.meta{color:#555;font-size:12px;margin-bottom:8px}
.at h3{font-size:12px;text-transform:uppercase;letter-spacing:.4px;color:#333;margin:14px 0 5px;border-left:3px solid #111;padding-left:7px}
.mut{color:#888}.mb{margin-bottom:4px}.pain{color:#b00;font-weight:600}.fz{color:#888;font-size:12px}
table.ex{border-collapse:collapse;width:100%;font-size:12px;table-layout:fixed}
table.ex th,table.ex td{border:1px solid #ccc;padding:5px 6px;vertical-align:top;text-align:left}
table.ex thead th{background:#f2f2f2;font-weight:700;text-align:center}
th.wk{width:58px;background:#f8f8f8;font-weight:700;color:#333;text-align:center;font-size:12px}
.sx{margin:0 0 6px}.sx:last-child{margin:0}.st{font-weight:600}.dt{color:#222}.bl{margin:1px 0}
.ar{display:flex;gap:10px;margin:0 0 7px}.al{flex:0 0 150px;font-weight:700;color:#333;font-size:12px}.av{flex:1}
@media(max-width:640px){.ar{flex-direction:column;gap:1px}.al{flex-basis:auto}table.ex{font-size:11px}}`;

const html=`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Renovación (simple)</title><style>${css}</style></head><body><div class="wrap">
<h1>Renovación — ${files.length} atletas</h1>
${files.map(block).join("\n")}
</div></body></html>`;
fs.writeFileSync(DIR+"/Renovacion-Simple.html",html);
console.log("OK -> report/Renovacion-Simple.html |",files.length,"atletas |",html.length,"bytes");
