#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Genera los payloads para el connector Google Sheets (nativo) a partir de un
JSON de datos de atleta (planifdata-<id>.json). Escribe 3 archivos:
  <out>.setup.json   -> requests para update_spreadsheet (renombrar/crear pestañas)
  <out>.values.json  -> lista de {range, values} para update_values (texto)
  <out>.format.json  -> requests para update_spreadsheet (anchos, merges, colores, negrita)
Pestañas: 0=Ficha, 1=Rendimiento, 2=Planificación. Sin fórmulas."""
import json, sys
from datetime import date
d = json.load(open(sys.argv[1]))
out = sys.argv[2]

def rgb(h): return {"red":round(int(h[0:2],16)/255,3),"green":round(int(h[2:4],16)/255,3),"blue":round(int(h[4:6],16)/255,3)}
DARK=rgb("1F3A5F"); LABF=rgb("EEF2F7"); PURPLE=rgb("674EA7"); MAUVE=rgb("C27BA0")
GREEN=rgb("6AA84F"); RED=rgb("E06666"); YELLOW=rgb("FFD966"); BLUE=rgb("6FA8DC")
WHITE=rgb("FFFFFF"); INK=rgb("1A1F2B")
def dmy(s):
    try: return date.fromisoformat(s).strftime("%d/%m/%Y")
    except Exception: return s or ""
def gr(sid,r0,r1,c0,c1): return {"sheetId":sid,"startRowIndex":r0,"endRowIndex":r1,"startColumnIndex":c0,"endColumnIndex":c1}
def fill(sid,r0,r1,c0,c1,color,bold=None,fontcolor=None,size=None,align=None):
    fmt={"backgroundColorStyle":{"rgbColor":color}}
    tf={}
    if bold is not None: tf["bold"]=bold
    if fontcolor is not None: tf["foregroundColorStyle"]={"rgbColor":fontcolor}
    if size is not None: tf["fontSize"]=size
    if tf: fmt["textFormat"]=tf
    if align: fmt["horizontalAlignment"]=align
    fmt["verticalAlignment"]="MIDDLE"; fmt["wrapStrategy"]="WRAP"
    return {"repeatCell":{"range":gr(sid,r0,r1,c0,c1),"cell":{"userEnteredFormat":fmt},"fields":"userEnteredFormat"}}
def merge(sid,r0,r1,c0,c1): return {"mergeCells":{"range":gr(sid,r0,r1,c0,c1),"mergeType":"MERGE_ALL"}}
def colw(sid,c0,c1,px): return {"updateDimensionProperties":{"range":{"sheetId":sid,"dimension":"COLUMNS","startIndex":c0,"endIndex":c1},"properties":{"pixelSize":px},"fields":"pixelSize"}}

# ---------- SETUP ----------
setup=[
  {"updateSheetProperties":{"properties":{"sheetId":0,"title":"Ficha","gridProperties":{"rowCount":40,"columnCount":4}},"fields":"title,gridProperties"}},
  {"addSheet":{"properties":{"sheetId":1,"title":"Rendimiento","gridProperties":{"rowCount":40,"columnCount":12}}}},
  {"addSheet":{"properties":{"sheetId":2,"title":"Planificación","gridProperties":{"rowCount":30,"columnCount":30}}}},
]

# ---------- FICHA ----------
CAMPOS=["NOMBRE Y APELLIDO","FECHA DE NACIMIENTO","SEXO","LUGAR DE RESIDENCIA",
"NÚMERO DE TELÉFONO","EMAIL","CONDICIÓN MÉDICA","LESIONES","MEDICACIÓN","CIRUGÍAS",
"FUMA/ALCOHOL","DIETA","HORAS DE SUEÑO","TRABAJO","EXPERIENCIA EN RUNNING",
"COMPETENCIAS QUE HA PARTICIPADO","EXPERIENCIA CON ENTRENADOR",
"¿PRACTICA OTRAS DISCIPLINAS A LA PAR?","MOTIVACIONES PARA ENTRENAR",
"DÍAS A LA SEMANA DISPONIBLES","CUANDO NO PUEDE ENTRENAR"]
ficha=d.get("ficha",{})
HIST=["Años Corriendo","Experiencia Previa (deportes)","Última Carrera y Ritmo",
"Volumen Promedio Semanal (km)","Entrenamientos Semanales Actuales (#)","KMS PICO (máx. semanal histórico)"]
historial=d.get("historial",{})
# valores Ficha (col A labels, col B values) — fila 0 banner, filas 1..21 campos, fila 22 banner HIST, 23..28 hist
fvals=[["DATOS DEL DEPORTISTA",""]]
for c in CAMPOS: fvals.append([c, ficha.get(c,"")])
fvals.append(["HISTORIAL DEPORTIVO",""])
for c in HIST: fvals.append([c, historial.get(c,"")])

# ---------- RENDIMIENTO ----------
pr_hdr=["Año","Mejor 5K","Mejor 10K","Mejor 21K","Mejor 42K","Test de Milla","VO2 Max estimado","FCM","VT1","VT2","KMS PICO"]
comp_hdr=["Fecha","Tiempo (mm:ss)","Ritmo (min/km)","Frecuencia cardíaca (med/max)","Condiciones","Carrera / Notas"]
comps=d.get("competitions",[])
comp_rows=[]
for c in comps:
    nota=c.get("name","")
    if c.get("km"): nota+=f' · {c["km"]} km (Garmin)'
    comp_rows.append([dmy(c.get("date","")), c.get("time",""), c.get("pace",""),
                      (str(c.get("hr")) if c.get("hr") else ""),
                      (f'Prioridad {c.get("priority")}' if c.get("priority") else ""), nota])

# ---------- PLANIFICACIÓN ----------
NMC=28
METHODS=[("COMPETENCIA",MAUVE,WHITE),("TEST",GREEN,WHITE),("SPRINT",RED,WHITE),
("GLUCOLÍTICA",RED,WHITE),("VO2MAX",RED,WHITE),("SUPRAUMBRAL",RED,WHITE),
("UMBRAL",YELLOW,INK),("TEMPO",YELLOW,INK),("ENDURANCE",BLUE,INK),("RECUPERACIÓN",BLUE,INK)]
# filas: 0 título, 2 Objetivos, 3-6 obj labels, 8 PERÍODO,9 MESOCICLO,10 OBJETIVO,11 MICROCICLO,12 KILÓMETROS,13-22 métodos,23 COMENTARIOS

# ---------- VALUES ----------
values=[
  {"range":"Ficha!A1","values":fvals},
  {"range":"Rendimiento!A1","values":[pr_hdr]},
  {"range":"Rendimiento!A8","values":[["Registro de competencias (histórico Endurance Tool)"]]},
  {"range":"Rendimiento!A9","values":[comp_hdr]+comp_rows},
  {"range":"Planificación!A1","values":[["PLANTILLA PLANIFICACIÓN DEL ENTRENAMIENTO"]]},
  {"range":"Planificación!A3","values":[["Objetivos"],["Carrera objetivo:"],["Objetivos generales:"],["Objetivos específicos:"],["Objetivos operativos:"]]},
  {"range":"Planificación!A9","values":[["PERÍODO"],["MESOCICLO"],["OBJETIVO (END/LT/VO2/RP)"],["MICROCICLO"],["KILÓMETROS"]]},
  {"range":"Planificación!B12","values":[[str(i) for i in range(1,NMC+1)]]},
  {"range":"Planificación!A14","values":[[m[0]] for m in METHODS]+[["COMENTARIOS"]]},
]

# ---------- FORMAT ----------
fmt=[]
# Ficha widths + banners + labels
fmt+=[colw(0,0,1,240), colw(0,1,2,520)]
fmt+=[merge(0,0,1,0,2), fill(0,0,1,0,2,DARK,bold=True,fontcolor=WHITE,align="LEFT")]
fmt+=[fill(0,1,22,0,1,LABF,bold=True,fontcolor=INK,align="LEFT")]      # labels campos
fmt+=[merge(0,22,23,0,2), fill(0,22,23,0,2,DARK,bold=True,fontcolor=WHITE,align="LEFT")]
fmt+=[fill(0,23,29,0,1,LABF,bold=True,fontcolor=INK,align="LEFT")]      # labels hist
# Rendimiento
for i,w in enumerate([90,80,80,80,80,90,110,70,70,70,90]): fmt.append(colw(1,i,i+1,w))
fmt+=[fill(1,0,1,0,11,PURPLE,bold=True,fontcolor=WHITE,align="CENTER")]
fmt+=[merge(1,7,8,0,6), fill(1,7,8,0,6,LABF,bold=True,fontcolor=INK,align="LEFT")]
fmt+=[fill(1,8,9,0,6,DARK,bold=True,fontcolor=WHITE,align="CENTER")]
# Planificación widths
fmt+=[colw(2,0,1,150), colw(2,1,1+NMC,34)]
fmt+=[merge(2,0,1,0,14)]
fmt.append({"repeatCell":{"range":gr(2,0,1,0,14),"cell":{"userEnteredFormat":{"textFormat":{"bold":True,"fontSize":13},"verticalAlignment":"MIDDLE"}},"fields":"userEnteredFormat"}})
fmt+=[fill(2,2,7,0,1,WHITE,bold=True,fontcolor=INK,align="LEFT")]
# PERÍODO band
fmt+=[fill(2,8,9,0,1,PURPLE,bold=True,fontcolor=WHITE,align="CENTER"), fill(2,8,9,1,1+NMC,PURPLE)]
# labels MESOCICLO/OBJETIVO/MICROCICLO/KILÓMETROS (gris)
fmt+=[fill(2,9,13,0,1,LABF,bold=True,fontcolor=INK,align="CENTER")]
fmt.append(fill(2,11,12,1,1+NMC,WHITE,align="CENTER",size=8))  # microciclo numbers centered
# method rows
for idx,(lab,bg,fg) in enumerate(METHODS):
    r=13+idx
    fmt.append(fill(2,r,r+1,0,1,bg,bold=True,fontcolor=fg,align="CENTER"))
    fmt.append(fill(2,r,r+1,1,1+NMC,bg))
# COMENTARIOS label
fmt.append(fill(2,23,24,0,1,LABF,bold=True,fontcolor=INK,align="CENTER"))

json.dump(setup, open(out+".setup.json","w"))
json.dump(values, open(out+".values.json","w"), ensure_ascii=False)
json.dump(fmt, open(out+".format.json","w"))
print("setup reqs",len(setup),"| values blocks",len(values),"| format reqs",len(fmt))
import os
for s in (".setup.json",".values.json",".format.json"): print(" ",out+s, os.path.getsize(out+s),"bytes")
