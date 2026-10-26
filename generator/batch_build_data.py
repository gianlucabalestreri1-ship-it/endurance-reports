#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Arma los datos de cada atleta del lote para el método plantilla+copia.
Salida: report/batch-build.json = [{name,title,folderId,ficha_B[29],comp_rows[],renewal}]"""
import json, re, unicodedata, glob
from datetime import date
def norm(s):
    s=unicodedata.normalize("NFD",s or "").encode("ascii","ignore").decode().lower();return " ".join(s.split())
def tok(s): return [t for t in re.split(r"[^a-z0-9]+",norm(s)) if t]
def match(name, recs, key=lambda r:r["name"]):
    bt=tok(name);best=None;bs=0
    for r in recs:
        s=sum(1 for x in bt if any(x==y or (len(x)>=3 and len(y)>=3 and (x.startswith(y) or y.startswith(x))) for y in tok(key(r))))
        if s>bs:bs=s;best=r
    return best if bs>=2 else None
def dmy(iso):
    try: return date.fromisoformat(iso).strftime("%d/%m/%Y")
    except: return iso or ""
CAMPOS=["NOMBRE Y APELLIDO","FECHA DE NACIMIENTO","SEXO","LUGAR DE RESIDENCIA","NÚMERO DE TELÉFONO","EMAIL",
"CONDICIÓN MÉDICA","LESIONES","MEDICACIÓN","CIRUGÍAS","FUMA/ALCOHOL","DIETA","HORAS DE SUEÑO","TRABAJO",
"EXPERIENCIA EN RUNNING","COMPETENCIAS QUE HA PARTICIPADO","EXPERIENCIA CON ENTRENADOR",
"¿PRACTICA OTRAS DISCIPLINAS A LA PAR?","MOTIVACIONES PARA ENTRENAR","DÍAS A LA SEMANA DISPONIBLES","CUANDO NO PUEDE ENTRENAR"]
HIST=["Años Corriendo","Experiencia Previa (deportes)","Última Carrera y Ritmo","Volumen Promedio Semanal (km)","Entrenamientos Semanales Actuales (#)","KMS PICO (máx. semanal histórico)"]
ets=[json.load(open(f)) for f in glob.glob("report/planifdata-*.json")]
intake=list(json.load(open("report/intake-data.json")).values())
forms=list(json.load(open("report/form-responses.json")).values())
ATH=[
("Gianluca Balestreri","Gianluca Balestreri - Planificación 2026","1cARv7u4s62fhi9mUAp-NgOAG1P9Mis0k"),
("Barbara Gervazoni","Barbara Gervazoni - Planificación 2026","1P9a-h__Sa5gr9XZxTHLuyDg2AntcqgFV"),
("Verónica Nievas","Verónica Nievas - Planificación 2026","1lkwtpJewHI8kAT20XluB3wjk2v0DH4gq"),
("Ivan Vazquez","Ivan Vazquez - Planificación 2026","1VLUsq3fjyFw3yeE291WlL0mTtGgHoJO4"),
("Larisa Campana","Larisa Campana - Planificación 2026","1NfODx0v_LJS93Yy4NEKzCO8c2It7lzz4"),
("Paulina Luna","Paulina Luna - Planificación 2026","18YTSJ59d6nuQlCDQjPEHOJ15wEZ_W8bW"),
("Eliana Rebagliatti","Eliana Rebagliatti - Planificación 2026","1mTf96OvimtI-UxXDpFYapDiWRojKMdol"),
("Maite Aleratti","Maite Aleratti - Planificación 2026","1CmjjFc0M48CAK8RxnarDCd7dw36A0CP8"),
("Susana Torres","Susana Torres - Planificación 2026","1bngxyWWivUjLfIRk0hDrVD6Ykva3aojv"),
("Ana Gomez","Ana Gómez - Planificación 2026","16ZlNvXwNNfEWuMJx5HeExXWnlPGxwae9"),
("Milagros Baruffaldi","Milagros Baruffaldi - Planificación 2026","1inAE7HWgWLcFwBJE7Wi0fG05jIsITIN-"),
("Giana Barchiesi","Giana Barchiesi - Planificación 2026","1TwvKBKrT9yurK8FhlAnnsYwfY6zxiYl7"),
("Cristian Albornoz","Cristian Albornoz - Planificación 2026","1shD1KwV18X_4rzFky8TTFpnBFB0mXT8i"),
("Leandro Schulman","Leandro Schulman - Planificación 2026","12gQPuvWGRLRm3EcvYXIr3_Gq0JqHYIAu"),
("Leandro Barbona","Leandro Barbona - Planificación 2026","1jYFGj2pEnO8aet0rlukJR4BlpKvWrNHc"),
("Soledad De Marco","Soledad De Marco - Planificación 2026","1eLz6TEyJLox5CmilrQKHIcU1BjPONdL_"),
]
out=[]
for q,title,fid in ATH:
    et=match(q,ets); ik=match(q,intake); rn=match(q,forms)
    ficha=dict(ik["ficha"]) if ik else {}
    if ficha.get("NOMBRE Y APELLIDO"): ficha["NOMBRE Y APELLIDO"]=ficha["NOMBRE Y APELLIDO"].title()
    hist={}
    if ik and ik.get("años_corriendo"): hist["Años Corriendo"]=ik["años_corriendo"]
    if et:
        lr=et.get("lastRace")
        if lr:
            u=f'{lr["name"]} ({dmy(lr["date"])})'
            if lr.get("km"): u+=f' · {lr["km"]} km · {lr.get("time","")} · {lr.get("pace","")}'
            hist["Última Carrera y Ritmo"]=u
        if et.get("avgRecentKm"): hist["Volumen Promedio Semanal (km)"]=f'≈ {round(et["avgRecentKm"])} km (prom. ~12 sem, Garmin)'
        if et.get("avgSessionsPerWeek"): hist["Entrenamientos Semanales Actuales (#)"]=f'≈ {et["avgSessionsPerWeek"]}'
        if et.get("maxWeekKm"): hist["KMS PICO (máx. semanal histórico)"]=f'{et["maxWeekKm"]} km (sem. {dmy(et.get("maxWeekOn",""))})'
    # columna B (29 filas)
    B=[""]+[ficha.get(c,"") for c in CAMPOS]+[""]+[hist.get(c,"") for c in HIST]
    # comp rows
    comp_rows=[]
    for c in (et or {}).get("competitions",[]):
        nota=c.get("name","")
        if c.get("comment"): nota+=f' · {c["comment"]}'
        comp_rows.append([dmy(c.get("date","")),(f'{c["km"]} km' if c.get("km") else ""),c.get("time",""),c.get("pace",""),(str(c.get("hr")) if c.get("hr") else ""),(f'Prioridad {c.get("priority")}' if c.get("priority") else ""),nota])
    renewal=None
    if rn: renewal={"date":dmy(rn["date"]),"qa":rn["qa"]}
    out.append({"name":q,"title":title,"folderId":fid,"ficha_B":B,"comp_rows":comp_rows,"renewal":renewal,
                "has_intake":bool(ik),"has_et":bool(et),"n_comps":len(comp_rows)})
json.dump(out,open("report/batch-build.json","w"),ensure_ascii=False,indent=1)
for o in out: print(f'{o["name"]:24s} intake:{int(o["has_intake"])} et:{int(o["has_et"])} comps:{o["n_comps"]:2d} renov:{"si" if o["renewal"] else "no"}')
