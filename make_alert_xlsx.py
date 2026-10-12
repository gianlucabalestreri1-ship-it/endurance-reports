#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Alerta de adherencia — Excel. Lee report/alert-data.json.
Atletas activos ordenados: ALERTA primero (más días sin reportar arriba),
luego por-comenzar / standby / sin-dato / ok / off. Centrado, al medio, ajustado."""
import json, sys
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

D = json.load(open(sys.argv[1] if len(sys.argv) > 1 else "report/alert-data.json"))
rows = D["rows"]; c = D["counts"]

INK="1A1F2B"; MUT="5B6472"
HEADER=PatternFill("solid",fgColor="1F3A5F"); HEADERF=Font(color="FFFFFF",bold=True,size=11)
TITLEF=Font(bold=True,size=15,color=INK); SUBF=Font(italic=True,size=10,color=MUT)
thin=Side(style="thin",color="D8DEE8"); BORD=Border(left=thin,right=thin,top=thin,bottom=thin)
CEN=Alignment(horizontal="center",vertical="center",wrap_text=True)
STFILL={"alerta":PatternFill("solid",fgColor="FFC7CE"),"ok":PatternFill("solid",fgColor="C6EFCE"),
        "por_comenzar":PatternFill("solid",fgColor="DDEBF7"),"standby":PatternFill("solid",fgColor="FFEB9C"),
        "off":PatternFill("solid",fgColor="E7E9ED"),"sin_dato":PatternFill("solid",fgColor="FCE4D6")}
STFONT={"alerta":Font(bold=True,size=10,color="9C0006"),"ok":Font(size=10,color="006100"),
        "por_comenzar":Font(size=10,color="1F4E79"),"standby":Font(bold=True,size=10,color="9C6500"),
        "off":Font(size=10,color="5B6472"),"sin_dato":Font(size=10,color="974706")}
STLABEL={"alerta":"⚠ ALERTA","ok":"OK","por_comenzar":"Por comenzar","standby":"Standby","off":"Off","sin_dato":"Sin dato"}
ORDER={"alerta":0,"sin_dato":1,"por_comenzar":2,"standby":3,"ok":4,"off":5}

def sev_fill(days):
    if days is None: return PatternFill("solid",fgColor="FF9C9C")
    if days>21: return PatternFill("solid",fgColor="FFB3B3")
    if days>14: return PatternFill("solid",fgColor="FFC7CE")
    return PatternFill("solid",fgColor="FFE0E3")

rows_sorted = sorted(rows, key=lambda r: (ORDER.get(r["status"],9),
                     -(r["daysSince"] if r["daysSince"] is not None else 10**6)))

wb=Workbook(); ws=wb.active; ws.title="Alerta adherencia"
ws["A1"]="Alerta de adherencia semanal"; ws["A1"].font=TITLEF; ws["A1"].alignment=Alignment(horizontal="left",vertical="center")
_conplan = D["total"] - c.get("off",0)
ws["A2"]=(f'Corte {D["today"]} · umbral {D["thresholdDays"]} días sin reportar · {D["total"]} atletas ({_conplan} con plan) · '
          f'ALERTA {c["alerta"]} · por comenzar {c.get("por_comenzar",0)} · ok {c["ok"]} · off sin plan {c.get("off",0)}'
          f'{" · sin dato "+str(c["sin_dato"]) if c.get("sin_dato") else ""}')
ws["A2"].font=SUBF; ws["A2"].alignment=Alignment(horizontal="left",vertical="center")
W=[26,13,11,16,18,34,26]
for i,w in enumerate(W,1): ws.column_dimensions[get_column_letter(i)].width=w
r=4
HDR=["Atleta","Estado","Días sin reportar","Último (feedback o FIT)","Último feedback manual","Plan vigente","Nota / motivo"]
for i,h in enumerate(HDR,1):
    cell=ws.cell(r,i,h); cell.fill=HEADER; cell.font=HEADERF; cell.border=BORD; cell.alignment=CEN
ws.freeze_panes=ws.cell(r+1,1); r+=1
for x in rows_sorted:
    st=x["status"]
    ws.cell(r,1,x["athlete"])
    cc=ws.cell(r,2,STLABEL.get(st,st)); cc.fill=STFILL.get(st); cc.font=STFONT.get(st)
    dcell=ws.cell(r,3, ("—" if x["daysSince"] is None else x["daysSince"]) if st!="por_comenzar" else "—")
    if st=="alerta": dcell.fill=sev_fill(x["daysSince"])
    ws.cell(r,4, x.get("lastActivity") or ("(nunca reportó)" if st=="alerta" else "—"))
    ws.cell(r,5, x.get("lastFeedback") or "—")
    plan = (x.get("planTitle") or "") + ("  · VENCIDO "+(x.get("planEnd") or "") if x.get("planExpired") else "")
    ws.cell(r,6, plan)
    ws.cell(r,7, x.get("motivo") or "")
    for cc2 in range(1,8): ws.cell(r,cc2).border=BORD; ws.cell(r,cc2).alignment=CEN
    r+=1

out="report/Alerta-Adherencia.xlsx"; wb.save(out); print("OK ->",out)
