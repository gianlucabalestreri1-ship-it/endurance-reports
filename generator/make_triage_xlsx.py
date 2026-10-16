# -*- coding: utf-8 -*-
"""TRIAGE de renovaciones por ARQUETIPO de trabajo.
Lee report/triage-data.json -> report/Triage-Renovaciones.xlsx
Una hoja: atletas agrupados por arquetipo (bloques), VENCIDOS primero (urgencia),
con la plantilla de librería que usaron este mes + próximo paso del roadmap, y los
flags de decisión. Sin emojis, todo centrado."""
import json, sys
from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

import math
SRC = sys.argv[1] if len(sys.argv) > 1 else "report/triage-data.json"
D = json.load(open(SRC))
A = D["athletes"]

def est_lines(text, width):
    if not text: return 1
    cpl = max(8, int(width * 0.95))
    return sum(max(1, math.ceil(len(seg) / cpl)) for seg in str(text).split("\n"))

ARQ_ORDER = ["A0", "A1", "A2", "A3", "A4", "A5", "A6"]
ARQ_NAME = {
    "A0": "A0 · Primeros pasos (caminar / correr)",
    "A1": "A1 · Post primeros pasos (consolidando al corredor)",
    "A2": "A2 · Corredor en base / desarrollo (sin carrera inminente)",
    "A3": "A3 · Prepara 10K (5-10K)",
    "A4": "A4 · Prepara 21K",
    "A5": "A5 · Prepara 42K / ultra / trail",
    "A6": "A6 · Medio fondo / velocidad (800-1500-3000, vVO2)",
}

C = Alignment(horizontal="center", vertical="center", wrap_text=True)
L = Alignment(horizontal="left", vertical="center", wrap_text=True)
thin = Side(style="thin", color="C9D2DF")
BORD = Border(left=thin, right=thin, top=thin, bottom=thin)
INK = "1A1F2B"
HEAD = PatternFill("solid", fgColor="1F3A5F"); HF = Font(color="FFFFFF", bold=True, size=11)
ARQF = PatternFill("solid", fgColor="34495E"); ARQFONT = Font(color="FFFFFF", bold=True, size=12)
VENC = PatternFill("solid", fgColor="F4CCCC")   # rojo claro (vencido)
POR = PatternFill("solid", fgColor="FFF2CC")    # amarillo (por vencer)
SUB = Font(italic=True, size=10, color="5B6472")
CF = Font(size=11)

ACC_FILL = {
    "CUIDAR": "F4CCCC", "PEDIR": "FCE5CD", "AFINAR": "CFE2F3", "MANTENER": "FFF2CC",
    "LISTO": "D9EAD3", "PROGRESAR": "D9EAD3", "REVISAR": "E7ECF3",
}
def acc_fill(acc):
    for k, v in ACC_FILL.items():
        if acc.startswith(k): return PatternFill("solid", fgColor=v)
    return None

wb = Workbook(); ws = wb.active; ws.title = "TRIAGE RENOVACIONES"
ws.sheet_view.showGridLines = False
COLS = [("Atleta", 20), ("Urgencia", 12), ("Vence", 11), ("Librería que usó este mes", 30),
        ("Próximo paso", 16), ("Disciplina", 12), ("Vol prog\n(km/sem)", 10), ("Adher.", 8), ("Tend.", 11),
        ("Feedback", 10), ("Molestia", 20), ("Próx. comp.", 18), ("Acción sugerida", 24)]
for i, (h, w) in enumerate(COLS, 1):
    ws.column_dimensions[get_column_letter(i)].width = w
NC = len(COLS)

r = 1
ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=NC)
c = ws.cell(r, 1, f"TRIAGE DE RENOVACIONES POR ARQUETIPO  ·  {D.get('generatedAt','')}  ·  {len(A)} atletas")
c.font = Font(bold=True, size=15, color=INK); c.alignment = L; ws.row_dimensions[r].height = 24; r += 1
ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=NC)
c = ws.cell(r, 1, "Trabajá por bloque (mismo arquetipo = mismos circuitos). Dentro de cada bloque, los VENCIDOS (rojo) van primero: resolvé esos antes. La columna Librería dice con qué plantilla tuya venía entrenando; pasá el mouse para ver tu filtro de decisión del mes.")
c.font = SUB; c.alignment = L; ws.row_dimensions[r].height = 28; r += 1
# resumen: cantidad de atletas por arquetipo
cnt = {}
for a in A: cnt[a.get("arquetipo")] = cnt.get(a.get("arquetipo"), 0) + 1
resumen = "Cantidad de atletas:  " + "   ·   ".join(f"{k} {cnt[k]}" for k in ARQ_ORDER if cnt.get(k))
ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=NC)
c = ws.cell(r, 1, resumen); c.font = Font(bold=True, size=10, color="1F3A5F"); c.alignment = L; r += 1
r += 1

URG_RANK = {"VENCIDO": 0, "POR VENCER": 1}
def sort_key(a): return (URG_RANK.get(a.get("urgencia"), 2), a.get("vence") or "9999")

for arq in ARQ_ORDER:
    grp = sorted([a for a in A if a.get("arquetipo") == arq], key=sort_key)
    if not grp: continue
    nv = sum(1 for a in grp if a.get("urgencia") == "VENCIDO")
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=NC)
    cc = ws.cell(r, 1, f"{ARQ_NAME[arq]}    ·    {len(grp)} atleta(s)" + (f"  ·  {nv} VENCIDO(S)" if nv else ""))
    cc.fill = ARQF; cc.font = ARQFONT; cc.alignment = L; ws.row_dimensions[r].height = 22; r += 1
    for i, (h, w) in enumerate(COLS, 1):
        hc = ws.cell(r, i, h); hc.fill = HEAD; hc.font = HF; hc.alignment = C; hc.border = BORD
    r += 1
    for a in grp:
        venc = a.get("urgencia") == "VENCIDO"
        lib = a.get("libMeso") or a.get("libPlan") or "—"
        nxt = a.get("roadmapNext") or ""
        fb = a.get("fbCount") or 0
        fbtxt = f"{fb} fb" if fb else "NO"
        adh = a.get("adherencia")
        adhtxt = "s/d" if (adh is None or (a.get("progRun", 0) and a.get("execRun", 0) == 0)) else f"{adh}%"
        prox = a.get("proxComp")
        dc = a.get("diasComp")
        proxtxt = (f'{prox["name"]} {str(prox["date"])[5:]}' + (f' ({dc}d)' if dc else '') if prox else "—")
        TEND = {"sube": "sube", "baja": "baja", "estable": "estable", "s/d": "s/d"}
        tendtxt = TEND.get(a.get("tendencia", "s/d"), "s/d")
        if a.get("riesgoAbandono"): tendtxt = "baja · RIESGO"
        molest = a.get("molestia", ""); mejora = a.get("mejora", "")
        molcell = molest if molest else (("Mejora · " + mejora) if mejora else "—")
        vals = [a.get("athlete", ""), a.get("urgencia", ""), (a.get("vence") or "")[5:], lib, nxt,
                a.get("disciplina", ""), a.get("volProg", ""), adhtxt, tendtxt, fbtxt,
                molcell, proxtxt, a.get("accion", "")]
        for i, v in enumerate(vals, 1):
            cell = ws.cell(r, i, v); cell.border = BORD; cell.font = CF
            cell.alignment = L if i in (1, 4, 11, 12, 13) else C
        # molestia activa (rojo) vs mejora (lila)
        if molest: ws.cell(r, 11).font = Font(size=11, color="9C0006")
        elif mejora: ws.cell(r, 11).font = Font(size=11, color="7030A0")
        ws.cell(r, 2).fill = VENC if venc else POR
        ws.cell(r, 2).font = Font(bold=True, size=11, color=("9C0006" if venc else "7F6000"))
        # tendencia coloreada
        tc = ws.cell(r, 9)
        if a.get("riesgoAbandono"): tc.fill = VENC; tc.font = Font(bold=True, size=10, color="9C0006")
        elif a.get("tendencia") == "sube": tc.font = Font(size=11, color="006100")
        elif a.get("tendencia") == "baja": tc.font = Font(size=11, color="9C0006")
        af = acc_fill(a.get("accion", ""))
        if af: ws.cell(r, 13).fill = af
        if a.get("listoAvanzar"): ws.cell(r, 13).font = Font(bold=True, size=11, color="006100")
        # feedback NO -> resaltar
        if not fb: ws.cell(r, 10).font = Font(size=11, color="9C0006")
        # alto de fila ajustado para que NO se corte la molestia / librería / acción
        nl = max(est_lines(vals[10], COLS[10][1]), est_lines(vals[3], COLS[3][1]),
                 est_lines(vals[4], COLS[4][1]), est_lines(vals[12], COLS[12][1]), est_lines(vals[11], COLS[11][1]), 2)
        ws.row_dimensions[r].height = min(110, 15.6 * nl + 6)
        # el filtro de decisión del coach (de la plantilla de librería) como comentario
        vd = a.get("libVerdict") or ""
        if vd:
            cm = Comment(vd, "Tu filtro de decisión (librería)"); cm.width = 420; cm.height = 180
            ws.cell(r, 4).comment = cm
        r += 1
    r += 1  # respiro entre bloques

ws.freeze_panes = "A4"

# =================== una hoja por atleta: EXTRACCIÓN DEL MESOCICLO ===================
# Tabla cronológica (una fila por sesión) con programado vs ejecutado, ritmo, feedback,
# dolor y estado. Para no abrir sesión por sesión en Endurance Tool.
import os, re as _re
CAT_FONT = {"LIT": Font(bold=True, size=10, color="1C4E8A"), "ThT": Font(bold=True, size=10, color="9A7400"), "HIT": Font(bold=True, size=10, color="B02A2A")}
ST_FILL = {"Realizada": PatternFill("solid", fgColor="D9EAD3"), "Modificada": PatternFill("solid", fgColor="FFF2CC"),
           "No realizada": PatternFill("solid", fgColor="F4CCCC"), "Futura": PatternFill("solid", fgColor="EEF2F7"), "Fuerza": PatternFill("solid", fgColor="F3F3F3")}
DEVIA = _re.compile(r"no pude|no logr[eé]|suspend|cort[eé]|abandon|dolor|molest|parcial|me falt|incomplet|menos|pesad|agot|cansad", _re.I)
def _mmdd(d):
    try: return d[8:10] + "/" + d[5:7]
    except Exception: return d
def s_tipo(s): return "Fuerza" if s.get("strength") else (s.get("cat") or "")
def s_ses(s): return (("★ " if s.get("key") else "") + (s.get("title") or "")).strip()
def s_rpe(s):
    a, b = s.get("progRpe"), s.get("sRPE")
    return (f'{a if a is not None else "–"} → {b if b is not None else "–"}')
def s_durdist(s):
    du = (s.get("realDur") or s.get("progDur") or "–"); di = (s.get("realDist") or s.get("progDist") or "–")
    return f'{du} · {di}'
def s_ritmo(s):
    tp = [t.get("target") for t in (s.get("targets") or []) if t.get("target")]
    obj = " · ".join(tp[:3]) if tp else (s.get("targetPace") or "–")
    real = s.get("realPace") or "–"
    return f'obj {obj}\nreal {real}' + ("  [FIT]" if s.get("hasFit") else "")

# ---- alineación lap ↔ bloque programado (para FIT con estructura) ----
_ZN = {1: "Recuperación", 2: "Endurance", 3: "Tempo", 4: "Umbral", 5: "Supraumbral", 6: "VO2Max", 7: "Glucolítico", 8: "Neuromuscular"}
def _fmtkm(x):
    if not x: return ""
    return f"{x:g}K" if x >= 1 else f"{int(round(x * 1000))}m"
def _lsec(p):
    p = p or ""
    if "h" in p: return 99999
    m = _re.search(r"(\d+)'(\d+)", p)
    return int(m.group(1)) * 60 + int(m.group(2)) if m else None
def _lp(l):
    return (l.get("pace") or "").replace('"', "").replace(" / km", "").replace("/ km", "").strip()
def _is_pause_lap(l):
    sec = _lsec(l.get("pace")); return (sec is not None and sec >= 720) or (l.get("distKm") or 0) < 0.2
def _mkblocks(targets):
    bl = []
    for t in targets:
        z = t.get("zone") or 0; name = t.get("zoneName") or _ZN.get(z, f"Z{z}")
        tgt = t.get("target") or ""; dist = t.get("dist") or 0
        nums = [int(x) for x in _re.findall(r"\d+", t.get("label") or "")]
        reps = 1
        for n in nums: reps *= n
        is_pause = (z == 1 and not tgt)
        total = (dist * reps) or 0.1
        label = (f"{reps}x{int(round(dist * 1000))}m {name}" if (reps > 1 and dist < 1) else f"{_fmtkm(total)} {name}")
        # objetivo = RANGO de zona (no ritmo único) + piso/mitad/techo si el coach lo indicó
        rng = t.get("range") or tgt or "–"
        nivel = t.get("nivel") or ""
        obj = (f"Z{z} {rng}" if z else rng) + (f" · {nivel}" if nivel else "")
        bl.append({"name": name, "obj": obj, "total": total, "is_pause": is_pause, "label": label, "dur": t.get("dur") or 0, "notes": t.get("notes") or ""})
    return bl
def s_ritmo_blocks(s):
    tg = s.get("targets") or []; lp = s.get("laps") or []
    if not (s.get("hasFit") and tg and lp): return s_ritmo(s)
    blocks = _mkblocks(tg)
    laps = [l for l in lp if (l.get("distKm") or 0) >= 0.03]
    i = 0; lines = []
    for b in blocks:
        if b["is_pause"]:
            jog = []
            while i < len(laps) and _is_pause_lap(laps[i]):
                if (laps[i].get("distKm") or 0) >= 0.4 and (_lsec(laps[i].get("pace")) or 999) < 540: jog.append(laps[i])
                i += 1
            lines.append((f"{b['label']}: " + " ".join(_lp(l) for l in jog)) if jog else (f"pausa {round(b['dur'])}'" if b["dur"] else "pausa"))
        else:
            acc = 0; mine = []
            while i < len(laps) and acc < b["total"] * 0.85:
                if _is_pause_lap(laps[i]): i += 1; continue   # pausa intercalada entre reps
                mine.append(laps[i]); acc += laps[i].get("distKm") or 0; i += 1
            lines.append(f"{b['label']} [obj {b['obj']}]: " + (" ".join(_lp(l) for l in mine) if mine else "–"))
    return "\n".join(lines) if lines else s_ritmo(s)
def s_estado(s):
    if s.get("strength"): return "Fuerza"
    if s.get("future"): return "Futura"
    if s.get("executed"):
        dev = s.get("pain") or (DEVIA.search(s.get("comment") or "") is not None)
        a, b = s.get("progRpe"), s.get("sRPE")
        if a is not None and b is not None and b <= a - 3: dev = True
        return "Modificada" if dev else "Realizada"
    if s.get("due", True): return "No realizada"
    return "Futura"
# ---- feedback estructurado (sensaciones · qué modificó · parciales del estímulo) ----
_PACE_RE = _re.compile(r"(\d{1,2})[\s'’:.]+(\d{2})(?:\s*[\"”])?|[/](\d{1,2})\s*[\"”]")
_MODIF = _re.compile(r"(en vez de|en lugar de|cambi[eé]|modifi\w+|no pude (?:terminar|completar|hacer|seguir)|suspend\w+|acort\w+|cort[eé]|camin[eé][^.]{0,40}?(?:no daba|porque|cansad|falt)|hice menos|redu\w+|no logr[eé]|par[eé] antes|dej[eé] antes|me falt[oó])", _re.I)
_VAR = _re.compile(r"variable|fartlek|cambios de ritmo|ondulado|progres|pausa activa|intensidad variable|cuestas", _re.I)
def _paces(text, keep_slow):
    out = []; last = None
    for m in _PACE_RE.finditer(text or ""):
        if m.group(1):
            mn = int(m.group(1)); sc = int(m.group(2)); last = mn
        else:
            if last is None: continue
            mn = last; sc = int(m.group(3))
        sec = mn * 60 + sc
        if 150 <= sec <= 1200: out.append((sec, f"{mn}'{sc:02d}\""))
    work = out if keep_slow else [p for p in out if p[0] < 600]
    paus = 0 if keep_slow else sum(1 for p in out if p[0] >= 600)
    return work, paus
def _narr(text):
    # saca sólo los tiempos/ritmos (van a "Parc"), mantiene las palabras para que se lea
    n = _PACE_RE.sub(" ", text or "")
    n = _re.sub(r"\b[Rr]itmo\b[:\s]*", " ", n)      # la etiqueta "Ritmo" sobra
    # placeholders vacíos del template de la app (ej. Nike): x '' - '' - '' , comillas sueltas
    n = _re.sub(r"[x×]\s*(?=['’\"”])", " ", n)
    n = _re.sub(r"(['’\"”]+\s*[-–]?\s*){2,}", " ", n)
    n = _re.sub(r"['’\"”]{1,2}", " ", n)
    n = _re.sub(r"(?:\s[-–]\s)+", " ", n)
    n = _re.sub(r"[·|]{2,}", " ", n)
    n = _re.sub(r"\s{2,}", " ", n).strip(" ,.-:·/|\"”'’")
    return n
def structure_fb(s):
    c = (s.get("comment") or "").strip()
    if not c: return "—"
    keep = bool(_VAR.search((s.get("title") or "") + " " + c))
    work, paus = _paces(c, keep)
    narr = _narr(c)
    mod = ""
    mm = _MODIF.search(c)
    if mm:
        seg = c[mm.start():]; seg = _re.split(r"[.!?\n]", seg)[0]; mod = seg.strip()[:90]
    lines = [f"Sens: {narr if narr else '—'}"]
    if mod: lines.append(f"Mod: {mod}")
    if work:
        ptxt = " ".join(p[1] for p in work)
        tail = "  [var.]" if keep else (f"  (–{paus} pausa)" if paus else "")
        lines.append(f"Parc: {ptxt}{tail}")
    elif not s.get("strength"):
        lines.append("Parc: sin parciales reportados")
    return "\n".join(lines)
def _est_lines(text, width):
    if not text: return 1
    cpl = max(8, int(width * 0.95))
    import math
    return sum(max(1, math.ceil(len(seg) / cpl)) for seg in str(text).split("\n"))

MCOLS = [("Fecha", 9), ("Tipo", 9), ("Sesión", 24), ("RPE p→s", 10), ("Dur · Dist", 15),
         ("Ritmo obj → real (por bloque)", 34), ("Feedback del atleta (sensaciones · modificó · parciales)", 48), ("Dolor", 8), ("Estado", 13)]
usednames = set()
def tabname(arq, name):
    base = f'{arq} {name}'[:28]
    base = _re.sub(r'[:\\/?*\[\]]', ' ', base)
    t = base; i = 2
    while t in usednames: t = f'{base[:25]} {i}'; i += 1
    usednames.add(t); return t

ordered = []
for arq in ARQ_ORDER:
    ordered += sorted([a for a in A if a.get("arquetipo") == arq], key=sort_key)
for a in ordered:
    pid = a.get("planId")
    fp = f'report/renewal-{pid}-data.json'
    if not os.path.exists(fp): continue
    rd = json.load(open(fp))
    wsa = wb.create_sheet(tabname(a.get("arquetipo", ""), a.get("athlete", "")))
    wsa.sheet_view.showGridLines = False
    for i, (h, w) in enumerate(MCOLS, 1): wsa.column_dimensions[get_column_letter(i)].width = w
    MN = len(MCOLS); rr = 1
    wsa.merge_cells(start_row=rr, start_column=1, end_row=rr, end_column=MN)
    c = wsa.cell(rr, 1, f'{a.get("athlete","")}  ·  {a.get("arquetipoNombre","")}'); c.font = Font(bold=True, size=14, color=INK); c.alignment = L; wsa.row_dimensions[rr].height = 22; rr += 1
    lib = a.get("libMeso") or a.get("libPlan") or "—"
    recap = f'{rd["plan"]["title"]}  ·  Librería: {lib}'
    if a.get("roadmapNext"): recap += f'  ·  {a["roadmapNext"]}'
    recap += f'  ·  Adherencia {a.get("adherencia","s/d")}%  ·  {a.get("accion","")}'
    wsa.merge_cells(start_row=rr, start_column=1, end_row=rr, end_column=MN)
    c = wsa.cell(rr, 1, recap); c.font = SUB; c.alignment = L; wsa.row_dimensions[rr].height = 26; rr += 1
    vd = a.get("libVerdict")
    if vd:
        wsa.merge_cells(start_row=rr, start_column=1, end_row=rr, end_column=MN)
        c = wsa.cell(rr, 1, "Tu filtro: " + vd); c.font = Font(italic=True, size=9, color="7F6000"); c.alignment = L; wsa.row_dimensions[rr].height = 26; rr += 1
    rr += 1
    for m in rd.get("micros", []):
        wsa.merge_cells(start_row=rr, start_column=1, end_row=rr, end_column=MN)
        mc = wsa.cell(rr, 1, f'{m.get("meso","")} · Microciclo {m.get("number","")} · {m.get("start","")} al {m.get("end","")} · {m.get("doneSessions",0)}/{m.get("progSessions",0)} ejecutadas ({m.get("adherence",0)}%)')
        mc.fill = ARQF; mc.font = Font(bold=True, size=11, color="FFFFFF"); mc.alignment = L; wsa.row_dimensions[rr].height = 20; rr += 1
        for i, (h, w) in enumerate(MCOLS, 1):
            hc = wsa.cell(rr, i, h); hc.fill = HEAD; hc.font = HF; hc.alignment = C; hc.border = BORD
        rr += 1
        for s in sorted(m.get("sessions", []), key=lambda x: (x.get("date", ""), x.get("moment", ""))):
            est = s_estado(s)
            fb = structure_fb(s); ritmo = s_ritmo_blocks(s); ses = s_ses(s)
            pc = s.get("painClass") or ("active" if s.get("pain") else "none")
            dol = "SÍ" if pc == "active" else ("Mejora" if pc == "improving" else "—")
            vals = [_mmdd(s.get("date", "")), s_tipo(s), ses, s_rpe(s), s_durdist(s), ritmo,
                    fb, dol, est]
            for i, v in enumerate(vals, 1):
                cell = wsa.cell(rr, i, v); cell.border = BORD; cell.font = Font(size=10)
                cell.alignment = Alignment(horizontal=("left" if i in (3, 6, 7) else "center"), vertical="center", wrap_text=True)
            if s_tipo(s) in CAT_FONT: wsa.cell(rr, 2).font = CAT_FONT[s_tipo(s)]
            if est in ST_FILL: wsa.cell(rr, 9).fill = ST_FILL[est]
            if pc == "active": wsa.cell(rr, 8).font = Font(bold=True, size=10, color="9C0006")
            elif pc == "improving": wsa.cell(rr, 8).font = Font(bold=True, size=10, color="7030A0")
            # alto de fila ajustado al contenido (feedback manda, también ritmo/sesión)
            nlines = max(est_lines(fb, MCOLS[6][1]), est_lines(ritmo, MCOLS[5][1]), est_lines(ses, MCOLS[2][1]), 2)
            wsa.row_dimensions[rr].height = min(320, 15.6 * nlines + 8)
            rr += 1
        rr += 1
    wsa.freeze_panes = "A5"

# post-proceso global: todo centrado + al medio + ajustado, letra mínima 11
for wsx in wb.worksheets:
    for row in wsx.iter_rows():
        for cc in row:
            if cc.value is None: continue
            cc.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            f = cc.font
            if f is not None and f.size and f.size < 11:
                cc.font = Font(name=f.name, size=11, bold=f.bold, italic=f.italic, color=f.color, underline=f.underline)

out = "report/Triage-Renovaciones.xlsx"
wb.save(out); print(out)
