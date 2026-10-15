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

SRC = sys.argv[1] if len(sys.argv) > 1 else "report/triage-data.json"
D = json.load(open(SRC))
A = D["athletes"]

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
    "CUIDAR": "F4CCCC", "PEDIR": "FCE5CD", "MANTENER": "FFF2CC",
    "PROGRESAR": "D9EAD3", "REVISAR": "E7ECF3",
}
def acc_fill(acc):
    for k, v in ACC_FILL.items():
        if acc.startswith(k): return PatternFill("solid", fgColor=v)
    return None

wb = Workbook(); ws = wb.active; ws.title = "TRIAGE RENOVACIONES"
ws.sheet_view.showGridLines = False
COLS = [("Atleta", 20), ("Urgencia", 12), ("Vence", 11), ("Librería que usó este mes", 30),
        ("Próximo paso", 16), ("Disciplina", 12), ("Vol prog\n(km/sem)", 10), ("Adher.", 8),
        ("Feedback", 10), ("Molestia", 20), ("Próx. comp.", 18), ("Acción sugerida", 22)]
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
        proxtxt = (f'{prox["name"]} {str(prox["date"])[5:]}' if prox else "—")
        vals = [a.get("athlete", ""), a.get("urgencia", ""), (a.get("vence") or "")[5:], lib, nxt,
                a.get("disciplina", ""), a.get("volProg", ""), adhtxt, fbtxt,
                a.get("molestia", "") or "—", proxtxt, a.get("accion", "")]
        for i, v in enumerate(vals, 1):
            cell = ws.cell(r, i, v); cell.border = BORD; cell.font = CF
            cell.alignment = L if i in (1, 4, 10, 11, 12) else C
        ws.cell(r, 2).fill = VENC if venc else POR
        ws.cell(r, 2).font = Font(bold=True, size=11, color=("9C0006" if venc else "7F6000"))
        af = acc_fill(a.get("accion", ""))
        if af: ws.cell(r, 12).fill = af
        # feedback NO -> resaltar
        if not fb: ws.cell(r, 9).font = Font(size=11, color="9C0006")
        # el filtro de decisión del coach (de la plantilla de librería) como comentario
        vd = a.get("libVerdict") or ""
        if vd:
            cm = Comment(vd, "Tu filtro de decisión (librería)"); cm.width = 420; cm.height = 180
            ws.cell(r, 4).comment = cm
        ws.row_dimensions[r].height = 30
        r += 1
    r += 1  # respiro entre bloques

ws.freeze_panes = "A4"
out = "report/Triage-Renovaciones.xlsx"
wb.save(out); print(out)
