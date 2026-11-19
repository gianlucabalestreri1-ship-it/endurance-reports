#!/usr/bin/env node
// Paso a paso para CARGAR la librería de Endurance Tool desde data/libreria-et-maestra.json.
// Replicable: re-correr cuando crezca el maestro (nuevos autores/sesiones).
// Uso: node generator/libreria-maestra-html.js  → report/Libreria-ET-maestra.html
const fs = require("fs"), path = require("path");
const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const M = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "libreria-et-maestra.json"), "utf8"));

// color por zona (modelo base: LIT azul / ThT ámbar / HIT rojo)
const zColor = c => {
  if (/Z1|Z2/.test(c)) return "#1c4e86";
  if (/Z3|Z4/.test(c)) return "#8a6414";
  if (/Z5|Z6|Z7|Z8/.test(c)) return "#a33123";
  if (/5K|10K|21K|42K|Específico/.test(c)) return "#6b5cab";
  return "#5a6673";
};

let paso = 0;
const folderCard = f => {
  paso++;
  const col = zColor(f.carpeta);
  const ses = f.sesiones.map(s => `<li><label><input type="checkbox"> <code>${esc(s)}</code></label></li>`).join("");
  return `<section class="step">
    <div class="shead" style="border-left-color:${col}">
      <span class="pn">Paso ${paso}</span>
      <h3>Crear carpeta: <code class="fold">${esc(f.carpeta)}</code></h3>
    </div>
    <div class="snote">${esc(f.nota)}</div>
    <div class="scount">${f.sesiones.length} sesiones:</div>
    <ul class="ses">${ses}</ul>
  </section>`;
};

const nor = M.autores.NOR;
const folders = nor.carpetas.map(folderCard).join("");
const totalSes = nor.carpetas.reduce((a, f) => a + f.sesiones.length, 0);

const roadmap = M.roadmap_autores.map(r => `<tr>
  <td><b>${esc(r.autor)}</b></td><td>${esc(r.que)}</td>
  <td><code>${esc(r.ejemplo_carpeta)}</code></td>
  <td><code>${esc(r.ejemplo_sesion)}</code></td></tr>`).join("");

const css = `:root{--ink:#1b2733;--mut:#6b7682;--line:#e6ebf1;--bg:#f4f6f9}*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}
.wrap{max-width:860px;margin:0 auto;padding:22px 16px 70px}
h1{font-size:21px;margin:0 0 2px}.sub{color:var(--mut);font-size:12.5px;margin-bottom:14px}
.conv{background:#fff;border:1px solid var(--line);border-radius:9px;padding:12px 15px;margin-bottom:14px;font-size:12.5px}
.conv b{color:#13202e}.conv code{background:#eef2f7;border-radius:4px;padding:1px 5px;font-size:12px}
.conv .r{margin:5px 0}
.phase{font-size:12px;text-transform:uppercase;letter-spacing:.4px;color:#2d5bb0;font-weight:800;margin:20px 2px 8px;border-top:2px solid #dde5ef;padding-top:12px}
.step{background:#fff;border:1px solid var(--line);border-radius:9px;margin-bottom:9px;overflow:hidden}
.shead{border-left:5px solid #888;padding:9px 13px;display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.pn{font-size:10.5px;font-weight:800;color:#fff;background:#3f6fd1;border-radius:4px;padding:2px 7px;letter-spacing:.3px}
.shead h3{font-size:14px;margin:0;font-weight:600}
.fold{background:#eef2f7;border-radius:5px;padding:2px 7px;font-size:13px;color:#13202e}
.snote{color:var(--mut);font-size:11.8px;padding:7px 14px 2px}
.scount{font-size:11px;color:#8a95a1;padding:4px 14px 0;font-weight:700}
.ses{margin:4px 0 12px;padding:0 14px;list-style:none;columns:2;column-gap:22px}
@media(max-width:620px){.ses{columns:1}}
.ses li{margin:3px 0;break-inside:avoid}
.ses label{cursor:pointer;display:flex;gap:7px;align-items:center}
.ses code{font-size:12px;color:#2a3542}
.rm{width:100%;border-collapse:collapse;font-size:12px;background:#fff;margin-top:4px}
.rm th,.rm td{border:1px solid #e8edf3;padding:6px 8px;text-align:left;vertical-align:top}
.rm th{background:#f3f6fa;font-size:10.5px;text-transform:uppercase;color:#5a6673}
.rm code{font-size:11px;background:#f4eefb;border-radius:4px;padding:1px 5px}
.fuera{background:#fff8ec;border:1px solid #f0dcb8;border-radius:8px;padding:10px 14px;margin-top:12px;font-size:12.5px;color:#5a4a2a}
.tot{background:#eef7f0;border:1px solid #c9e4d3;border-radius:8px;padding:9px 13px;font-size:12.5px;color:#1a5a34;margin-bottom:14px}</style>`;

const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Librería ET — paso a paso</title><style>${css}</head><body><div class="wrap">
<h1>Librería de Endurance Tool — paso a paso</h1>
<div class="sub">${esc(M.estado)}</div>

<div class="conv">
  <div class="r"><b>Convención:</b> ${esc(M.convencion.regla)}</div>
  <div class="r"><b>Carpeta:</b> <code>${esc(M.convencion.carpeta)}</code></div>
  <div class="r"><b>Sesión:</b> <code>${esc(M.convencion.sesion)}</code></div>
  <div class="r"><b>Config ET:</b> ${esc(M.convencion.config_ET)}</div>
</div>

<div class="tot"><b>Fase 1 — Noruega (NOR):</b> ${nor.carpetas.length} carpetas · ${totalSes} sesiones. Cargá de arriba a abajo (Z1 → Z8 → específicos). Tildá cada sesión a medida que la creás en ET.</div>

<div class="phase">Fase 1 · Cargar la librería NOR</div>
${folders}

<div class="phase">Fase 2 · Próximos autores (los decidimos uno por uno)</div>
<table class="rm"><thead><tr><th>Autor</th><th>Qué aporta</th><th>Ej. carpeta</th><th>Ej. sesión</th></tr></thead><tbody>${roadmap}</tbody></table>

<div class="fuera"><b>Fuera de la librería por-autor</b> (quedan como carpetas propias): ${M.fuera_de_libreria_por_autor.carpetas.map(esc).join(" · ")}.</div>

</div></body></html>`;

const out = path.join(__dirname, "..", "report", "Libreria-ET-maestra.html");
fs.writeFileSync(out, html);
console.log("OK ->", out, "|", nor.carpetas.length, "carpetas |", totalSes, "sesiones |", html.length, "bytes");
