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
      const pausePasiva = /pausa/i.test(vf) || /pausa pasiva/i.test(notes);
      const isPause = sec.text_only && pausePasiva;
      const isWarm = sec.text_only && !pausePasiva;     // mobility / drills
      const zone = w.zone_number;
      const doseLabel = byDur ? (durFmt(w.duration) || distLabel(w.distance)) : (distLabel(w.distance) || durFmt(w.duration));
      let label;
      if (isPause) label = /pasiva/i.test(vf + notes) ? 'Pausa pasiva' : 'Pausa';
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
  if (hasFit) alignLaps(blocks, laps);

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
    if (hasFit) {
      const used = (b._laps || []).filter((l) => bike ? l.power != null : (l.paceMin == null || l.paceMin <= PAUSE_PACE_MIN));
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
      const vals = used.map((l) => bike ? `${l.power}W` : pace(l.pace)).join(' ');
      const hrs = used.map((l) => l.hr).filter(Boolean);
      const hr = hrs.length ? Math.round(hrs.reduce((a, c) => a + c, 0) / hrs.length) : null;
      lines.push({ text: `ejec total: ${(+km.toFixed(2)).toString().replace('.', ',')}K · ${vals}${hr ? ` (FC ${hr})` : ''}`, kind: 'work' });
    }
  }

  return { sport: sportName, bike, hasFit, lines };
}

module.exports = { programmedBlocks, sessionBreakdown, execLaps, pace, range };
