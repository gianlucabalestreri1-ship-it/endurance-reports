#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Planilla de PLANIFICACIÓN por atleta — réplica del archivo modelo del coach.
3 pestañas: Ficha (perfil/intake + HISTORIAL DEPORTIVO) · Rendimiento (PRs por año +
registro de competencias desde TODOS los planes de ET) · Planificación (grilla de
periodización con código de color del manual: COMPETENCIA violeta, TEST verde,
HIT rojo, ThT amarillo, LIT azul). Lee un JSON {name,email,ficha,historial,competitions}
y escribe report/Planificacion-<name>.xlsx. Se sube a Drive convertido a Google Sheets.
Sin fórmulas. Campos que ET no tiene quedan vacíos (los carga el coach)."""
import json, sys, re
from datetime import date
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

data = json.load(open(sys.argv[1])) if len(sys.argv) > 1 else {"name":"Atleta","email":"","ficha":{}}
name = data.get("name","Atleta")
ficha = data.get("ficha",{})
historial = data.get("historial",{})
comps = data.get("competitions",[])

# paleta
PURPLE="674EA7"; MAUVE="C27BA0"; GREEN="6AA84F"; RED="E06666"; YELLOW="FFD966"; BLUE="6FA8DC"
DARK="1F3A5F"; LABF="EEF2F7"; INK="1A1F2B"
def fill(c): return PatternFill("solid", fgColor=c)
WHITEF=Font(color="FFFFFF", bold=True, size=11)
INKF=Font(color=INK, size=11)
BOLD=Font(bold=True, color=INK, size=11)
thin=Side(style="thin", color="B8C0CC"); BORD=Border(left=thin,right=thin,top=thin,bottom=thin)
CEN=Alignment(horizontal="center", vertical="center", wrap_text=True)
CEN1=Alignment(horizontal="center", vertical="center", wrap_text=False)   # sin ajuste (rótulos de 1 línea)
LEFT=Alignment(horizontal="left", vertical="center", wrap_text=True)

def dmy(s):
    try: return date.fromisoformat(s).strftime("%d/%m/%Y")
    except Exception: return s or ""

wb=Workbook()

# ================= PESTAÑA 1: FICHA =================
ws=wb.active; ws.title="Ficha"
ws.column_dimensions["A"].width=34; ws.column_dimensions["B"].width=72
CAMPOS=["NOMBRE Y APELLIDO","FECHA DE NACIMIENTO","SEXO","LUGAR DE RESIDENCIA",
"NÚMERO DE TELÉFONO","EMAIL","CONDICIÓN MÉDICA","LESIONES","MEDICACIÓN","CIRUGÍAS",
"FUMA/ALCOHOL","DIETA","HORAS DE SUEÑO","TRABAJO","EXPERIENCIA EN RUNNING",
"COMPETENCIAS QUE HA PARTICIPADO","EXPERIENCIA CON ENTRENADOR",
"¿PRACTICA OTRAS DISCIPLINAS A LA PAR?","MOTIVACIONES PARA ENTRENAR",
"DÍAS A LA SEMANA DISPONIBLES","CUANDO NO PUEDE ENTRENAR"]
LARGAS={"CONDICIÓN MÉDICA","DIETA","COMPETENCIAS QUE HA PARTICIPADO","MOTIVACIONES PARA ENTRENAR"}
# banda de sección (azul oscuro) igual que HISTORIAL DEPORTIVO
ws.merge_cells(start_row=1,start_column=1,end_row=1,end_column=2)
h0=ws.cell(1,1,"DATOS DEL DEPORTISTA"); h0.fill=fill(DARK); h0.font=WHITEF; h0.alignment=LEFT; h0.border=BORD
ws.cell(1,2).border=BORD
r=2
for campo in CAMPOS:
    lc=ws.cell(r,1,campo); lc.fill=fill(LABF); lc.font=BOLD; lc.alignment=LEFT; lc.border=BORD
    vc=ws.cell(r,2,ficha.get(campo,"")); vc.font=INKF; vc.alignment=LEFT; vc.border=BORD
    if campo in LARGAS: ws.row_dimensions[r].height=58
    r+=1
# --- HISTORIAL DEPORTIVO (banda azul oscuro, igual que DATOS DEL DEPORTISTA) ---
r+=1
ws.merge_cells(start_row=r,start_column=1,end_row=r,end_column=2)
hc=ws.cell(r,1,"HISTORIAL DEPORTIVO"); hc.fill=fill(DARK); hc.font=WHITEF; hc.alignment=LEFT; hc.border=BORD
ws.cell(r,2).border=BORD; r+=1
HIST=["Años Corriendo","Experiencia Previa (deportes)","Última Carrera y Ritmo",
"Volumen Promedio Semanal (km)","Entrenamientos Semanales Actuales (#)","KMS PICO (máx. semanal histórico)"]
for campo in HIST:
    lc=ws.cell(r,1,campo); lc.fill=fill(LABF); lc.font=BOLD; lc.alignment=LEFT; lc.border=BORD
    vc=ws.cell(r,2,historial.get(campo,"")); vc.font=INKF; vc.alignment=LEFT; vc.border=BORD
    r+=1

# ================= PESTAÑA 2: RENDIMIENTO =================
ws2=wb.create_sheet("Rendimiento")
cols2=["Año","Mejor 5K","Mejor 10K","Mejor 21K","Mejor 42K","Test de Milla",
"VO2 Max estimado","FCM","VT1","VT2","KMS PICO"]
for i,w in enumerate([12,12,12,12,12,13,14,10,10,10,12],1):
    ws2.column_dimensions[get_column_letter(i)].width=w
for i,h in enumerate(cols2,1):
    c=ws2.cell(1,i,h); c.fill=fill(PURPLE); c.font=WHITEF; c.alignment=CEN; c.border=BORD
# (filas de años en blanco: sin estilar, las completa el coach)
# ---- registro de competencias (desde TODOS los planes ET) ----
tr=8
ws2.merge_cells(start_row=tr,start_column=1,end_row=tr,end_column=6)
tc=ws2.cell(tr,1,"Registro de competencias (histórico Endurance Tool)")
tc.font=BOLD; tc.alignment=Alignment(horizontal="left",vertical="center"); tc.fill=fill(LABF)
for i in range(1,7): ws2.cell(tr,i).border=BORD
tr+=1
cols2b=["Fecha","Tiempo (mm:ss)","Ritmo (min/km)","Frecuencia cardíaca (med/max)","Condiciones","Carrera / Notas"]
for i,h in enumerate(cols2b,1):
    c=ws2.cell(tr,i,h); c.fill=fill(DARK); c.font=WHITEF; c.alignment=CEN; c.border=BORD
tr+=1
for c in comps:   # solo filas con datos reales (las vacías las agrega el coach)
    nota = c.get("name","")
    if c.get("km"): nota += f' · {c["km"]} km (Garmin)'
    if c.get("comment"): nota += f' · {c["comment"]}'
    vals=[dmy(c["date"]), c.get("time",""), c.get("pace",""),
          (f'{c.get("hr")}' if c.get("hr") else ""),
          (f'Prioridad {c.get("priority")}' if c.get("priority") else ""), nota]
    for i,v in enumerate(vals,1):
        cc=ws2.cell(tr,i,v)
        cc.alignment=(LEFT if i==6 else CEN); cc.font=INKF
    tr+=1

# ================= PESTAÑA 3: PLANIFICACIÓN =================
ws3=wb.create_sheet("Planificación")
NMC=28
ws3.column_dimensions["A"].width=19
for i in range(2,2+NMC): ws3.column_dimensions[get_column_letter(i)].width=4.6
# título (combinado para que no se apile vertical)
ws3.merge_cells(start_row=1,start_column=1,end_row=1,end_column=14)
tc=ws3.cell(1,1,"PLANTILLA PLANIFICACIÓN DEL ENTRENAMIENTO")
tc.font=Font(bold=True,size=13,color=INK); tc.alignment=Alignment(horizontal="left",vertical="center")
# objetivos (los carga el coach - NO inventar)
ws3.cell(3,1,"Objetivos").font=BOLD
for lab,row in [("Carrera objetivo:",4),("Objetivos generales:",5),("Objetivos específicos:",6),("Objetivos operativos:",7)]:
    c=ws3.cell(row,1,lab); c.font=Font(bold=True,size=10,color=INK); c.alignment=Alignment(horizontal="left",vertical="center")
r=9
def grid_label(row, text, bg=None, fg=INK):
    c=ws3.cell(row,1,text); c.font=Font(bold=True,size=10,color=fg); c.alignment=CEN1
    c.fill=fill(bg if bg else LABF); return c
def grid_cells(row, bg=None, vals=None):
    darkbg = bg in (PURPLE,MAUVE,GREEN,RED,DARK)
    for j in range(NMC):
        v=(vals[j] if vals and j<len(vals) else "")
        if not bg and not v:   # celda vacía y sin color → no la escribimos (ahorra XML)
            continue
        c=ws3.cell(row,2+j,v); c.alignment=CEN
        c.font=Font(size=8, color=("FFFFFF" if darkbg else INK))
        if bg: c.fill=fill(bg)
grid_label(r,"PERÍODO", PURPLE, "FFFFFF"); grid_cells(r, PURPLE); r+=1
grid_label(r,"MESOCICLO"); grid_cells(r); r+=1
grid_label(r,"OBJETIVO (END/LT/VO2/RP)"); grid_cells(r); ws3.row_dimensions[r].height=26; r+=1
grid_label(r,"MICROCICLO"); grid_cells(r, vals=[str(i) for i in range(1,NMC+1)]); r+=1
grid_label(r,"KILÓMETROS"); grid_cells(r); r+=1
METHODS=[("COMPETENCIA",MAUVE,"FFFFFF"),("TEST",GREEN,"FFFFFF"),
("SPRINT",RED,"FFFFFF"),("GLUCOLÍTICA",RED,"FFFFFF"),("VO2MAX",RED,"FFFFFF"),
("SUPRAUMBRAL",RED,"FFFFFF"),("UMBRAL",YELLOW,INK),("TEMPO",YELLOW,INK),
("ENDURANCE",BLUE,INK),("RECUPERACIÓN",BLUE,INK)]
for lab,bg,fg in METHODS:
    grid_label(r,lab,bg,fg); grid_cells(r,bg); r+=1
grid_label(r,"COMENTARIOS"); grid_cells(r); ws3.row_dimensions[r].height=30; r+=1

out=f"report/Planificacion-{re.sub(r'[^A-Za-z0-9 ]','',name).strip()}.xlsx"
wb.save(out)

# --- post-proceso: achicar el xlsx (theme mínimo + recompresión máx) para que
#     el base64 entre en una subida inline al connector de Drive ---
import zipfile, os
_MIN_THEME='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="t"><a:themeElements><a:clrScheme name="t"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F3A5F"/></a:dk2><a:lt2><a:srgbClr val="EEEEEE"/></a:lt2><a:accent1><a:srgbClr val="674EA7"/></a:accent1><a:accent2><a:srgbClr val="6AA84F"/></a:accent2><a:accent3><a:srgbClr val="E06666"/></a:accent3><a:accent4><a:srgbClr val="FFD966"/></a:accent4><a:accent5><a:srgbClr val="6FA8DC"/></a:accent5><a:accent6><a:srgbClr val="C27BA0"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="t"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="t"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>'
_zin=zipfile.ZipFile(out); _members=[(it.filename, _zin.read(it.filename)) for it in _zin.infolist()]; _zin.close()
with zipfile.ZipFile(out,"w",zipfile.ZIP_DEFLATED,compresslevel=9) as _zout:
    for fn,data in _members:
        if fn=="xl/theme/theme1.xml": data=_MIN_THEME.encode("utf-8")
        _zout.writestr(fn, data)
import base64 as _b64
print("OK ->", out, "|", os.path.getsize(out), "bytes |", len(_b64.b64encode(open(out,"rb").read())), "base64 chars")
