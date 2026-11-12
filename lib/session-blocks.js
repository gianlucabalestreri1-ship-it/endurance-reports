'use strict';
/*
 * Programmed-vs-executed block breakdown for one session (`session` API detail).
 *
 * Builds, in order, every programmed block (warm-up / work / pauses) with its
 * zone + target range + dose, and aligns the executed device laps to the
 * distance-bearing blocks by ACCUMULATED DISTANCE (devices here mostly auto-lap
 * per km, not per programmed rep, and the execution often diverges from the plan
 * — surfacing that mismatch is the point).
 *
 * Sport-aware: running shows PACE per lap, cycling shows POWER (W) per lap; both
 * show the block's average HR. Output feeds the single "Sesión" column so the
 * coach sees programmed→executed at a glance (the separate FIT column is dropped).
 */

const PAUSE_PACE_MIN = 8; // min/km above which a running lap is a recovery/walk, not work

function magKm(o) { return o && o.magnitude != null ? (o.unit === 'm' ? o.magnitude / 1000 : o.magnitude) : 0; }
function magMin(o) { return o && o.magnitude != null ? (o.unit === 'min' ? o.magnitude : o.magnitude / 60) : 0; }

// "7'10\" / km" -> "7:10"  (strip the /km; keep h for paused giant laps)
function pace(et) {
  if (!et) return '';
  const m = String(et).match(/(?:(\d+)h\s*)?(\d+)'(\d{2})/);
  if (!m) return String(et).replace(/\s*\/\s*km/i, '').trim();
  return (m[1] ? `${m[1]}h` : '') + `${m[2]}:${m[3]}`;
}
function paceMin(et) { // min/km as number, for the pause filter
  const m = String(et || '').match(/(?:(\d+)h\s*)?(\d+)'(\d{2})/);
  if (!m) return null;
  return (m[1] ? +m[1] * 60 : 0) + +m[2] + (+m[3]) / 60;
}
// value.format range "7'30\" / km - 6'26\" / km" -> "7:30–6:26"
function range(vf) {
  if (!vf) return '';
  const parts = String(vf).split(/\s*-\s*/).map((p) => pace(p)).filter(Boolean);
  return parts.length === 2 ? `${parts[0]}–${parts[1]}` : parts.join(' ');
}
function durFmt(o) {
  const min = magMin(o); if (!min) return '';
  const s = Math.round(min * 60), mm = Math.floor(s / 60), ss = s % 60;
  if (mm === 0) return `${ss}"`;
  return ss ? `${mm}'${String(ss).padStart(2, '0')}"` : `${mm}'`;
}
function distLabel(o) {
  const km = magKm(o); if (!km) return '';
  return km >= 1 ? `${(+km.toFixed(2)).toString().replace('.', ',')}K` : `${Math.round(km * 1000)}m`;
}
function zoneName(details) {
  const m = String(details || '').match(/\[Zona\s*\d+:\s*([^,\]]+)/i);
  return m ? m[1].trim() : '';
}
function isBikeSport(full) {
  const s = (full.sport && (full.sport.code + ' ' + full.sport.name)) || (full.resume && full.resume.sport_code) || '';
  return /cycl|bike|bici|mtb|ruta|rodill|ciclis|spinning/i.test(s);
}

// ---- programmed blocks (ordered) ------------------------------------------
function programmedBlocks(full) {
  const bike = isBikeSport(full);
  const blocks = [];
  for (const act of (full.activities || [])) {
    for (const sec of (act.sections || [])) {
      const w = sec.work || {};
      const reps = (sec.series || 1) * (sec.repetitions || 1);
      const repDist = magKm(w.distance);
      const byDur = sec.workout_measure === 'duration';   // rep medido por TIEMPO → la distancia es nominal de zona, no real
      const notes = w.notes || '';
      const vf = (w.value && w.value.format) || '';
      // Pausa ACTIVA vs PASIVA (regla del proyecto, igual que renovación): la pausa PASIVA no
      // informa ritmos; la ACTIVA sí (cuenta como un parcial). Señal CONFIABLE = el value.format
      // ("Pausa pasiva/activa") o el INICIO de la nota (no una mención suelta en medio del texto,
      // que rompería un bloque de trabajo que describe su propia recuperación). Puede NO ser text_only.
      const vfl = vf.trim().toLowerCase(), noteStart = (notes || '').trim().toLowerCase();
      const hasPausa = /^pausa/.test(vfl) || /^pausa/.test(noteStart);
      const activa = /^pausa\s*activa/.test(vfl) || /^pausa\s*activa/.test(noteStart);
      const pasiva = hasPausa && !activa;
      const isPause = pasiva;          // pasiva → NO ritmos
      const isActivePause = activa;    // activa → cuenta, informa ritmo (se trata como bloque de trabajo)
      const isWarm = sec.text_only && !hasPausa;     // mobility / drills
      const zone = w.zone_number;
      const doseLabel = byDur ? (durFmt(w.duration) || distLabel(w.distance)) : (distLabel(w.distance) || durFmt(w.duration));
      let label;
      if (isPause) label = /pasiva/i.test(vf + notes) ? 'Pausa pasiva' : 'Pausa';
      else if (isActivePause) label = `Pausa activa${doseLabel ? ' ' + doseLabel : ''}`;
      else if (isWarm) label = 'Entrada en calor';
      else if (reps > 1) label = `${reps}x${doseLabel}`;
      else label = doseLabel || (w.title || '');
      const mp = sec.micro_pause;
      const rec = mp ? { dur: durFmt(mp.duration), dist: magKm(mp.distance), zone: mp.zone_number } : null;
      // Distancia para alinear laps: solo bloques medidos por DISTANCIA (los por tiempo traen km nominal engañoso).
      const totalDist = (isPause || isWarm || byDur) ? 0 : reps * repDist + (rec && rec.dist ? reps * rec.dist : 0);
      blocks.push({
        label, zone: zone != null ? zone : null, zoneName: zoneName(w.details),
        range: bike ? (vf || '') : range(vf), reps, repDist,
        dur: durFmt(w.duration), isPause, isWarm, totalDist,
        rec: rec && rec.dur ? rec : null,
      });
    }
  }
  return { bike, sportName: (full.sport && full.sport.name) || '', blocks };
}

// ---- executed laps ---------------------------------------------------------
function execLaps(full) {
  const rz = full.resume; if (!rz) return [];
  return (rz.laps || []).map((l) => ({
    dist: +(l.total_distance || 0),
    pace: (l.avg_speed && l.avg_speed.format) || '',
    paceMin: paceMin(l.avg_speed && l.avg_speed.format),
    hr: l.avg_heart_rate || null,
    power: l.avg_power != null ? Math.round(l.avg_power) : null,
  })).filter((l) => l.dist > 0 || l.pace);
}

// Paces the athlete wrote by hand in the comment (no device): ORDERED, with
// repeats (each split = one value). Returns {paces:['7:28',...], clean:comment
// with the pace dump stripped so it isn't duplicated in the comment column}.
const _PACE_RE = /(\d{1,2})\s*[.:'’]\s*(\d{2})\s*(?:"|”|''|′′)?\s*(?:\/?\s*km|min\s*\/?\s*km|el\s*km|\/km)?/gi;
function commentPacesOrdered(txt) {
  if (!txt) return { paces: [], clean: '' };
  const paces = [], spans = [];
  let m; _PACE_RE.lastIndex = 0;
  while ((m = _PACE_RE.exec(txt)) !== null) {
    const mm = +m[1], ss = +m[2];
    if (ss >= 60) continue;
    const t = mm + ss / 60; if (t < 2.4 || t > 12) continue;   // ritmo plausible de running
    paces.push(`${mm}:${String(ss).padStart(2, '0')}`);
    spans.push([m.index, m.index + m[0].length]);
  }
  let clean = txt;
  for (let i = spans.length - 1; i >= 0; i--) clean = clean.slice(0, spans[i][0]) + ' ' + clean.slice(spans[i][1]);
  clean = clean
    .replace(/\b\d{1,2}\s*['’)]+\s*/g, ' ')                     // etiquetas huérfanas "10')" "1)"
    .replace(/\bte dejo( los)?\s+ritmos?\s*[:.]?/ig, ' ')       // "te dejo los ritmos:"
    .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ')
    .replace(/\s+([.,;])/g, '$1').replace(/\s{2,}/g, ' ').trim();
  return { paces, clean: clean || txt };
}
// Assign ordered comment paces to work blocks sequentially, by each block's rep count.
function assignCommentPaces(blocks, paces) {
  const work = blocks.filter((b) => !b.isPause && !b.isWarm);
  let idx = 0;
  for (const b of work) {
    const n = Math.max(1, b.reps || 1);
    b._cexec = paces.slice(idx, idx + n); idx += n;
  }
  if (idx < paces.length && work.length) {            // sobran ritmos → al último bloque
    const last = work[work.length - 1];
    last._cexec = (last._cexec || []).concat(paces.slice(idx));
  }
}

// Assign laps to distance-bearing blocks by accumulated distance (overlap).
function alignLaps(blocks, laps) {
  const segs = blocks.filter((b) => b.totalDist > 0);
  let cum = 0;
  for (const b of segs) { b._start = cum; b._end = cum + b.totalDist; cum += b.totalDist; b._laps = []; }
  let lcum = 0;
  for (const l of laps) {
    const center = lcum + l.dist / 2; lcum += l.dist;
    let best = null, bestOv = -1;
    for (const b of segs) {
      const ov = Math.min(b._end, lcum) - Math.max(b._start, lcum - l.dist);
      if (ov > bestOv || (best && Math.abs(center - (b._start + b._end) / 2) < Math.abs(center - (best._start + best._end) / 2) && ov === bestOv)) { bestOv = ov; best = b; }
    }
    if (best) best._laps.push(l);
  }
}

// Build the one-line-per-block strings. Returns { sport, bike, hasFit, lines:[{html,text}] }.
function sessionBreakdown(full) {
  const { bike, sportName, blocks } = programmedBlocks(full);
  const laps = execLaps(full);
  const hasFit = laps.length > 0;
  let fromComment = false, commentClean = null;
  if (hasFit) {
    alignLaps(blocks, laps);
  } else {                                  // sin dispositivo → ritmos escritos a mano en el comentario
    const { paces, clean } = commentPacesOrdered(full.athlete_comment || '');
    if (paces.length) { assignCommentPaces(blocks, paces); fromComment = true; commentClean = clean; }
  }

  const lines = [];
  blocks.forEach((b, i) => {
    const n = i + 1;
    const z = b.zone != null ? `Z${b.zone}` : '';
    if (b.isWarm) {
      lines.push({ text: `B${n}: ${b.label}${b.dur ? ' · ' + b.dur : ''}`, kind: 'warm' });
      return;
    }
    if (b.isPause) {
      lines.push({ text: `B${n}: ${b.label}${z ? ' (' + z + ')' : ''}${b.dur ? ' · ' + b.dur : ''}`, kind: 'pause' });
      return;
    }
    // work block
    const isPaceRange = /\d+:\d{2}/.test(b.range);               // real pace range vs RPE/W range
    const rangeSuffix = (isPaceRange && !bike) ? ' /km' : '';
    const head = `B${n}: ${b.label}${z ? ' – ' + z : ''}${b.range ? ' (' + b.range + rangeSuffix + ')' : ''}`;
    let exec = '';
    if (hasFit && b._laps) {                         // solo bloques medidos por DISTANCIA (alineados); los de tiempo → resumen al pie
      const used = b._laps.filter((l) => bike ? l.power != null : (l.paceMin == null || l.paceMin <= PAUSE_PACE_MIN));
      if (used.length) {
        const perKm = used.every((l) => Math.abs(l.dist - 1) < 0.2);
        const perRep = b.reps > 1 && b.repDist > 0 && used.every((l) => Math.abs(l.dist - b.repDist) < Math.max(0.1, b.repDist * 0.2));
        const unit = bike ? 'pot/lap' : (perRep ? 'por vuelta' : (perKm ? 'por km' : 'ejec'));
        const vals = used.map((l) => bike ? `${l.power}W` : pace(l.pace)).join(' ');
        const hrs = used.map((l) => l.hr).filter(Boolean);
        const hr = hrs.length ? Math.round(hrs.reduce((a, c) => a + c, 0) / hrs.length) : null;
        const lbl = unit === 'ejec' ? 'ejec' : `ejec ${unit}`;
        exec = ` · ${lbl}: ${vals}${hr ? ` (FC ${hr})` : ''}`;
      } else {
        exec = ` · ejec: — (no ejecutado)`;
      }
    } else if (!hasFit && (b._cexec || []).length) {   // ritmos del comentario, alineados por nº de reps
      const lbl = b.reps > 1 ? 'ejec por vuelta (coment.)' : 'ejec (coment.)';
      exec = ` · ${lbl}: ${b._cexec.join(' ')}`;
    }
    lines.push({ text: head + exec, kind: 'work', rec: b.rec });
    if (b.rec) lines.push({ text: `    rec: ${b.rec.dur || ''}${b.rec.zone != null ? ' Z' + b.rec.zone : ''} pasiva`, kind: 'rec' });
  });

  // Fallback: hay dispositivo pero ningún bloque medido por distancia captó laps
  // (sesión por tiempo, p.ej.) → una línea resumen con la secuencia ejecutada.
  const anyExec = lines.some((l) => l.kind === 'work' && / · ejec/.test(l.text) && !/no ejecutado/.test(l.text));
  if (hasFit && !anyExec && laps.length) {
    const used = laps.filter((l) => bike ? l.power != null : (l.paceMin == null || l.paceMin <= PAUSE_PACE_MIN));
    if (used.length) {
      const km = laps.reduce((a, l) => a + l.dist, 0);
      const vals = used.map((l) => bike ? `${l.power}W/${l.hr || '–'}` : pace(l.pace)).join(' ');
      const hrs = used.map((l) => l.hr).filter(Boolean);
      const hr = hrs.length ? Math.round(hrs.reduce((a, c) => a + c, 0) / hrs.length) : null;
      const head = bike ? 'ejec total (W/FC por lap)' : 'ejec total';
      const tail = bike ? '' : (hr ? ` (FC ${hr})` : '');
      lines.push({ text: `${head}: ${(+km.toFixed(2)).toString().replace('.', ',')}K · ${vals}${tail}`, kind: 'work' });
    }
  }

  return { sport: sportName, bike, hasFit, fromComment, commentClean, lines };
}

// ---- cross-day FITs: el atleta ejecutó la sesión otro día → ET no pegó el FIT ----
function d10(s) { return String(s || '').slice(0, 10); }
function dayDiff(a, b) { return Math.round((new Date(a) - new Date(b)) / 86400000); }
function realDevice(dev) {
  const n = ((dev && dev.device_name) || '').toLowerCase(), o = ((dev && dev.origin) || '').toLowerCase();
  if (/garmin|amazfit|coros|polar|suunto|apple ?watch|wahoo|fitbit|huawei|forerunner|fenix|instinct|venu|vivoactive|epix|enduro|galaxy watch/.test(n)) return true;
  return o === 'garmin';
}
function programmedKm(full) {
  let km = 0;
  for (const act of (full.activities || [])) for (const sec of (act.sections || [])) {
    if (sec.text_only) continue;
    const w = sec.work || {}; const reps = (sec.series || 1) * (sec.repetitions || 1);
    km += reps * magKm(w.distance);
  }
  if (!km) km = magKm(full.distance);
  return km;
}
// Busca en el micro un FIT real de dispositivo (otro día) que corresponda a esta sesión sin
// dispositivo. `ET` = cliente, `cache` = Map por micro_id, `usedFits` = Set global (no reusar).
// Devuelve {resume, execDate} o null.
async function crossDayLaps(ET, session, full, cache, usedFits) {
  const microId = full.micro && (full.micro.id || full.micro);
  if (!microId) return null;
  let gm = cache.get(microId);
  if (gm === undefined) { try { gm = await ET.getMicro(session, microId); } catch (_) { gm = null; } cache.set(microId, gm); }
  const micro = (gm && (gm.micro || gm)) || {};
  const fits = [];
  for (const slot of (micro.fits || [])) if (Array.isArray(slot)) for (const f of slot) if (f && f.id) {
    if (usedFits && usedFits.has(f.id)) continue;
    const dev = f.device_info || {};
    if (!realDevice(dev) || !/run|cycl|bike/i.test(f.sport_code || '')) continue;
    const km = parseFloat(dev.distance) || 0; if (km < 1) continue;   // descarta fragmentos <1km
    fits.push({ id: f.id, date: d10(f.session_date), km });
  }
  if (!fits.length) return null;
  const sdate = d10(full.date), progKm = programmedKm(full);
  let best = null, bs = 1e9;
  for (const f of fits) {
    const dd = Math.abs(dayDiff(f.date, sdate)); if (dd > 4) continue;
    if (f.km && progKm && dd > 0 && Math.abs(f.km - progKm) > Math.max(2.5, progKm * 0.6)) continue;
    const score = dd + ((f.km && progKm) ? Math.abs(f.km - progKm) * 0.6 : 0);
    if (score < bs) { bs = score; best = f; }
  }
  if (!best) return null;
  let rr; try { rr = await ET.getResume(session, best.id); } catch (_) { return null; }
  const resume = (rr && (rr.resume || rr)) || null;
  if (!resume || !(resume.laps && resume.laps.length)) return null;
  if (usedFits) usedFits.add(best.id);
  return { resume, execDate: best.date !== sdate ? best.date : null };
}

module.exports = { programmedBlocks, sessionBreakdown, execLaps, pace, range, crossDayLaps };
