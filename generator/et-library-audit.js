#!/usr/bin/env node
// Audita la LIBRERÍA (bookshop) de la cuenta de CORREDORES (ET_EMAIL/ET_PASSWORD).
// Lista todas las carpetas (SESION/MICRO/MESO/PLAN/CONTROL) con sus ítems, marca vacías,
// duplicados de nombre (dentro de carpeta), ítems sin descripción, ítems SUELTOS (sin carpeta)
// y grupos de carpetas fragmentados/solapados. Solo LECTURA.
// Uso: node generator/et-library-audit.js  → report/et-library-inventory.json + report/Libreria-ET-inventario.html
const ET = require("../lib/endurance.js");
const fs = require("fs"), path = require("path");
const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

(async () => {
  const { session } = await ET.login(process.env.ET_EMAIL, process.env.ET_PASSWORD);
  const fr = await ET.call("folder_bookshops_list", {}, session);
  const br = await ET.call("bookshops_list", {}, session);
  const folders = Object.keys(fr).filter(k => /^\d+$/.test(k)).map(k => fr[k]);
  const items = br.bookshops || [];
  const fids = new Set(folders.map(f => f.id));
  const byF = {}; for (const it of items) (byF[it.folder_id] = byF[it.folder_id] || []).push(it);

  const F = folders.map(f => {
    const its = byF[f.id] || [];
    const dup = {}; its.forEach(i => dup[i.name] = (dup[i.name] || 0) + 1);
    return {
      folder_id: f.id, name: f.name, type: f.folder_type,
      is_IEG: f.folder_owner === "IEG" || f.owner === "IEG",
      count: its.length,
      noDescr: its.filter(i => !(i.description || "").trim()).length,
      items: its.map(i => ({ name: i.name, descr: (i.description || "").trim().length })),
      dupNames: Object.entries(dup).filter(([, c]) => c > 1).map(([n, c]) => n + " ×" + c),
    };
  });
  const loose = items.filter(i => !fids.has(i.folder_id))
    .map(i => ({ name: i.name, type: i.object_type }));
  // grupos de nombre similar (cross-type)
  const simMap = {}; F.forEach(f => (simMap[norm(f.name)] = simMap[norm(f.name)] || []).push(f));
  const inv = { generated: new Date().toISOString(), folders: F, loose };
  fs.mkdirSync("report", { recursive: true });
  fs.writeFileSync("report/et-library-inventory.json", JSON.stringify(inv, null, 2));

  // ----- HTML -----
  const TYPES = [["SESION", "Sesiones"], ["MICRO", "Microciclos"], ["MESO", "Mesociclos"], ["PLAN", "Planes"], ["CONTROL", "Controles/Tests"]];
  const empties = F.filter(f => f.count === 0);
  const inDup = F.filter(f => f.dupNames.length);
  const looseByType = {}; loose.forEach(i => (looseByType[i.type] = looseByType[i.type] || []).push(i.name));

  const folderCard = f => {
    const tag = f.is_IEG ? `<span class="own ieg">IEG</span>` : `<span class="own">Personal</span>`;
    const flags = [];
    if (f.count === 0) flags.push(`<span class="fl warn">VACÍA</span>`);
    if (f.dupNames.length) flags.push(`<span class="fl warn">nombre duplicado</span>`);
    if (f.count && f.noDescr === f.count) flags.push(`<span class="fl soft">sin descripciones</span>`);
    else if (f.noDescr) flags.push(`<span class="fl soft">${f.noDescr}/${f.count} sin descr</span>`);
    const its = f.items.map(i => `<li>${esc(i.name)}${i.descr === 0 ? ` <span class="nd">· sin descr</span>` : ""}</li>`).join("");
    return `<div class="fc${f.count === 0 ? " empty" : ""}">
      <div class="fct">${tag} <b>${esc(f.name)}</b> <span class="cnt">${f.count} ít.</span> ${flags.join(" ")}</div>
      ${its ? `<ul>${its}</ul>` : `<div class="noit">—</div>`}</div>`;
  };
  const section = ([t, lbl]) => {
    const g = F.filter(f => f.type === t).sort((a, b) => a.name.localeCompare(b.name));
    if (!g.length) return "";
    return `<h2>${esc(lbl)} <span class="h2c">${g.length} carpetas</span></h2>` + g.map(folderCard).join("");
  };
  const looseBox = Object.keys(looseByType).length ? `<div class="box warn"><div class="boxh">Ítems SUELTOS (sin carpeta) — ${loose.length}</div>`
    + Object.entries(looseByType).map(([t, ns]) => `<div class="lg"><b>${esc(t)}</b>: ${ns.map(esc).join(" · ")}</div>`).join("") + `</div>` : "";
  const cleanBox = `<div class="box warn"><div class="boxh">Para limpiar / corregir</div>
    <div class="lg"><b>Vacías:</b> ${empties.length ? empties.map(f => esc(f.type + " · " + f.name) + (f.is_IEG ? " (IEG)" : "")).join(" · ") : "ninguna"}</div>
    <div class="lg"><b>Nombres duplicados dentro de carpeta:</b> ${inDup.length ? inDup.map(f => esc(f.name) + " → " + esc(f.dupNames.join(", "))).join(" | ") : "ninguno"}</div>
    </div>`;

  const css = `:root{--ink:#1b2733;--mut:#6b7682;--line:#e6ebf1}*{box-sizing:border-box}
  body{margin:0;background:#f4f6f9;color:var(--ink);font:13.5px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}
  .wrap{max-width:940px;margin:0 auto;padding:20px 16px 60px}h1{font-size:20px;margin:0 0 2px}.sub{color:var(--mut);font-size:12.5px;margin-bottom:16px}
  h2{font-size:15px;margin:22px 0 8px;border-bottom:2px solid #e0e6ee;padding-bottom:4px}.h2c{color:var(--mut);font-weight:600;font-size:12px}
  .fc{background:#fff;border:1px solid var(--line);border-radius:8px;padding:9px 12px;margin-bottom:8px}.fc.empty{background:#fdf3f2;border-color:#f1c9c3}
  .fct{font-size:13.5px}.fct b{color:#13202e}.cnt{color:var(--mut);font-size:11.5px}
  .own{display:inline-block;background:#eef2f7;color:#5a6673;border-radius:4px;padding:0 6px;font-size:10px;font-weight:700}.own.ieg{background:#f0eafa;color:#6b5cab}
  .fl{display:inline-block;border-radius:4px;padding:0 6px;font-size:10px;font-weight:700;margin-left:3px}.fl.warn{background:#fde3df;color:#b23121}.fl.soft{background:#fff5e6;color:#9a6512}
  ul{margin:6px 0 0;padding-left:20px;columns:2;column-gap:22px}li{font-size:12px;color:#39434e;margin:1px 0;break-inside:avoid}
  .nd{color:#b0b9c2;font-size:10.5px}.noit{color:#b23121;font-size:12px;margin-top:3px}
  .box{border-radius:8px;padding:10px 13px;margin-bottom:12px}.box.warn{background:#fff8ec;border:1px solid #f0dcb8}
  .boxh{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;color:#9a5a12;margin-bottom:5px}
  .lg{font-size:12px;color:#5a4a2a;margin:3px 0}@media(max-width:620px){ul{columns:1}}`;
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Inventario librería ET</title><style>${css}</style></head><body><div class="wrap">
  <h1>Inventario de la librería — GB Running Team</h1>
  <div class="sub">${F.length} carpetas con nombre + ${loose.length} ítems sueltos · ${items.length} ítems en total · solo cuenta de corredores · ${new Date().toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}</div>
  ${cleanBox}${looseBox}
  ${TYPES.map(section).join("")}
  </div></body></html>`;
  fs.writeFileSync("report/Libreria-ET-inventario.html", html);
  console.log("OK -> report/Libreria-ET-inventario.html | carpetas", F.length, "| sueltos", loose.length, "| vacías", empties.length);
})();
