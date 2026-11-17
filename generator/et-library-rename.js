#!/usr/bin/env node
// Worklist de RENOMBRADO de la librería (cuenta corredores) bajo el patrón acordado.
// Lee report/et-library-inventory.json (foto) y propone: acción estructural + nombre nuevo
// + descripción por carpeta + nombre propuesto por sesión. EO exacto (del Excel del coach),
// JD (Daniels) / PF (Pfitzinger) aplicados, Noruegas→catálogo NOR, Progresivos unificados.
// Solo genera el PLAN; el coach lo aplica en ET (la librería no se edita por API).
// Uso: node generator/et-library-rename.js  → report/Libreria-ET-renombrado.html
const fs = require("fs");
const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const X = s => String(s).replace(/(\d)\s*x\s*(\d)/gi, "$1×$2");
const inv = JSON.parse(fs.readFileSync("report/et-library-inventory.json", "utf8"));

// ---- EO: dosis exactas por zona (del Excel Progresiones_por_Zona, pestañas Carrera) ----
const EO = {
  Z3: ["10×400m @70% / r1'", "10×600m @70% / r1'", "8×1K @70% / r1'", "7×1,2K @75% / r1'", "6×1,5K @75% / r2'", "5×2K @75% / r2'", "5×2,5K @75% / r3'", "4×3K @78% / r3'", "4×3,5K @78% / r3'", "15K continuo @78%"],
  Z4: ["10×400m @80% / r2'", "10×600m @80% / r2'", "8×1K @80% / r2'", "7×1,2K @80% / r2'", "6×1,5K @85% / r2'", "5×1,8K @85% / r2'", "5×2K @85% / r2'", "4×2,5K @85% / r2'", "4×3K @85% / r2'", "10K continuo @85%"],
  Z5: ["5×600m @85% / r1'30\"", "4×800m @85% / r1'30\"", "5×800m @90% / r1'30\"", "6×800m @90% / r1'30\"", "5×1K @95% / r2'", "5×1,2K @93% / r2'", "5×1,5K @90% / r3'", "5×2K @90% / r3'", "6×2K @90% / r3'", "6×2,5K @90% / r3'"],
  Z6: ["6×400m @95% / r1'30\"", "8×400m @100% / r1'30\"", "10×400m @105% / r1'30\"", "7×600m @100% / r2'", "8×600m @100% / r2'", "9×600m @100% / r3'", "7×800m @95% / r3'", "8×800m @95% / r3'", "5×1K @95% / r3'", "6×1K @95% / r3'"],
};
const eoName = (zone, tipo, name) => {
  const m = String(name).match(/prog\s*(\d+)/i); if (!m) return null;
  const i = +m[1]; const dose = (EO[zone] || [])[i - 1]; if (!dose) return null;
  return `EO ${zone} ${tipo} · P${String(i).padStart(2, "0")} ${dose}`;
};
// Daniels: "Interval progr N - 4x800 (Z5)" / "5x1k (Z5)" -> "JD Z5 Interval · 4×800 [banda]"
const jd = band => name => {
  if (/^HIIT/i.test(name)) return { p: `JD Z5 Interval · ${X(name.replace(/\s*\(Z5\)/, ""))} [${band}]`, warn: true };
  const dose = (name.match(/-\s*(.+?)\s*\(Z5\)/i) || [, X(name)])[1];
  return { p: `JD Z5 Interval · ${X(dose)} [${band}]` };
};
// Pfitzinger: decodificar M=maratón(Z3) · T=threshold(Z4) · P1/P2=pausa
const pf = band => name => {
  const n = X(name).replace(/\bP1\b/g, "/ P1").replace(/\bP2\b/g, "/ P2")
    .replace(/(\d+)\s*M\b/g, "$1'@M").replace(/(\d+)\s*T\b/g, "$1'@T");
  const z = /@T/.test(n) && !/@M/.test(n) ? "Z4" : /@M/.test(n) && !/@T/.test(n) ? "Z3" : "Z3-Z4";
  return { p: `PF ${z} Umbral · ${n} [${band}]`, warn: /prog|\//.test(name) && !/@/.test(n) };
};

// ---- CATÁLOGO por carpeta (clave = nombre actual) ----
// nn:nombre nuevo · ds:descripción (1 línea) · act:acción estructural · ieg:true (no editable) · fn:transform sesión
const C = {
  // SESIONES
  "Cambios de ritmo": { nn: "Z3 Cambios de ritmo", ds: "Cambios de ritmo / fartlek estructurado (propio)." },
  "Cuestas": { nn: "Z7 Cuestas", ds: "Cuestas (fuerza/economía y velocidad)." },
  "Easy + strides": { nn: "Z2 Easy + Strides", ds: "Rodaje fácil + rectas/strides de economía." },
  "Entrenamiento progresivo": { nn: "Progresivos", ds: "Rodajes en progresión (propio). UNIFICAR aquí las 3 carpetas de progresivos.", act: "unify-into" },
  "PROGRESIVOS": { nn: "→ Progresivos", ds: "Mover su contenido a «Progresivos» y BORRAR esta carpeta.", act: "merge-delete" },
  "Rodaje progresivo": { nn: "→ Progresivos", ds: "Mover su contenido a «Progresivos» y BORRAR esta carpeta.", act: "merge-delete" },
  "Fuerza": { nn: "Fuerza", ds: "Fuerza (no cuenta para adherencia)." },
  "HIIT Corto": { nn: "Z6-Z7 HIIT Corto", ds: "Intervalos cortos VO2/neuromuscular." },
  "HIIT's Largos": { nn: "Z5-Z6 HIIT Largo", ds: "Intervalos largos VO2/supra." },
  "Intensidad variable": { nn: "Z4-Z5 Intensidad variable", ds: "Mixtos umbral+supra en una sesión." },
  "Interval progresion - Corredores <48k": { nn: "JD Interval <48K", ds: "Jack Daniels — I-pace (Z5), escalado por volumen <48K/sem.", fn: jd("<48K") },
  "Interval progresion - Corredores 48k - 64k": { nn: "JD Interval 48-64K", ds: "Jack Daniels — I-pace (Z5), 48-64K/sem.", fn: jd("48-64K") },
  "Interval progresion - Corredores 64k - 72k": { nn: "JD Interval 64-72K", ds: "Jack Daniels — I-pace (Z5), 64-72K/sem.", fn: jd("64-72K") },
  "Interval progresion - Corredores 74k - 88k": { nn: "JD Interval 74-88K", ds: "Jack Daniels — I-pace (Z5), 74-88K/sem.", fn: jd("74-88K") },
  "Modelación 10K": { nn: "Específico 10K (modelación)", ds: "Sesiones a ritmo de 10K (Z4)." },
  "Neuromuscular - reps 10\"": { nn: "Z7 Neuromuscular 10\"", ds: "Rodaje + reps neuromusculares de 10\"." },
  "Neuromuscular 20\"-30\"": { nn: "Z7 Neuromuscular 20-30\"", ds: "Rodaje + reps neuromusculares 20-30\"." },
  "Ondulado": { nn: "Ondulado", ds: "Trabajo ondulado / cross (se mantiene aparte)." },
  "Plan: Caminar - Correr / Inicio de este camino!": { nn: "CaCo Caminar-Correr · Sesiones", ds: "Sesiones del plan vigente Caminar-Correr (iniciantes)." },
  "Sesiones de entrenamiento - Noruegas": { nn: "NOR (reemplazar por catálogo v2)", ds: "Colapsar las 16 Z1 + Z3 y cargar el catálogo NOR nuevo (NOR Z1/Z2/Z3/Z4/Z5/Z6/Z7).", act: "replace-nor" },
  "Tempo": { nn: "Z3 Tempo (EO)", ds: "Tempo/Z3. Serie EO = progresión Entrenamiento Óptimo (P01→P10).", fn: n => { const e = eoName("Z3", "Tempo", n); return e ? { p: e } : null; } },
  "Test en Campo": { nn: "Test en Campo", ds: "IEG — no editable.", ieg: true },
  "Test's": { nn: "Tests", ds: "Tests de campo (5', milla, VAM, 5K, Montreal…)." },
  "Trail": { nn: "Trail", ds: "Sesiones de trail/cuestas largas." },
  "Trote y caminata": { nn: "CaCo Trote-caminata · Sesiones (genéricas)", ds: "Sesiones sueltas de trote/caminata (revisar solape con Caminar-Correr).", act: "review" },
  "Umbral corredores <64K": { nn: "PF Umbral <64K", ds: "Pfitzinger — LT. Códigos: M=ritmo maratón (Z3) · T=threshold (Z4) · P1/P2=pausa.", fn: pf("<64K") },
  "Umbral progresion - Corredores 63K - 113K": { nn: "PF Umbral 63-113K", ds: "Pfitzinger — LT, 63-113K/sem. M=maratón · T=threshold · P=pausa.", fn: pf("63-113K") },
  "Z5 Supraumbral": { nn: "Z5 Supraumbral (EO)", ds: "Supraumbral/Z5. Serie EO P01→P10.", fn: n => { const e = eoName("Z5", "Supra", n); return e ? { p: e } : null; } },
  "Z6 VO2max": { nn: "Z6 VO2max (EO)", ds: "VO2máx/Z6. Serie EO P01→P10.", fn: n => { const e = eoName("Z6", "VO2max", n); return e ? { p: e } : null; } },
  "Zona 2 - Endurance": { nn: "Z2 Endurance", ds: "Base aeróbica Z2 (fácil/fondo/recuperación)." },
  "Zona 4 - Umbral": { nn: "Z4 Umbral (EO)", ds: "Umbral/Z4. Serie EO P01→P10.", fn: n => { const e = eoName("Z4", "Umbral", n); return e ? { p: e } : null; } },
  // IEG sesiones (no editables)
  "Ciclismo": { nn: "Ciclismo", ds: "IEG — ciclismo, no editable (ignorar en cuenta de corredores).", ieg: true },
  "Natación": { nn: "Natación", ds: "IEG — no editable.", ieg: true },
  "Running": { nn: "Running", ds: "IEG — no editable.", ieg: true },
  "Entrenamiento de la Fuerza": { nn: "Entrenamiento de la Fuerza", ds: "IEG — no editable.", ieg: true },
  // MESO / MICRO / PLAN
  "10K - 16 semanas (30-48k / 4 veces por semana)": { nn: "10K 30-48K · Mesos (JD/base-esp-comp)", ds: "Mesos del plan 10K (30-48K, 4 días)." },
  "42K": { nn: "Maratón 42K · Mesos", ds: "Mesociclos de maratón." },
  "Base": { nn: "Base · Mesos", ds: "Mesociclos de base (varios niveles). Revisar solape con «Plan base training 30-48K».", act: "review" },
  "BASE": { nn: "Base · Micros", ds: "Microciclos de base. Revisar duplicado con «Base training 30 a 48K».", act: "review" },
  "Base training 30 a 48K": { nn: "Base 30-48K · Micros", ds: "Micros de base 30-48K. Posible duplicado con «Plan base training 30-48K».", act: "review-dup" },
  "Fitness general combinado.": { nn: "Fitness general · Mesos", ds: "Meso fitness general (run + fuerza)." },
  "Plan base training - 30 a 48K": { nn: "Base 30-48K · Mesos", ds: "Mesos de base 30-48K. Posible duplicado con «Base training 30 a 48K».", act: "review-dup" },
  "Plan consolidando al corredor (completo)": { nn: "Consolidando al corredor · Mesos (1-8)", ds: "Mesos 1 a 8 del plan Consolidando. MOVER aquí el Meso 6 desde «Plan: Consolidando al corredor» antes de borrar esa.", act: "keep-merge" },
  "Plan fitness general avanzado (50-80K/sem)": { nn: "Fitness general avanzado 50-80K · Mesos", ds: "Mesos del plan fitness avanzado." },
  "Plan: Caminar - Correr / Inicio de este camino!": { nn: "CaCo Caminar-Correr · Mesos (MES 1-4)", ds: "Mesos del plan vigente Caminar-Correr." },
  "Plan: Consolidando al corredor": { nn: "✗ BORRAR (mover Meso 6 primero)", ds: "Fragmento viejo: Meso 1 y 2 ya están en la completa; mover el Meso 6 a «Consolidando · Mesos (1-8)» y BORRAR esta carpeta.", act: "delete" },
  "Preparación 10K - 48/67K por semana": { nn: "10K 48-67K · Mesos", ds: "Mesos del plan 10K 48-67K (base/específico/taper). OK el solape plan↔meso: guardás el meso suelto a propósito." },
  "Trote/caminata": { nn: "✗ DEPRECAR (El comienzo/primeras zancadas)", ds: "Plan viejo reemplazado por Caminar-Correr. Archivar o borrar.", act: "deprecate" },
  "Umbral - Progresivo": { nn: "Umbral progresivo 30K · Meso", ds: "Meso de umbral progresivo (30K/sem)." },
  "Trote / caminata": { nn: "✗ DEPRECAR (El comienzo · Micro MES O1)", ds: "Micro del plan viejo (primeras zancadas). Archivar o borrar.", act: "deprecate" },
  "10K Preparación": { nn: "10K · Planes", ds: "Planes de 10K (recreacional / 3 mesos)." },
  "CICLISMO": { nn: "CICLISMO", ds: "IEG — vacía, no editable.", ieg: true },
  "Consolidando al corredor": { nn: "Consolidando al corredor · PLAN", ds: "El plan completo Consolidando (se asigna entero)." },
};

// ---- render ----
const TYPES = [["SESION", "Sesiones"], ["MICRO", "Microciclos"], ["MESO", "Mesociclos"], ["PLAN", "Planes"], ["CONTROL", "Controles"]];
const actTag = a => a ? `<span class="act ${/(delete|deprecate)/.test(a) ? "del" : /review|dup/.test(a) ? "rev" : "mv"}">${{ "unify-into": "UNIFICAR", "merge-delete": "MOVER+BORRAR", "replace-nor": "REEMPLAZAR", "review": "REVISAR", "review-dup": "¿DUPLICADO?", "keep-merge": "RECIBE MESO 6", "delete": "BORRAR", "deprecate": "DEPRECAR" }[a] || a.toUpperCase()}</span>` : "";
function folderCard(f) {
  const c = C[f.name] || { nn: "", ds: "" };
  const ieg = f.is_IEG || c.ieg;
  const rows = f.items.map(i => {
    let p = "", warn = false;
    if (!ieg && c.fn) { const r = c.fn(i.name); if (r) { p = r.p; warn = r.warn; } }
    if (!p && !ieg) p = X(c.nn && /^Z\d/.test(c.nn) ? c.nn.replace(/\s*\(.*/, "") + " · " + i.name : i.name);
    const same = !p || p === i.name;
    return `<tr><td class="cur">${esc(i.name)}</td><td class="arr">→</td><td class="prop${warn ? " warn" : ""}${same ? " same" : ""}">${ieg ? "<i>IEG — no editable</i>" : esc(p)}${warn ? ' <span class="wf">⚠ revisar</span>' : ""}</td></tr>`;
  }).join("");
  return `<div class="fc">
    <div class="fh">${ieg ? '<span class="own ieg">IEG</span> ' : ""}<b>${esc(f.name)}</b> ${c.nn && !ieg ? `<span class="arrbig">→</span> <b class="newn">${esc(c.nn)}</b>` : ""} ${actTag(c.act)}</div>
    ${c.ds ? `<div class="ds">${esc(c.ds)}</div>` : ""}
    ${f.items.length ? `<table class="rt"><tbody>${rows}</tbody></table>` : `<div class="noit">(vacía)</div>`}
  </div>`;
}
const section = ([t, lbl]) => {
  const g = inv.folders.filter(f => f.type === t).sort((a, b) => a.name.localeCompare(b.name));
  return g.length ? `<h2>${lbl} <span class="h2c">${g.length}</span></h2>` + g.map(folderCard).join("") : "";
};
const actionsBox = `<div class="box"><div class="boxh">Acciones estructurales (hacer primero)</div>
<ol>
<li><b>Consolidando al corredor:</b> mover el <b>Meso 6</b> de «Plan: Consolidando al corredor» a «Consolidando · Mesos (1-8)» y <b>borrar</b> la carpeta vieja (los Meso 1 y 2 ya están duplicados en la completa).</li>
<li><b>Progresivos:</b> unificar «Entrenamiento progresivo» + «PROGRESIVOS» + «Rodaje progresivo» en una sola «Progresivos»; borrar las otras dos.</li>
<li><b>Noruegas:</b> reemplazar «Sesiones de entrenamiento - Noruegas» (16×Z1 + Z3) por el catálogo NOR v2.</li>
<li><b>CaCo viejo:</b> deprecar/borrar «Trote/caminata» (meso) y «Trote / caminata» (micro) = plan «El comienzo / primeras zancadas», reemplazado por Caminar-Correr.</li>
<li><b>Base:</b> revisar si «Base training 30 a 48K» (micro) y «Plan base training - 30 a 48K» (meso) son el mismo plan (posible duplicado).</li>
<li><b>27 ítems sueltos:</b> archivar en su carpeta o borrar (dejar «PLAN EN BLANCO PARA TRABAJAR»). Los de ciclismo no van en esta cuenta.</li>
<li><b>IEG vacías</b> (CICLISMO plan, Test control): del sistema, no editables — ignorar.</li>
</ol></div>`;
const css = `:root{--ink:#1b2733;--mut:#6b7682;--line:#e6ebf1}*{box-sizing:border-box}
body{margin:0;background:#f4f6f9;color:var(--ink);font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}
.wrap{max-width:1000px;margin:0 auto;padding:20px 16px 60px}h1{font-size:20px;margin:0 0 2px}.sub{color:var(--mut);font-size:12.5px;margin-bottom:14px}
h2{font-size:15px;margin:22px 0 8px;border-bottom:2px solid #e0e6ee;padding-bottom:4px}.h2c{color:var(--mut);font-size:12px}
.box{background:#fff8ec;border:1px solid #f0dcb8;border-radius:8px;padding:10px 14px;margin-bottom:14px}
.boxh{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;color:#9a5a12;margin-bottom:5px}
.box ol{margin:4px 0 0;padding-left:20px}.box li{font-size:12.5px;color:#5a4a2a;margin:3px 0}
.fc{background:#fff;border:1px solid var(--line);border-radius:8px;padding:9px 12px;margin-bottom:8px}
.fh{font-size:14px}.fh b{color:#13202e}.newn{color:#1a6a3c}.arrbig{color:#9aa6b2}
.own.ieg{background:#f0eafa;color:#6b5cab;border-radius:4px;padding:0 6px;font-size:10px;font-weight:700}
.act{display:inline-block;border-radius:4px;padding:0 6px;font-size:10px;font-weight:800;margin-left:4px}
.act.del{background:#fde3df;color:#b23121}.act.rev{background:#fff5e6;color:#9a6512}.act.mv{background:#e7f0ff;color:#2d5bb0}
.ds{color:var(--mut);font-size:11.5px;margin:3px 0 5px}
.rt{width:100%;border-collapse:collapse}.rt td{padding:2px 6px;border-bottom:1px solid #f1f4f8;font-size:12px;vertical-align:top}
.cur{color:#6b7682;width:42%}.arr{color:#c2cad3;width:16px;text-align:center}.prop{color:#13202e;font-weight:600}
.prop.same{color:#9aa6b2;font-weight:400}.prop.warn{color:#9a6512}.wf{font-size:10px;font-weight:700;color:#b23121}
.noit{color:#b23121;font-size:12px}@media(max-width:620px){.cur{width:48%}}`;
const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Renombrado librería ET</title><style>${css}</style></head><body><div class="wrap">
<h1>Worklist de catalogación — librería GB Running Team</h1>
<div class="sub">Patrón: SESIÓN = <b>[PREFIJO] [Zx] [Tipo] · dosis</b> (NOR/JD/PF/EO) · CARPETA = [Zx] [Estímulo] (método) · MESO/MICRO/PLAN = [Objetivo nivel] · estructura. La librería se edita a mano en ET; esto es el plan.</div>
${actionsBox}
${TYPES.map(section).join("")}
</div></body></html>`;
fs.writeFileSync("report/Libreria-ET-renombrado.html", html);
console.log("OK -> report/Libreria-ET-renombrado.html |", html.length, "bytes");
