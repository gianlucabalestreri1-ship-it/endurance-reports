#!/usr/bin/env node
// Genera el catálogo NORUEGO de sesiones (data/noruego-catalogo-sesiones.json) como HTML listo para
// cargar en la LIBRERÍA de Endurance Tool: por carpeta → nombre + descripción (para pegar) + sesiones
// (nombre · bloques · target · ejecución). + específicos por distancia + nomenclatura + 45/15 + fuentes.
// Uso: node generator/nor-catalogo-html.js  → report/nor-catalogo-v2.html
const fs = require("fs"), path = require("path");
const D = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "noruego-catalogo-sesiones.json"), "utf8"));
const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// color de acento por zona (sobrio, borde izquierdo)
const ZC = { "Z1": "#6aa0e0", "Z2": "#6aa0e0", "Z3": "#e0b64c", "Z4": "#e39a3b", "Z5": "#dd7a4a", "Z6": "#d9534f", "Z7": "#9b4bb0" };
const zoneOf = name => { const m = String(name).match(/Z(\d)/); return m ? "Z" + m[1] : "Z3"; };
const DESC = D.descripciones_libreria_por_zona || {};
// mapear clave de carpeta → bloque de descripción
const descKeyFor = folder => {
  if (/Long run/i.test(folder)) return DESC.Z1_Z2_LongRun;
  if (/Tempo/i.test(folder)) return DESC.Z3_Tempo;
  if (/Umbral/i.test(folder)) return DESC.Z4_Umbral;
  if (/Supraumbral/i.test(folder)) return DESC.Z5_Supraumbral;
  if (/VO2/i.test(folder)) return DESC.Z6_VO2max;
  if (/Glucol/i.test(folder)) return DESC.Z7_Glucolitico;
  return null;
};
function descBox(dsc, anclas) {
  if (!dsc && !anclas) return "";
  const rows = [];
  if (dsc) {
    if (dsc.para_que) rows.push(["Para qué", dsc.para_que]);
    if (dsc.dato_1) rows.push(["Dato #1 a mirar", dsc.dato_1]);
    if (dsc.rpe) rows.push(["RPE esperado", dsc.rpe]);
    if (dsc.sensaciones) rows.push(["Sensaciones", dsc.sensaciones]);
    if (dsc.fc) rows.push(["FC", dsc.fc]);
    if (dsc.decision) rows.push(["Decisión p/ próxima", dsc.decision]);
  }
  if (anclas) rows.push(["Anclas (lactato/FC/vVO2)", anclas]);
  return `<div class="desc"><div class="desch">Descripción para la carpeta ET <span class="copy">(pegar)</span></div>`
    + rows.map(([k, v]) => `<div class="dr"><span class="dk">${esc(k)}</span><span class="dv">${esc(v)}</span></div>`).join("") + `</div>`;
}
function sessList(sesiones) {
  return `<div class="slist">` + sesiones.map(s => {
    const z = zoneOf(s.nombre);
    const tgt = s.target ? ` <span class="tgt">${esc(s.target)}</span>` : "";
    const ej = s.ejec ? `<div class="sej">${esc(s.ejec)}</div>` : "";
    return `<div class="sess" style="border-left-color:${ZC[z] || "#9fb4c8"}">
      <div class="sn">${esc(s.nombre)}${tgt}</div>
      <div class="sb">${esc(s.bloques || "")}</div>${ej}</div>`;
  }).join("") + `</div>`;
}
function folderSection(folder, obj) {
  const z = zoneOf(folder.match(/Z\d/) ? folder : (obj.sesiones[0] && obj.sesiones[0].nombre) || "Z3");
  const acc = ZC[z] || "#6aa0e0";
  return `<section class="folder">
    <div class="fh" style="border-left-color:${acc}">
      <div class="fname">📁 ${esc(folder)}</div>
      ${obj.para_que ? `<div class="fpara">${esc(obj.para_que)}</div>` : ""}
    </div>
    ${descBox(descKeyFor(folder), obj.anclas)}
    ${sessList(obj.sesiones || [])}
  </section>`;
}
// --- Específicos por distancia ---
const EP = D.especificos_por_distancia || {};
function distSection() {
  const groups = [["5K", EP["5K_ritmo_carrera"]], ["10K", EP["10K_ritmo_carrera"]], ["HM (media)", EP["HM_ritmo_carrera"]], ["Maratón", EP["Maraton_ritmo_carrera"]]];
  const blocks = groups.filter(g => g[1] && g[1].length).map(([lbl, arr]) =>
    `<div class="dist"><div class="disth">${esc(lbl)} · a ritmo de carrera</div>`
    + `<div class="slist">` + arr.map(n => `<div class="sess" style="border-left-color:#6b8fb8"><div class="sn">${esc(n)}</div></div>`).join("") + `</div></div>`
  ).join("");
  const edesc = DESC.Especificos_distancia;
  return `<section class="folder">
    <div class="fh" style="border-left-color:#6b8fb8"><div class="fname">🏁 NOR - Específicos por distancia (período competitivo)</div>
    <div class="fpara">${esc(EP._que_son || "")}</div></div>
    <div class="note"><b>Mapeo de zona:</b> ${esc(EP._mapeo_zona || "")}</div>
    ${edesc ? descBox(edesc, null) : ""}
    ${blocks}
    <div class="note">${esc(EP.ejec_comun || "")}</div>
  </section>`;
}
// --- 45/15 intro + nomenclatura + fuentes ---
const I = D.intro_45_15 || {};
const notas = `<section class="folder">
  <div class="fh" style="border-left-color:#9fb4c8"><div class="fname">⚙ Notas de carga</div></div>
  <div class="note"><b>Nomenclatura:</b> ${esc(D.nomenclatura || "")}</div>
  <div class="note"><b>Intro gradual del 45/15 (Z5):</b> ${esc(I.regla || "")}<br>
    <b>1.</b> ${esc(I.paso_1 || "")}<br><b>2.</b> ${esc(I.paso_2 || "")}<br><b>3.</b> ${esc(I.paso_3 || "")}</div>
  ${D.config_ET ? `<div class="note"><b>Config ET:</b> ${esc(typeof D.config_ET === "string" ? D.config_ET : JSON.stringify(D.config_ET))}</div>` : ""}
  ${D.salvedad ? `<div class="note caveat"><b>Salvedad:</b> ${esc(D.salvedad)}</div>` : ""}
  ${D.fuentes ? `<div class="note src"><b>Fuentes:</b> ${esc(Array.isArray(D.fuentes) ? D.fuentes.join(" · ") : D.fuentes)}</div>` : ""}
</section>`;

const folders = Object.entries(D.carpetas_y_sesiones || {}).map(([k, v]) => folderSection(k, v)).join("\n");
const css = `
:root{--ink:#1b2733;--mut:#6b7682;--line:#e6ebf1;--bg:#fff}
*{box-sizing:border-box}body{margin:0;background:#f4f6f9;color:var(--ink);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.wrap{max-width:900px;margin:0 auto;padding:22px 16px 60px}
h1{font-size:21px;margin:0 0 2px}.sub{color:var(--mut);font-size:13px;margin-bottom:18px}
.folder{background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin-bottom:16px}
.fh{border-left:4px solid #6aa0e0;padding-left:11px;margin-bottom:10px}
.fname{font-size:16px;font-weight:800;color:#13202e}
.fpara{color:var(--mut);font-size:12.5px;margin-top:3px}
.desc{background:#f7f9fb;border:1px solid #e9eef4;border-radius:8px;padding:9px 11px;margin:8px 0 12px}
.desch{font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;color:#7a8795;margin-bottom:5px}
.desch .copy{color:#3f6fd1;font-weight:700}
.dr{display:flex;gap:8px;font-size:12.5px;padding:2px 0;border-top:1px solid #eef2f6}.dr:first-of-type{border-top:0}
.dk{min-width:140px;font-weight:700;color:#48535f}.dv{color:#2a3542;flex:1}
.slist{display:flex;flex-direction:column;gap:7px}
.sess{border:1px solid #edf0f4;border-left:3px solid #9fb4c8;border-radius:7px;padding:7px 11px;background:#fff}
.sn{font-weight:700;color:#13202e;font-size:13.5px}
.sn .tgt{display:inline-block;margin-left:6px;background:#eef4ff;color:#2d5bb0;border-radius:4px;padding:0 6px;font-size:11px;font-weight:700}
.sb{color:#3a4654;font-size:12.5px;margin-top:2px}
.sej{color:var(--mut);font-size:11.5px;font-style:italic;margin-top:2px}
.dist{margin-top:10px}.disth{font-size:12.5px;font-weight:800;color:#2d5bb0;margin-bottom:5px}
.note{background:#fbfcfe;border:1px solid #eef2f6;border-radius:7px;padding:8px 11px;margin-top:8px;font-size:12.5px;color:#39434e}
.note.caveat{background:#fff8ec;border-color:#f0dcb8;color:#6a5118}
.note.src{color:var(--mut);font-size:11.5px}
@media print{body{background:#fff}.folder{break-inside:avoid}}
`;
const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Librería Noruega — ET</title><style>${css}</style></head>
<body><div class="wrap">
<h1>Librería de sesiones — Sistema Noruego (running)</h1>
<div class="sub">${esc(D.titulo || "")}${D.version ? " · " + esc(D.version) : ""} · para cargar en la librería de Endurance Tool. Cada carpeta: nombre + descripción (pegar en ET) + sesiones (nombre · bloques · target de lactato). Configurar los bloques POR ZONA (ET calcula el ritmo).</div>
${folders}
${distSection()}
${notas}
</div></body></html>`;
const out = path.join(__dirname, "..", "report", "nor-catalogo-v2.html");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log("OK ->", out, "|", html.length, "bytes");
