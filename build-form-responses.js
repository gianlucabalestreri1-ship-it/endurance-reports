#!/usr/bin/env node
// Reconstruye report/form-responses.json desde el CSV de respuestas del Formulario de renovación
// (Google Sheet 1TYqDW6rM0BP8a_YnHhdf5o61M5FLYNhZphy5wEW_LIg). Se corre ANTES de renewal-html.js
// en CADA informe de renovación, para validar si hubo respuestas nuevas (instrucción del coach 2026-11-23).
//
// Uso: node build-form-responses.js <csv_path> [dias_ventana=45]
//   1) Bajar el CSV con el connector de Drive (download_file_content, exportMimeType text/csv).
//   2) node build-form-responses.js <ese_csv>
//   3) node renewal-html.js "<etiqueta>"
//
// ALIASES: apodos con los que el atleta llena el form y que el matcher por tokens de renewal-html
// (≥2 tokens, prefijos) no resuelve solo. Clave = nombre normalizado DEL FORM → valor = nombre real.
// Agregar acá cada apodo nuevo que detectemos (el nombre real debe matchear el de ET).
const ALIASES = {
  "ely reba": "Eliana Rebagliatti"
};

const fs = require("fs");
const csvPath = process.argv[2];
const WINDOW_DAYS = Number(process.argv[3] || 14);
if (!csvPath) { console.error("Uso: node build-form-responses.js <csv_path> [dias_ventana=45]"); process.exit(1); }
const outPath = __dirname + "/report/form-responses.json";
const raw = fs.readFileSync(csvPath, "utf8");

function parseCSV(s) { // RFC4180 mínimo (comillas, comas, saltos de línea)
  const rows = []; let row = [], field = "", i = 0, inQ = false;
  while (i < s.length) { const c = s[i];
    if (inQ) { if (c === '"') { if (s[i + 1] === '"') { field += '"'; i += 2; continue; } inQ = false; i++; continue; } field += c; i++; continue; }
    if (c === '"') { inQ = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

const LABELS = { 2: "Cambios", 3: "Carreras", 4: "Molestia", 5: "Peso", 6: "Int/Vol propuesto",
  7: "Int/Vol específico", 8: "Recup. pre-sesión", 9: "Sueño", 10: "Estrés", 11: "Energía", 12: "Motivación", 13: "Nota" };

function parseDate(ts) { // DD/MM/YYYY HH:MM:SS
  const m = String(ts).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const [, d, mo, y, h = "0", mi = "0", se = "0"] = m;
  return { iso: `${y}-${String(+mo).padStart(2, "0")}-${String(+d).padStart(2, "0")}`, t: new Date(+y, +mo - 1, +d, +h, +mi, +se).getTime() };
}

const rows = parseCSV(raw); rows.shift();
const CUTOFF = Date.now() - WINDOW_DAYS * 86400000;
const byName = {}; let total = 0;
for (const r of rows) {
  if (!r || r.length < 15) continue;
  let name = (r[1] || "").trim(); if (!name) continue;
  const dp = parseDate(r[0]); if (!dp) continue;
  total++;
  if (dp.t < CUTOFF) continue;
  const alias = ALIASES[norm(name)]; if (alias) name = alias; // canonicalizar apodo
  const key = norm(name); if (!key) continue;
  if (byName[key] && byName[key]._t >= dp.t) continue; // última respuesta gana
  const qa = [];
  for (const [idx, lab] of Object.entries(LABELS)) { const v = (r[idx] || "").trim(); if (v) qa.push([lab, v]); }
  byName[key] = { name, date: dp.iso, email: (r[14] || "").trim(), qa, _t: dp.t };
}
const out = {};
for (const k of Object.keys(byName).sort((a, b) => byName[b]._t - byName[a]._t)) { const o = byName[k]; delete o._t; out[k] = o; }
fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log(`form-responses.json: ${Object.keys(out).length} respuestas en los últimos ${WINDOW_DAYS} días (de ${total} filas).`);
