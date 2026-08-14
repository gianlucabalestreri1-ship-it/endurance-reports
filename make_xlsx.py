#!/usr/bin/env python3
"""Genera report/Endurance-Feedback.xlsx a partir de report/feedback-data.json
(que produce feedback-table.js). Tres hojas: Feedback, ⚠ Atención, Competencias.
Resalta sRPE>=6, dolor/molestia y competencias completadas. Sin fórmulas
(export estático): no requiere recalc de LibreOffice.

Requiere openpyxl:  pip install -q openpyxl
Uso:                 python3 make_xlsx.py
"""
import json
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

DATA = "report/feedback-data.json"
OUT = "report/Endurance-Feedback.xlsx"

data = json.load(open(DATA))
rows = data["sessionRows"]; fit = data["fit"]; comps = data["competitions"]; cds = data["countdowns"]
rows = sorted(rows, key=lambda r: (0 if r.get("unread") else 1, 0 if r.get("pain") else 1, -(r.get("rpe") or 0)))

A = "Arial"
HEAD_FILL = PatternFill("solid", fgColor="F15A24")
HEAD_FONT = Font(name=A, bold=True, color="FFFFFF", size=11)
CELL = Font(name=A, size=10); BOLD = Font(name=A, size=10, bold=True)
HOT = Font(name=A, size=11, bold=True, color="C00000")
thin = Side(style="thin", color="D9D9D9"); BORDER = Border(left=thin, right=thin, top=thin, bottom=thin)
WRAP = Alignment(wrap_text=True, vertical="top"); CTR = Alignment(horizontal="center", vertical="top"); TOP = Alignment(vertical="top")
F_UNREAD = PatternFill("solid", fgColor="E7F7EE"); F_HOT = PatternFill("solid", fgColor="FDE7E7"); F_PAIN = PatternFill("solid", fgColor="FFF1DD")
TIPO_FILL = {"red": PatternFill("solid", fgColor="E5484D"), "yellow": PatternFill("solid", fgColor="D9A400"),
             "blue": PatternFill("solid", fgColor="3B82F6"), "gray": PatternFill("solid", fgColor="9AA0AA")}
TIPO_LABEL = {"HIT": "HIT", "ThT": "ThT", "LIT": "LIT", "FZA": "Fuerza", "TEST": "Test", "OTRO": "—"}

wb = Workbook()

def header(ws, ncols, r=1):
    for c in range(1, ncols + 1):
        cell = ws.cell(row=r, column=c); cell.fill = HEAD_FILL; cell.font = HEAD_FONT
        cell.border = BORDER; cell.alignment = Alignment(vertical="center", wrap_text=True)
    ws.row_dimensions[r].height = 26; ws.freeze_panes = ws.cell(row=r + 1, column=1)

# ---- Feedback ----
ws = wb.active; ws.title = "Feedback"
H = ["", "Atleta", "Fecha", "Mom.", "Sesión", "Deporte", "Tipo", "sRPE", "Feedback / comentario", "Dolor", "FIT (métrica)"]
ws.append(H); header(ws, len(H))
for i, w in enumerate([4, 20, 12, 6, 26, 11, 20, 7, 60, 8, 20], 1):
    ws.column_dimensions[get_column_letter(i)].width = w
for r in rows:
    hot = (r.get("rpe") or 0) >= 6; pain = r.get("pain")
    inten = r.get("intensity", {}) or {}; cat = inten.get("cat", "OTRO"); color = inten.get("color", "gray")
    tipo = TIPO_LABEL.get(cat, cat) + ((" · " + r["sessionType"]) if r.get("sessionType") else "")
    fitv = ((r.get("fitDistance") or "") + ((" · " + r["fitDuration"]) if r.get("fitDuration") else "")) if r.get("hasFit") else ""
    ws.append(["●" if r.get("unread") else "", r.get("athlete", ""), r.get("date", ""), r.get("moment", ""),
               r.get("session", ""), r.get("sport", ""), tipo, r.get("rpe"), (r.get("comment") or "").strip(),
               "Sí" if pain else "—", fitv or "—"])
    i = ws.max_row
    rf = F_PAIN if pain else (F_HOT if hot else (F_UNREAD if r.get("unread") else None))
    for c in range(1, len(H) + 1):
        cell = ws.cell(row=i, column=c); cell.font = CELL; cell.border = BORDER
        cell.alignment = WRAP if c in (5, 9) else TOP
        if rf and c != 7: cell.fill = rf
    d = ws.cell(row=i, column=1); d.alignment = CTR
    if r.get("unread"): d.font = Font(name=A, size=10, color="2E9E5B", bold=True)
    t = ws.cell(row=i, column=7); t.fill = TIPO_FILL.get(color, TIPO_FILL["gray"])
    t.font = Font(name=A, size=9, bold=True, color="FFFFFF"); t.alignment = Alignment(vertical="top", wrap_text=True)
    s = ws.cell(row=i, column=8); s.alignment = CTR; s.font = HOT if hot else BOLD
    dl = ws.cell(row=i, column=10); dl.alignment = CTR
    if pain: dl.font = Font(name=A, size=10, bold=True, color="C00000")

# ---- ⚠ Atención ----
wa = wb.create_sheet("⚠ Atención")
wa["A1"] = "REPORTE — PRESTAR ATENCIÓN"; wa["A1"].font = Font(name=A, bold=True, size=13, color="C00000")
wa["A2"] = f"Coach {data.get('coach','')} · generado {data.get('generatedAt','')} · notificaciones sin leer"
wa["A2"].font = Font(name=A, size=9, color="808080")
n_hot = len([1 for r in rows if (r.get("rpe") or 0) >= 6]); n_pain = len([1 for r in rows if r.get("pain")]); n_fit = len([1 for r in rows if r.get("hasFit")])
ct = data.get("counts", {})
kpis = [
    ("Sin leer — total (todas las secciones)", ct.get("totalUnread", "")),
    ("Atletas DISTINTOS con feedback pendiente", ct.get("athletes", "")),
    ("Feedbacks de sesión sin leer", ct.get("atletasNotifs", len(rows))),
    ("  (filas al agrupar por sesión)", len(rows)),
    ("Competencias hechas", len(comps)),
    ("Cuenta regresiva A", len(cds)),
    ("Con FIT", n_fit),
    ("sRPE >= 6", n_hot),
    ("Con dolor/molestia", n_pain),
]
for r, (lbl, val) in enumerate(kpis, start=4):
    wa.cell(row=r, column=1, value=lbl).font = Font(name=A, size=10)
    vc = wa.cell(row=r, column=2, value=val); vc.alignment = CTR
    vc.font = HOT if lbl in ("sRPE >= 6", "Con dolor/molestia") else Font(name=A, size=11, bold=True)
wa.cell(row=4 + len(kpis), column=1,
        value='Nota: "Atletas" es la sección/pestaña del panel (feedbacks de sesión), no la cantidad de atletas.').font = Font(name=A, size=8, italic=True, color="808080")
start = 4 + len(kpis) + 3
for i, h in enumerate(["Motivo", "Atleta", "Fecha", "Sesión / Competición", "Tipo", "sRPE", "Detalle"], 1):
    c = wa.cell(row=start, column=i, value=h); c.fill = HEAD_FILL; c.font = HEAD_FONT; c.border = BORDER
    c.alignment = Alignment(vertical="center", wrap_text=True)
wa.freeze_panes = wa.cell(row=start + 1, column=1)
for i, w in enumerate([16, 20, 12, 26, 10, 7, 60], 1):
    wa.column_dimensions[get_column_letter(i)].width = w
att = []
for r in rows:
    reasons = []
    if (r.get("rpe") or 0) >= 6: reasons.append("sRPE≥6")
    if r.get("pain"): reasons.append("Dolor")
    if reasons:
        att.append(("+".join(reasons), r.get("athlete", ""), r.get("date", ""), r.get("session", ""),
                    TIPO_LABEL.get((r.get("intensity") or {}).get("cat", "OTRO")), r.get("rpe"),
                    (r.get("comment") or "").strip()[:200], (r.get("intensity") or {}).get("color", "gray"), bool(r.get("pain"))))
for c in comps:
    att.append(("Competencia ✓", c.get("athlete", ""), c.get("date", ""), c.get("competition") or c.get("session", ""),
                "Comp " + (c.get("priority") or ""), c.get("rpe"), (c.get("comment") or "").strip()[:200], "gray", bool(c.get("pain"))))
att = sorted(att, key=lambda x: (0 if "Dolor" in x[0] else 1, -(x[5] or 0)))
rr = start + 1
for motivo, ath, fecha, sess, tipo, rpe, det, color, pain in att:
    for i, v in enumerate([motivo, ath, fecha, sess, tipo, rpe, det], 1):
        cell = wa.cell(row=rr, column=i, value=v); cell.font = CELL; cell.border = BORDER
        cell.alignment = WRAP if i == 7 else (CTR if i in (3, 5, 6) else TOP)
    fill = F_PAIN if pain else F_HOT
    for i in range(1, 8):
        if i != 5: wa.cell(row=rr, column=i).fill = fill
    wa.cell(row=rr, column=1).font = Font(name=A, size=9, bold=True, color="C00000")
    wa.cell(row=rr, column=6).font = HOT if (rpe or 0) >= 6 else BOLD
    rr += 1

# ---- Competencias ----
wc = wb.create_sheet("Competencias")
H3 = ["", "Atleta", "Fecha", "Competición", "Prio", "sRPE", "Feedback", "Estado"]
wc.append(H3); header(wc, len(H3))
for i, w in enumerate([4, 20, 12, 26, 6, 7, 50, 14], 1):
    wc.column_dimensions[get_column_letter(i)].width = w
for c in comps:
    wc.append(["●" if c.get("unread") else "", c.get("athlete", ""), c.get("date", ""),
               c.get("competition") or c.get("session", ""), c.get("priority", ""), c.get("rpe"),
               (c.get("comment") or "").strip(), "✓ Completada"])
    i = wc.max_row
    for k in range(1, len(H3) + 1):
        cell = wc.cell(row=i, column=k); cell.font = CELL; cell.border = BORDER
        cell.alignment = WRAP if k == 7 else (CTR if k in (1, 3, 5, 6) else TOP)
    wc.cell(row=i, column=6).font = HOT if (c.get("rpe") or 0) >= 6 else BOLD
    wc.cell(row=i, column=8).font = Font(name=A, size=10, bold=True, color="2E9E5B")
base = wc.max_row + 3
wc.cell(row=base, column=2, value=f"Cuenta regresiva — prioridad A ({len(cds)})").font = Font(name=A, bold=True, size=11)
for i, h in ((2, "Atleta"), (3, "Aviso"), (5, "Prio")):
    c = wc.cell(row=base + 1, column=i, value=h); c.fill = HEAD_FILL; c.font = HEAD_FONT; c.border = BORDER; c.alignment = Alignment(vertical="center")
rr = base + 2
for c in cds:
    wc.cell(row=rr, column=2, value=c.get("athlete", "")).font = CELL
    wc.cell(row=rr, column=3, value=c.get("title", "")).font = CELL
    wc.cell(row=rr, column=5, value=c.get("priority", "")).font = CELL
    for i in (2, 3, 5):
        wc.cell(row=rr, column=i).border = BORDER; wc.cell(row=rr, column=i).alignment = TOP
    rr += 1

wb.save(OUT)
# openpyxl a veces deja una fila fantasma tras el header; la limpiamos.
wb2 = load_workbook(OUT); ws2 = wb2["Feedback"]
if all(ws2.cell(row=2, column=c).value in (None, "") for c in range(1, 12)):
    ws2.delete_rows(2, 1); ws2.freeze_panes = "A2"; wb2.save(OUT)
print(f"saved {OUT} | feedback {len(rows)} | atención {len(att)} | competencias {len(comps)} | countdown {len(cds)}")
