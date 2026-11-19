#!/usr/bin/env node
// Biblioteca de metodología: 1 HTML autocontenido con buscador que renderiza TODOS los data/*.json
// legibles, cada entrada desplegable de un clic. Reproducible: re-correr cuando crezca data/.
// Uso: node generator/biblioteca-html.js  → report/Biblioteca-Metodologia.html
const fs = require("fs"), path = require("path");
const DATA = path.join(__dirname, "..", "data");
const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// JSON → HTML legible (recursivo, claves como rótulos)
function render(v, depth) {
  if (v == null) return "";
  if (typeof v === "string") return `<span class="val">${esc(v)}</span>`;
  if (typeof v === "number" || typeof v === "boolean") return `<span class="val">${esc(v)}</span>`;
  if (Array.isArray(v)) {
    if (!v.length) return "";
    const allScalar = v.every(x => typeof x !== "object" || x == null);
    if (allScalar) return `<ul class="arr">${v.map(x => `<li>${render(x, depth + 1)}</li>`).join("")}</ul>`;
    return `<ol class="arrobj">${v.map(x => `<li>${render(x, depth + 1)}</li>`).join("")}</ol>`;
  }
  // objeto
  const rows = Object.entries(v).map(([k, val]) => {
    const label = esc(k.replace(/_/g, " "));
    const body = render(val, depth + 1);
    if (!body) return "";
    const scalar = (typeof val !== "object" || val == null);
    return `<div class="kv${scalar ? " sc" : ""}"><span class="k">${label}</span>${scalar ? ": " : ""}${body}</div>`;
  }).filter(Boolean).join("");
  return `<div class="obj d${Math.min(depth, 4)}">${rows}</div>`;
}

const files = fs.readdirSync(DATA).filter(f => f.endsWith(".json")).sort();
const entries = files.map(f => {
  let j; try { j = JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8")); } catch (e) { return null; }
  const titulo = j.titulo || j.title || f.replace(/\.json$/, "");
  const tipo = j.tipo || "";
  const uso = j.uso || j.nota || "";
  const esGuia = /gu[ií]a pr[aá]ctica|manual de aplicaci|c[oó]mo|protocolo|cat[aá]logo|microciclos|modelo/i.test(tipo + " " + titulo);
  return { f, id: j.id || f, titulo, tipo, uso, esGuia, html: render(j, 0) };
}).filter(Boolean);

const card = e => `<article class="entry" data-txt="${esc((e.titulo + " " + e.tipo + " " + e.uso + " " + e.f).toLowerCase())}">
  <details><summary><b>${esc(e.titulo)}</b>${e.esGuia ? ` <span class="badge guia">guía/manual</span>` : ` <span class="badge fuente">fuente</span>`}<div class="file">${esc(e.f)}</div>${e.uso ? `<div class="uso">${esc(e.uso.slice(0, 220))}${e.uso.length > 220 ? "…" : ""}</div>` : ""}</summary>
  <div class="content">${e.html}</div></details></article>`;

const css = `:root{--ink:#1b2733;--mut:#6b7682;--line:#e6ebf1;--blue:#2d5bb0}*{box-sizing:border-box}
body{margin:0;background:#f4f6f9;color:var(--ink);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}
.wrap{max-width:900px;margin:0 auto;padding:20px 16px 60px}
h1{font-size:20px;margin:0 0 2px}.sub{color:var(--mut);font-size:12.5px;margin-bottom:14px}
.search{position:sticky;top:0;background:#f4f6f9;padding:8px 0 10px;z-index:5}
.search input{width:100%;padding:10px 12px;border:1px solid #cfd8e3;border-radius:8px;font-size:14px}
.count{color:var(--mut);font-size:11.5px;margin:4px 2px}
.entry{background:#fff;border:1px solid var(--line);border-radius:9px;margin-bottom:8px;overflow:hidden}
summary{cursor:pointer;padding:11px 13px;list-style:none}summary::-webkit-details-marker{display:none}
summary b{font-size:14.5px;color:#13202e}
.badge{font-size:10px;font-weight:800;border-radius:4px;padding:1px 6px;margin-left:6px;vertical-align:middle}
.badge.guia{background:#eef7f0;color:#1a6a3c}.badge.fuente{background:#eef4ff;color:#2d5bb0}
.file{color:#9aa6b2;font-size:10.5px;margin-top:2px;font-family:ui-monospace,monospace}
.uso{color:var(--mut);font-size:12px;margin-top:4px}
.content{padding:4px 14px 14px;border-top:1px solid #eef2f7;font-size:12.5px}
.kv{margin:3px 0}.kv.sc{margin:1px 0}
.k{font-weight:700;color:var(--blue)}
.obj{padding-left:10px;border-left:2px solid #eef2f7;margin:3px 0}.obj.d0{border:0;padding-left:0}
.val{color:#2a3542}.arr{margin:2px 0;padding-left:18px}.arrobj{margin:2px 0;padding-left:18px}
.arr li,.arrobj li{margin:1px 0}
@media(max-width:620px){.wrap{padding:14px 10px 40px}}`;

const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Biblioteca de metodología</title><style>${css}</style></head><body><div class="wrap">
<h1>Biblioteca de metodología — ${entries.length} entradas</h1>
<div class="sub">Fuentes de evidencia + guías/manuales de aplicación. Buscá por nombre o tema y abrí cada una de un clic. Generado de <code>data/</code>.</div>
<div class="search"><input id="q" type="search" placeholder="Buscar estudio, tema, autor… (ej: noruego, umbral, maratón, Casado, test)" autocomplete="off"><div class="count" id="count"></div></div>
<div id="list">${entries.map(card).join("")}</div>
<script>
const q=document.getElementById('q'),list=document.getElementById('list'),count=document.getElementById('count');
const cards=[...document.querySelectorAll('.entry')];
function upd(){const t=q.value.trim().toLowerCase();let n=0;for(const c of cards){const show=!t||c.dataset.txt.includes(t)||c.querySelector('.content').textContent.toLowerCase().includes(t);c.style.display=show?'':'none';if(show)n++;}count.textContent=n+' / '+cards.length+(t?' coinciden':' entradas');}
q.addEventListener('input',upd);upd();
</script>
</div></body></html>`;
fs.writeFileSync(path.join(__dirname, "..", "report", "Biblioteca-Metodologia.html"), html);
console.log("OK -> report/Biblioteca-Metodologia.html |", entries.length, "entradas |", html.length, "bytes");
