#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Informe de RENOVACIÓN — un único Excel con una pestaña por atleta.
Lee report/renewal-<plan>-data.json (uno o varios) y arma report/Renovacion.xlsx.
Sin fórmulas."""
import json, sys, os
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

files = sys.argv[1:]
if not files:
    print("uso: make_renewal_xlsx.py report/renewal-<id>-data.json ..."); sys.exit(1)
plans = [json.load(open(f)) for f in files]

INK="1A1F2B"; MUT="5B6472"
HEADER=PatternFill("solid",fgColor="1F3A5F"); HEADERF=Font(color="FFFFFF",bold=True,size=11)
SOFT=PatternFill("solid",fgColor="EEF2F7"); GAP=PatternFill("solid",fgColor="FBE3E3")
OKC=PatternFill("solid",fgColor="E7F6EE"); WARN=PatternFill("solid",fgColor="FDF3E6")
TITLEF=Font(bold=True,size=15,color=INK); SUBF=Font(italic=True,size=10,color=MUT); H2F=Font(bold=True,size=12,color="1F3A5F"); BOLD=Font(bold=True,color=INK)
thin=Side(style="thin",color="D8DEE8"); BORD=Border(left=thin,right=thin,top=thin,bottom=thin)
CAT={"LIT":PatternFill("solid",fgColor="D8E7FB"),"ThT":PatternFill("solid",fgColor="FBF0CE"),"HIT":PatternFill("solid",fgColor="F8D8D8")}
PAINF=PatternFill("solid",fgColor="F8D8D8")
SRC={"FIT":PatternFill("solid",fgColor="E7F6EE"),"manual":PatternFill("solid",fgColor="FBF0CE"),"comentario":PatternFill("solid",fgColor="FBF0CE"),"manual+coment.":PatternFill("solid",fgColor="FBF0CE"),"sin datos":PatternFill("solid",fgColor="FBE3E3")}

def adh_fill(p): return OKC if p>=70 else (WARN if p>=50 else GAP)
def sh(ws,r,n):
    for c in range(1,n+1):
        x=ws.cell(r,c); x.fill=HEADER; x.font=HEADERF; x.alignment=Alignment(vertical="center",wrap_text=True); x.border=BORD
def W(ws,ws_w):
    for i,w in enumerate(ws_w,1): ws.column_dimensions[get_column_letter(i)].width=w
def safe_title(name, used):
    t="".join(ch for ch in name if ch not in '[]:*?/\\')[:28] or "Atleta"
    base=t; i=2
    while t in used: t=f"{base[:25]}~{i}"; i+=1
    used.add(t); return t

wb=Workbook(); used=set()

# ---- Resumen ----
ws=wb.active; ws.title="Resumen"
ws["A1"]="Informe de renovación"; ws["A1"].font=TITLEF
ws["A2"]=f"{len(plans)} atleta(s) · último mesociclo del plan vigente (+ anterior si corto o sin ejecución) · generado {plans[0].get('generatedAt','')}"; ws["A2"].font=SUBF
W(ws,[26,30,16,13,12,30]); r=4
for i,h in enumerate(["Atleta","Plan","Período","Adherencia","Sesiones","Nota"],1): ws.cell(r,i,h)
sh(ws,r,6); r+=1
for d in plans:
    tot=sum(m["progSessions"] for m in d["micros"]); done=sum(m["doneSessions"] for m in d["micros"])
    adh=round(100*done/tot) if tot else 0
    nota = "Sin ejecución en el período (revisar: lesión/inactividad)" if done==0 else ("Adherencia baja (<70%)" if adh<70 else "Adherencia buena")
    ws.cell(r,1,d["athlete"]); ws.cell(r,2,d["plan"]["title"]); ws.cell(r,3," + ".join(str(x) for x in d["periodMesos"]))
    c=ws.cell(r,4,f"{adh}%"); c.fill=adh_fill(adh); ws.cell(r,5,f"{done}/{tot}"); ws.cell(r,6,nota)
    for cc in range(1,7): ws.cell(r,cc).border=BORD
    ws.cell(r,6).alignment=Alignment(wrap_text=True,vertical="top")
    r+=1
r+=1
ws.cell(r,1,"Ritmo real — fuente: FIT = dispositivo · manual/comentario = ritmos que el atleta cargó a mano · sin datos = no sincronizó ni reportó ritmo.").font=SUBF
ws.merge_cells(start_row=r,start_column=1,end_row=r,end_column=6)

# ---- una pestaña por atleta ----
for d in plans:
    ws=wb.create_sheet(safe_title(d["athlete"], used))
    p=d["plan"]
    ws["A1"]=d["athlete"]; ws["A1"].font=TITLEF
    ws["A2"]=f'{p["title"]} · {p["start"]} → {p["end"]} · {p["status"]} · período: {" + ".join(str(x) for x in d["periodMesos"])}'; ws["A2"].font=SUBF
    W(ws,[11,6,6,26,10,10,11,11,14,20,13,16,38]); r=4
    for m in d["micros"]:
        ws.cell(r,1,f'Microciclo {m["number"]}').font=H2F
        ws.cell(r,4,f'{m["start"]} → {m["end"]}').font=SUBF
        c=ws.cell(r,6,f'Adh {m["adherence"]}%'); c.fill=adh_fill(m["adherence"]); c.font=BOLD
        ws.cell(r,7,f'{m["doneSessions"]}/{m["progSessions"]} ses.').font=SUBF
        ws.cell(r,9,f'Vol prog {m.get("progVol","") or "—"} / real {m.get("realVol","") or "—"}').font=SUBF
        r+=1
        hdr=["Fecha","Mom.","Tipo","Sesión","RPE prog","sRPE","Dur prog","Dur real","Dist p/r","Ritmo objetivo","Ritmo real","Fuente","Comentario"]
        for i,h in enumerate(hdr,1): ws.cell(r,i,h)
        sh(ws,r,len(hdr)); r+=1
        for s in m["sessions"]:
            ws.cell(r,1,s["date"]); ws.cell(r,2,s["moment"])
            ws.cell(r,3,s["cat"]);
            if s["cat"] in CAT: ws.cell(r,3).fill=CAT[s["cat"]]
            ws.cell(r,4,("★ " if s["key"] else "")+s["title"])
            ws.cell(r,5,s["progRpe"] if s["progRpe"] is not None else "")
            ws.cell(r,6,s["sRPE"] if s["sRPE"] is not None else "")
            ws.cell(r,7,s["progDur"]); ws.cell(r,8,s["realDur"])
            ws.cell(r,9,f'{s["progDist"] or "—"} / {s["realDist"] or "—"}')
            ws.cell(r,10,s["targetPace"] or "—"); ws.cell(r,11,s["realPace"] or "—")
            c=ws.cell(r,12,s["source"]);
            if s["source"] in SRC: c.fill=SRC[s["source"]]
            ws.cell(r,13,s["comment"]); ws.cell(r,13).alignment=Alignment(wrap_text=True,vertical="top")
            if s["pain"]:
                for cc in range(1,14): ws.cell(r,cc).fill=PAINF
            for cc in range(1,14): ws.cell(r,cc).border=BORD
            r+=1
        r+=1

out="report/Renovacion.xlsx"; os.makedirs("report",exist_ok=True); wb.save(out); print("OK ->",out)
