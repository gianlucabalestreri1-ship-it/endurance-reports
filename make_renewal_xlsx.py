#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Informe de RENOVACIÓN — un único Excel con una pestaña por atleta.
UX comprimido: 1 fila por sesión, con "Resumen de la sesión" (integrador) +
"Detalles de la sesión" (laps del dispositivo). Lee report/renewal-<plan>-data.json.
Texto ajustado, alineado al medio. Sin fórmulas."""
import json, sys, re
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

files = sys.argv[1:]
if not files:
    print("uso: make_renewal_xlsx.py report/renewal-<id>-data.json ..."); sys.exit(1)
plans = [json.load(open(f)) for f in files]
def _adh(d):
    tot=sum(m["progSessions"] for m in d["micros"]); done=sum(m["doneSessions"] for m in d["micros"])
    return (done/tot) if tot else 0
plans.sort(key=_adh)

INK="1A1F2B"; MUT="5B6472"
HEADER=PatternFill("solid",fgColor="1F3A5F"); HEADERF=Font(color="FFFFFF",bold=True,size=11)
SOFT=PatternFill("solid",fgColor="EEF2F7"); GAP=PatternFill("solid",fgColor="FBE3E3")
OKC=PatternFill("solid",fgColor="E7F6EE"); WARN=PatternFill("solid",fgColor="FDF3E6")
TITLEF=Font(bold=True,size=15,color=INK); SUBF=Font(italic=True,size=10,color=MUT); H2F=Font(bold=True,size=12,color="1F3A5F"); BOLD=Font(bold=True,color=INK)
thin=Side(style="thin",color="D8DEE8"); BORD=Border(left=thin,right=thin,top=thin,bottom=thin)
CAT={"LIT":PatternFill("solid",fgColor="D8E7FB"),"ThT":PatternFill("solid",fgColor="FBF0CE"),"HIT":PatternFill("solid",fgColor="F8D8D8")}
PAINF=PatternFill("solid",fgColor="FBE3E3"); DETF=PatternFill("solid",fgColor="F4F7FB")
CEN=Alignment(horizontal="center",vertical="center",wrap_text=True)
LEFT=Alignment(horizontal="left",vertical="center",wrap_text=True)

def adh_fill(p): return OKC if p>=70 else (WARN if p>=50 else GAP)
def sh(ws,r,n):
    for c in range(1,n+1):
        x=ws.cell(r,c); x.fill=HEADER; x.font=HEADERF; x.border=BORD; x.alignment=CEN
def W(ws,ws_w):
    for i,w in enumerate(ws_w,1): ws.column_dimensions[get_column_letter(i)].width=w
def safe_title(name, used):
    t="".join(ch for ch in name if ch not in '[]:*?/\\')[:28] or "Atleta"
    base=t; i=2
    while t in used: t=f"{base[:25]}~{i}"; i+=1
    used.add(t); return t

def pace_sec(p):
    m=re.search(r"(\d+)'(\d+)", p or ""); return int(m.group(1))*60+int(m.group(2)) if m else 9999

def work_paces(laps):
    """Ritmo real de los tramos de carrera (descarta WU/CD y pausas). Aproximado."""
    if not laps: return ""
    core = laps[1:-1] if len(laps) > 2 else laps
    segs=[]
    for L in core:
        p=(L.get("pace") or "")
        if "h" in p: continue                       # pausas/descansos (ritmo absurdo)
        if L.get("distKm",0) < 0.4: continue         # tramos muy cortos
        if pace_sec(p) > 10*60: continue             # caminando
        segs.append(p.replace(" ",""))
    uniq=sorted(set(segs), key=pace_sec)
    if not uniq: return ""
    return uniq[0] + (f"–{uniq[-1]}" if len(uniq)>1 else "")

def resumen_sesion(s):
    L=[]
    L.append(("★ " if s.get("key") else "")+ (s.get("title") or ""))
    rpe = []
    if s.get("progRpe") is not None: rpe.append(f'RPE prog {s["progRpe"]}')
    if s.get("sRPE") is not None: rpe.append(f'sRPE {s["sRPE"]}')
    if rpe: L.append(" · ".join(rpe))
    dur = f'Dur: {s.get("progDur") or "—"}'
    if s.get("realDur"): dur += f' → {s["realDur"]}'
    L.append(dur)
    dist = s.get("realDist") or s.get("progDist")
    if dist: L.append(f'Dist: {dist}')
    # objetivo por bloque (ritmos únicos)
    tp = [t["target"] for t in (s.get("targets") or []) if t.get("target")]
    seen=[]; [seen.append(x) for x in tp if x not in seen]
    if seen: L.append("Objetivo: " + " · ".join(seen[:4]))
    elif s.get("targetPace"): L.append("Objetivo: " + s["targetPace"])
    # real de los bloques
    if s.get("source")=="FIT":
        wp=work_paces(s.get("laps") or [])
        if wp: L.append("Real (tramos): " + wp)
    elif s.get("realPace"):
        L.append("Real: " + s["realPace"])
    return "\n".join(L)

def detalles_laps(s):
    laps = s.get("laps") or []
    if laps:
        out=["Lap · Tiempo · Dist · Ritmo · FC(med/máx)"]
        for L in laps:
            out.append(f'{L["n"]:>2} · {L["time"]:>6} · {L["distKm"]:.2f}km · {(L.get("pace") or "").replace(" ","")} · {L.get("hrA","")}/{L.get("hrM","")}')
        return "\n".join(out)
    if s.get("future"): return "(sesión futura)"
    if s.get("source") in ("manual","comentario","manual+coment."):
        return "Sin dispositivo — ritmos del comentario:\n" + (s.get("realPace") or "—")
    return "sin datos de dispositivo"

wb=Workbook(); used=set()

# ---- Resumen ----
ws=wb.active; ws.title="Resumen"
ws["A1"]="Informe de renovación"; ws["A1"].font=TITLEF
ws["A2"]=f"{len(plans)} atleta(s) · último mesociclo del plan vigente · adherencia sobre sesiones vencidas · generado {plans[0].get('generatedAt','')}"; ws["A2"].font=SUBF
W(ws,[26,30,16,13,12,36]); r=4
for i,h in enumerate(["Atleta","Plan","Período","Adherencia","Sesiones","Nota"],1): ws.cell(r,i,h)
sh(ws,r,6); r+=1
for d in plans:
    tot=sum(m["progSessions"] for m in d["micros"]); done=sum(m["doneSessions"] for m in d["micros"])
    adh=round(100*done/tot) if tot else 0
    nota = "Sin ejecución en el período (lesión/inactividad/sin reporte)" if done==0 else ("Adherencia baja (<70%)" if adh<70 else "Adherencia buena")
    ws.cell(r,1,d["athlete"]).alignment=LEFT; ws.cell(r,2,d["plan"]["title"]).alignment=LEFT
    ws.cell(r,3," + ".join(str(x) for x in d["periodMesos"])).alignment=CEN
    c=ws.cell(r,4,f"{adh}%"); c.fill=adh_fill(adh); c.alignment=CEN
    ws.cell(r,5,f"{done}/{tot}").alignment=CEN; ws.cell(r,6,nota).alignment=LEFT
    for cc in range(1,7): ws.cell(r,cc).border=BORD
    r+=1
for rr in range(1,3):
    ws.cell(rr,1).alignment=LEFT

# ---- una pestaña por atleta ----
for d in plans:
    ws=wb.create_sheet(safe_title(d["athlete"], used))
    p=d["plan"]
    ws["A1"]=d["athlete"]; ws["A1"].font=TITLEF; ws["A1"].alignment=LEFT
    ws["A2"]=f'{p["title"]} · {p["start"]} → {p["end"]} · {p["status"]} · período: {" + ".join(str(x) for x in d["periodMesos"])}'; ws["A2"].font=SUBF; ws["A2"].alignment=LEFT
    W(ws,[12,7,46,44,40]); r=4
    for m in d["micros"]:
        ws.cell(r,1,f'Microciclo {m["number"]}').font=H2F
        ws.cell(r,3,f'{m["start"]} → {m["end"]}  ·  {m["doneSessions"]}/{m["progSessions"]} ses.').font=SUBF
        c=ws.cell(r,2,f'{m["adherence"]}%'); c.fill=adh_fill(m["adherence"]); c.font=BOLD; c.alignment=CEN
        r+=1
        for i,h in enumerate(["Fecha","Tipo","Resumen de la sesión","Detalles de la sesión (laps)","Comentario / feedback"],1): ws.cell(r,i,h)
        sh(ws,r,5); r+=1
        for s in m["sessions"]:
            ws.cell(r,1,f'{s["date"]}\n{s["moment"]}').alignment=CEN
            ws.cell(r,2,s["cat"]).alignment=CEN
            if s["cat"] in CAT: ws.cell(r,2).fill=CAT[s["cat"]]
            ws.cell(r,3,resumen_sesion(s)).alignment=LEFT
            dc=ws.cell(r,4,detalles_laps(s)); dc.alignment=LEFT; dc.fill=DETF; dc.font=Font(size=9)
            ws.cell(r,5,s.get("comment") or "").alignment=LEFT
            if s.get("pain"):
                for cc in range(1,6): ws.cell(r,cc).fill=PAINF
            for cc in range(1,6): ws.cell(r,cc).border=BORD
            r+=1
        r+=1

out="report/Renovacion.xlsx"; wb.save(out); print("OK ->",out)
