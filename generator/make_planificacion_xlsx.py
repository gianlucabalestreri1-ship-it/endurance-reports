#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Planilla de PLANIFICACIÓN por atleta — réplica del archivo modelo del coach.
3 pestañas: Ficha (perfil/intake) · Rendimiento (PRs + competencias) · Planificación
(grilla de periodización con código de color del manual: COMPETENCIA violeta, TEST verde,
HIT rojo, ThT amarillo, LIT azul). Lee un JSON {name,email,ficha:{...}} y escribe
report/Planificacion-<name>.xlsx. Se sube a Drive convertido a Google Sheets.
Sin fórmulas. Campos que ET no tiene quedan vacíos (los carga el coach)."""
import json, sys, re
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

data = json.load(open(sys.argv[1])) if len(sys.argv) > 1 else {"name":"Atleta","email":"","ficha":{}}
name = data.get("name","Atleta")
ficha = data.get("ficha",{})

# paleta
PURPLE="674EA7"; MAUVE="C27BA0"; GREEN="6AA84F"; RED="E06666"; YELLOW="FFD966"; BLUE="6FA8DC"
DARK="1F3A5F"; LABF="EEF2F7"; INK="1A1F2B"
def fill(c): return PatternFill("solid", fgColor=c)
WHITEF=Font(color="FFFFFF", bold=True, size=11)
INKF=Font(color=INK, size=11)
BOLD=Font(bold=True, color=INK, size=11)
thin=Side(style="thin", color="B8C0CC"); BORD=Border(left=thin,right=thin,top=thin,bottom=thin)
CEN=Alignment(horizontal="center", vertical="center", wrap_text=True)
LEFT=Alignment(horizontal="left", vertical="center", wrap_text=True)

wb=Workbook()

# ================= PESTAÑA 1: FICHA =================
ws=wb.active; ws.title="Ficha"
ws.column_dimensions["A"].width=34; ws.column_dimensions["B"].width=70
CAMPOS=["NOMBRE Y APELLIDO","FECHA DE NACIMIENTO","SEXO","LUGAR DE RESIDENCIA",
"NÚMERO DE TELÉFONO","EMAIL","CONDICIÓN MÉDICA","LESIONES","MEDICACIÓN","CIRUGÍAS",
"FUMA/ALCOHOL","DIETA","HORAS DE SUEÑO","TRABAJO","EXPERIENCIA EN RUNNING",
"COMPETENCIAS QUE HA PARTICIPADO","EXPERIENCIA CON ENTRENADOR",
"¿PRACTICA OTRAS DISCIPLINAS A LA PAR?","MOTIVACIONES PARA ENTRENAR",
"DÍAS A LA SEMANA DISPONIBLES","CUANDO NO PUEDE ENTRENAR"]
r=1
for campo in CAMPOS:
    lc=ws.cell(r,1,campo); lc.fill=fill(LABF); lc.font=BOLD; lc.alignment=LEFT; lc.border=BORD
    val=ficha.get(campo,"")
    vc=ws.cell(r,2,val); vc.font=INKF; vc.alignment=LEFT; vc.border=BORD
    # filas con texto largo: alto mayor
    if campo in ("CONDICIÓN MÉDICA","DIETA","COMPETENCIAS QUE HA PARTICIPADO","MOTIVACIONES PARA ENTRENAR"):
        ws.row_dimensions[r].height=58
    r+=1

# ================= PESTAÑA 2: RENDIMIENTO =================
ws2=wb.create_sheet("Rendimiento")
cols2=["Año","Mejor 5K","Mejor 10K","Mejor 21K","Mejor 42K","Test de Milla",
"VO2 Max estimado","FCM","VT1","VT2","KMS PICO"]
for i,w in enumerate([10,12,12,12,12,13,14,10,10,10,12],1):
    ws2.column_dimensions[get_column_letter(i)].width=w
for i,h in enumerate(cols2,1):
    c=ws2.cell(1,i,h); c.fill=fill(PURPLE); c.font=WHITEF; c.alignment=CEN; c.border=BORD
for rr in range(2,7):   # filas de años en blanco
    for i in range(1,len(cols2)+1):
        c=ws2.cell(rr,i,""); c.border=BORD; c.alignment=CEN
# registro de competencias anual
tr=8
tc=ws2.cell(tr,1,"Registro de competencias anual (AÑO: X)"); tc.font=BOLD; tc.alignment=LEFT
tr+=1
cols2b=["Fecha","Tiempo (mm:ss)","Ritmo (min/km)","Frecuencia cardíaca (med/max)","Condiciones","Notas"]
for i,h in enumerate(cols2b,1):
    c=ws2.cell(tr,i,h); c.fill=fill(DARK); c.font=WHITEF; c.alignment=CEN; c.border=BORD
for rr in range(tr+1, tr+13):
    for i in range(1,len(cols2b)+1):
        c=ws2.cell(rr,i,""); c.border=BORD; c.alignment=CEN

# ================= PESTAÑA 3: PLANIFICACIÓN =================
ws3=wb.create_sheet("Planificación")
NMC=28
ws3.column_dimensions["A"].width=16
for i in range(2,2+NMC): ws3.column_dimensions[get_column_letter(i)].width=4.5
# título
tc=ws3.cell(1,2,"PLANTILLA PLANIFICACIÓN DEL ENTRENAMIENTO"); tc.font=Font(bold=True,size=12,color=INK); tc.alignment=LEFT
# objetivos (los carga el coach - NO inventar)
ws3.cell(3,1,"Objetivos").font=BOLD
for lab,row in [("Carrera objetivo:",4),("Objetivos generales:",5),("Objetivos específicos:",6),("Objetivos operativos:",7)]:
    c=ws3.cell(row,1,lab); c.font=Font(bold=True,size=10,color=INK); c.alignment=LEFT
r=9
def grid_label(row, text, bg=None, fg=INK):
    c=ws3.cell(row,1,text); c.font=Font(bold=True,size=10,color=fg); c.alignment=CEN; c.border=BORD
    if bg: c.fill=fill(bg)
    else: c.fill=fill(LABF)
    return c
def grid_cells(row, bg=None, vals=None):
    for j in range(NMC):
        v=(vals[j] if vals and j<len(vals) else "")
        c=ws3.cell(row,2+j,v); c.alignment=CEN; c.border=BORD
        c.font=Font(size=8, color=("FFFFFF" if bg in (PURPLE,MAUVE,GREEN,RED,DARK) else INK))
        if bg: c.fill=fill(bg)
# PERÍODO
grid_label(r,"PERÍODO", PURPLE, "FFFFFF"); grid_cells(r, PURPLE); r+=1
# MESOCICLO (meses - en blanco)
grid_label(r,"MESOCICLO"); grid_cells(r); r+=1
# OBJETIVO
grid_label(r,"OBJETIVO\n(END/LT/VO2/RP)"); grid_cells(r); ws3.row_dimensions[r].height=28; r+=1
# MICROCICLO 1..28
grid_label(r,"MICROCICLO"); grid_cells(r, vals=[str(i) for i in range(1,NMC+1)]); r+=1
# KILÓMETROS
grid_label(r,"KILÓMETROS"); grid_cells(r); r+=1
# filas método (coloreadas)
METHODS=[("COMPETENCIA",MAUVE,"FFFFFF"),("TEST",GREEN,"FFFFFF"),
("SPRINT",RED,"FFFFFF"),("GLUCOLÍTICA",RED,"FFFFFF"),("VO2MAX",RED,"FFFFFF"),
("SUPRAUMBRAL",RED,"FFFFFF"),("UMBRAL",YELLOW,INK),("TEMPO",YELLOW,INK),
("ENDURANCE",BLUE,INK),("RECUPERACIÓN",BLUE,INK)]
for lab,bg,fg in METHODS:
    grid_label(r,lab,bg,fg); grid_cells(r,bg); r+=1
# COMENTARIOS
grid_label(r,"COMENTARIOS"); grid_cells(r); ws3.row_dimensions[r].height=30; r+=1

out=f"report/Planificacion-{re.sub(r'[^A-Za-z0-9 ]','',name).strip()}.xlsx"
wb.save(out); print("OK ->", out)
