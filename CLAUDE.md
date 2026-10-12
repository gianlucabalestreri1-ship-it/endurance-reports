# Endurance Reports — memoria del proyecto

Objetivo: leer las notificaciones de **Endurance Tool** y entregar al coach una
**tabla de feedback** (por sesión) con reporte de atención. Este archivo estandariza
cómo se accede, dónde están los datos y cómo se entrega, para que cada corrida salga
optimizada. **La vía optimizada es HTTP puro (sin navegador).**

## 1. Acceso al sistema

> **DECISIÓN (2026-10-11): acceso API-first.** El proyecto se construye sobre la
> **API HTTP JSON-RPC**, no sobre automatización de navegador. Se verificó que **todo**
> el flujo del "Asistente de informes" es alcanzable por API, incluido el **ritmo real
> por dispositivo** (ver §2 `session_resume` / `get_resume_recods`). El navegador queda
> **solo como plan B documentado** (ver "Gotcha de navegador"), nunca como base.
> Motivos: 1 llamada autenticada vs. abrir Chromium + MITM + navegar/scrapear (mucho más
> rápido y barato); robusto ante cambios de UI (las capturas del manual son 2018-19); y
> más seguro (las lecturas por API no pueden disparar los peligros del manual: Desvincular,
> Activar plan, Guardar, arrastrar sesiones). Único reparo: la API es **no oficial**
> (ingeniería inversa del mismo backend que usa la web); ha sido estable todo el proyecto.

- **App web:** `https://et.endurancegroup.org/src/#/login/` es un wrapper React que
  embebe en un **iframe** la app real (AngularJS) en
  `https://etangular.endurancegroup.org/src/#/login/`. El form: `input[name=email]`,
  `input[name=password]`, botón `#login_login`. **Para scrapear NO uses la web** — usá la API.
- **Credenciales:** variables de entorno `ET_EMAIL` / `ET_PASSWORD` (presentes en el entorno).
- **API JSON-RPC:** `POST https://api.app.endurancegroup.org/front_ws/call/`
  con body `{"id":null,"session":"","name":<metodo>,"args":{...}}` y
  `Content-Type: application/json`.
  1. `login_coach` → `args:{email,password}` → devuelve `response.session` (**token**) y `response.profile` (`full_name`, `first_name`, `last_name`, `id`…).
  2. Llamadas siguientes: header **`authorization: <token>`** (el campo `session` del body va vacío).
  3. `list_web_notification` → `args:{}` → `response.web_notifications` (array de las ~200 más recientes) + `response.sum_pending_read`. `web_notifications_count` da el total histórico.
- **Node `https` no usa `HTTPS_PROXY`** → va directo, y el `login_coach` responde 200.
  Ver `lib/endurance.js` (`buildAgent` confía en `/root/.ccr/ca-bundle.crt` si existe).

### Gotcha de navegador (solo si algún día hace falta Playwright)
El egress-gateway del entorno hace **MITM transparente** en :443 (presenta una CA
"Egress Gateway / Anthropic"). Node lo resuelve con `NODE_EXTRA_CA_CERTS` o el `ca`
del agente. Chromium necesita: `proxy {server:'direct://'}` + `--no-proxy-server`
+ `--ignore-certificate-errors` + `ignoreHTTPSErrors:true` + DoH off
(`--dns-over-https-mode=off --disable-features=DnsOverHttps`). Sin esto: `ERR_CONNECTION_RESET`.
**Pero para esta tarea el navegador no se usa: todo sale de la API.**

## 2. Dónde está cada dato (modelo de notificación)

Cada item de `web_notifications`: `id`, `type`, `status`, `title`, `body`, `data`, `date`.

- **`status`**: `pending` = **SIN LEER (verde)** · `read` = leída · `accepted`.
- **`body`** (texto plano en `session_comment`/`competition_feedback`; HTML con `<strong>Label:</strong>` en los `key_*`) trae inline:
  `Atleta/Athlete`, `Plan`, `Fecha/Date` (+ `AM`/`PM`), `Titulo/Denominación/Title`,
  `Deporte/Sport`, `Tipo de sesión/Session type`, `Duración`, `RPE` (= **sRPE**),
  `Comentario/Comment`, `Distance` (solo FIT). → **No hace falta entrar sesión por sesión.**
- **`data`**: `session_id`, `plan_id`, `athlete_id`, `garmin_activity_file_id` (FIT).

### `type` → sección (pestañas del panel de notificaciones)
| type | sección | notas |
|---|---|---|
| `session_comment` | **Atletas** | comentario + sRPE (mayoría) |
| `key_session_feedback` | **Atletas** | sesión clave (RPE + comentario) |
| `key_session_fit` | **FIT** | dispositivo: `Distance` + `garmin_activity_file_id` |
| `competition_feedback` | **Competencias** | completada; trae `RPE` y `Prioridad` A/B/C |
| `competition_countdown` | **Competencias** | "cuenta regresiva prioridad A" |
| `request_service` | (ignorar) | solicitudes de servicio |

Un mismo `session_id` puede tener `key_session_feedback` (subjetivo) + `key_session_fit`
(dispositivo): **se agrupan en una fila** (feedback + métrica FIT juntos).

### Tipo de sesión → intensidad (código de color del manual)
- 🔵 **LIT** (azul): Resistencia Endurance/Fondo, /Mantenimiento, Aguas abiertas, regenerativo, continuo.
- 🟡 **ThT** (amarillo): Tempo, FTP/MLSS/Umbral, threshold.
- 🔴 **HIT** (rojo): HIIT (largo/corto), Neuromuscular/Velocidad, VO2, series/intervalos.
- Otros: Fuerza, Test/Valoración.

### Dolor / molestia — 3 estados (`classifyPain` en `lib/endurance.js`)
Detectar **solo en el `Comentario`**. Negación evaluada **por cláusula** (se mira hasta el
último separador `. , ; pero aunque` antes de la palabra, no una ventana fija de 14 chars →
capta "No presento molestias en mi pie", "no me molestó", "sin dolor", y NO tapa un dolor real
en otra cláusula). `classifyPain` devuelve:
- **`active`** = dolor real (mención no negada) → en el Excel **"SÍ"** (rojo).
- **`improving`** = mención **negada + con contexto** (parte del cuerpo o palabra de recuperación:
  pie/rodilla/tobillo/…, "mejor", "recuper", "menos") = **progresión buena** en un dolor/lesión →
  **"Mejora 🟣"** (lila, color diferenciado). Ej.: "No presento molestias en mi pie derecho".
- **`none`** = sin mención relevante → **"NO"**.
`detectPain` = `classifyPain === 'active'` (los conteos de dolor cuentan solo activos; "Mejora" no suma).

### APIs de planes (más allá de las notificaciones)

- **`get_upcoming_activities` → `args:{}`** (ventana fija ~7 días; ignora args):
  `plans` (vencen en ≤7 días: `plan_id`, `athlete_id`, `title`, `last_session_date`, `athlete_name`),
  `expired_plans` (vencidos sin renovar), `competitions` (próximas, con `date` exacta), `controls`.
- **`training_plan` → `args:{training_plan_id:"<id>", full:true, athlete:true}`**: plan completo.
  `response.plan.macro.mesos[].micros[].sessions.{am,pm}` = 7 slots/semana; cada sesión trae
  `date`, `title`, `status`, `rpe` (prog.), **`athlete_rpe` (sRPE)**, `athlete_comment`,
  `athlete_duration/distance`, `has_feedback`, `key_session`, y **`type.intensity_type`
  (LIT/THT/HIT) + `type.color` (hex oficial del manual)**. `plan.competitions` trae RPE/comentario.
  → **El dossier de un atleta sale de UNA llamada** (no depende del tope de 200 notificaciones).
- **`athlete_list` → `args:{}`**: todos los atletas. **`get_micro` → `{micro_id}`**: micro completo.
- **`training_plan_list` → `args:{athlete_id}`**: todos los planes de un atleta (activos e inactivos) → historial completo.
- **`get_metrics` → `args:{}`** (o por atleta): métricas cargadas (sueño, peso, FC reposo, estrés).
- **`web_notifications_readed` → `args:{notifications_ids:[...]}`**: marca feedbacks como leídos (única escritura permitida).
- **`bookshops_list` / `folder_bookshops_list` → `args:{}`**: biblioteca (bookshop) del coach — plantillas de plan/meso/micro/sesión/control, con `object_type`, `type_bookshop` (Personal/IEG), `folder_name`.
- **Datos de dispositivo (FIT / ritmo real) — verificado 2026-10-11:**
  - En `training_plan`, cada micro trae `micros[].fits[]` (actividades de dispositivo): `{id, session_date, time_str, sport_code, downloadable, session:{...}}`. Ese **`fits[].id` es el `resume_id`**.
  - **`session_resume` → `args:{resume_id}`**: objeto `resume` (sesión + datos del dispositivo).
  - **`session_resume.resume.laps[]`** es lo mejor para ritmo real: ET ya entrega **`avg_speed`
    como objeto `{magnitude, unit:"min / km", format:"6'44\" / km"}`** (ritmo medio ya formateado) + `max_speed`,
    `total_elapsed_time` (seg), `total_distance` (**km**), `avg_heart_rate`/`max_heart_rate`, cadencia, potencia, TSS/IF por lap.
    El `resume` también trae agregados: `total_distance` (m), `num_laps`, `sport_lit_time`/`sport_tht_time`/`sport_hit_time`
    (tiempo en fase), `normalized_power`, `training_stress_score`, `intensity_factor`.
  - **`get_resume_recods` → `args:{resume_id}`**: `response.records[]` = stream punto a punto
    (`{timestamp, distance, altitude, speed, heart_rate, cadence, power, position:[lat,lng]}`, ~1000+ puntos) para curvas finas.
    Para el reporte alcanza con `laps` (ya resueltos); los `records` son opcionales.
  - Arg correcto es `resume_id` (no `id`/`pk`); con nombre equivocado el back responde "ResumeSession doesn't exist".
- **`session` → `args:{session_id}`** = detalle COMPLETO de una sesión en UNA llamada: lo **programado** en
  `activities[].sections[].work` (cada bloque: `series`, `repetitions`, `micro_pause`, `distance`, `duration`,
  `zone_number`, `coach_unit`, y **`details` con el ritmo objetivo ya formateado**, p.ej. `6'35" / km [Zona 2: Endurance…]`),
  las **zonas del atleta** `training_zones` (`MAS` = min/km por zona, `HR`, `FTP`, `RPE`, `SW`), el **`resume`** embebido
  (laps del dispositivo) y las `metrics` del día. Bloques con `text_only:true` o strength no son de carrera (descontar).
- **Ritmo real — regla de fuentes (prioridad):**
  1. **FIT** (`resume.laps`): ritmo por lap ya formateado.
  2. **Sin FIT pero con feedback manual:** `session.athlete_distance` + `session.athlete_duration` → ritmo medio;
     y **parsear el `athlete_comment`** por ritmos que el atleta dejó a mano (formatos AR: `7.37/km`, `7'37"/km`,
     `5:10`, `a 6.00 el km`, `ritmo 6'10`). Muchos atletas NO tienen dispositivo vinculado y cargan el ritmo en el comentario.
  3. **Sin nada:** informar "sin datos de ritmo".
- Rutas web (por si hace falta): plan = `#/plan/{athlete_id}/{plan_id}/{meso_id}/{micro_id}/`.

### "Asistente de informes" (guía 2026-10-11) — estado 2026-10-12: TODO DESPLEGADO
- **Marcar leído** ✅ `markNotificationsRead` en el cliente + `mark-read.js` (ver §3). Probado: marcó 83 → 0 sin leer.
- **Informe de renovación** ✅ `renewal.js` + `make_renewal_xlsx.py` (ver §3).
- **Alerta de adherencia** ✅ `alert.js` + `make_alert_xlsx.py` (ver §3).
- **Ritmo real vs objetivo** ✅ resuelto a nivel sesión (ritmo objetivo del bloque vs laps del FIT / ritmos del comentario).
  Pendiente opcional: alinear lap↔bloque para un "real por bloque" quirúrgico (hoy es aproximado + tabla de laps completa).
- **Modelo de activación**: la guía lo quiere **a demanda** (el coach pega la lista). La Routine diaria de feedback sigue programada.

## 3. Cómo se entrega el resultado

Pipeline diario: **`node feedback-table.js`** → `report/feedback-table.html` + `report/feedback-data.json`
(incluye `upcoming`: próximas competencias = agenda con fecha + countdowns con semanas).
Luego **`python3 make_xlsx.py`** (necesita `pip install -q openpyxl`) → `report/Endurance-Feedback.xlsx`.
Y para cerrar el ciclo: **`node mark-read.js`** marca como leídas las notificaciones sin leer (feedbacks +
carreras; saltea servicios/otros) — **única escritura del flujo, correr DESPUÉS de entregar el reporte**.
`--dry` previsualiza; `node mark-read.js <id> <id>` marca puntuales.

**Informe de renovación a demanda** (`renewal.js` + `make_renewal_xlsx.py`):
- `node renewal.js --names "Nombre Apellido" ...` | `--file lista.txt` | `--dry` (previsualiza el match) | `<plan_id>`.
  Resuelve nombre→atleta→plan vigente con `athlete_list` (fuzzy: acentos + tokens + Levenshtein; match flojo se
  marca "⚠ revisar", nombre-de-pila solo en consulta multi-palabra NO matchea). → `report/renewal-<plan>-data.json`.
- `python3 make_renewal_xlsx.py report/renewal-*-data.json` → **`report/Renovacion.xlsx`** (se regenera; 1 pestaña/atleta).
  - Período = mesociclo que contiene HOY (+ el anterior si es corto ≤2 micros o si el actual aún no tiene ejecución).
  - **Vista semanal**: 1 tabla por microciclo, columnas Lunes→Domingo, filas = atributos; banner combinado con el
    rango de fechas y "X sesiones ejecutadas vs Y programadas". Fila **"Realizada"** (semáforo): verde=hecha como
    programada · amarillo=hecha pero distinta (dolor / desvío en el comentario / sRPE ≤ prog−3 / parcial) · rojo=no hecha.
  - **Adherencia = solo runs** (la fuerza no se reporta → no cuenta; se muestra pero no penaliza; nota al pie).
  - **Ejecutada** = feedback manual **o FIT** (`resume_fit`). Ritmo real: FIT→laps; sin FIT→ritmos del comentario.
  - Formato: columnas B–H ancho 30,86; nombre de atleta y plan en celdas combinadas; todo centrado/medio/ajustado.

**Alerta de adherencia semanal** (`alert.js` + `make_alert_xlsx.py`):
- `node alert.js` (todos) | `--days N` (umbral, def. 7) | `--names ...`. → `report/alert-data.json`;
  `python3 make_alert_xlsx.py` → **`report/Alerta-Adherencia.xlsx`**.
- **Activo** = tiene plan activo con `last_programmed_session`. **Off** = sin plan (se detecta solo = roster − activos);
  notas/motivos opcionales en `config-standby.json` (`notes`: nombre→motivo). **Por comenzar** = plan futuro.
- Última actividad por atleta = max fecha con feedback manual **o** `resume_fit` (el `fits[]` del plan trae
  `session_date` vacío → NO usar). **Reintentos** por plan (3×): un plan grande puede dar timeout y no debe
  volverse falsa alerta (si falla → estado `sin_dato`, no `alerta`). Plan vencido reciente **aplica igual** (debía reportar esta semana).

**Planes y dossiers** (`plans.js` + modos de `make_xlsx.py`):
- `node plans.js --report` → `plans-expiry-data.json`; `python3 make_xlsx.py expiry` → `Planes-Vencimientos.xlsx`
  (3 hojas: Por vencer ≤7 días con semáforo, Vencidos sin renovar, Competencias próximas). **Se envía los lunes.**
- `node plans.js --dossiers` → un `dossier-<plan>-data.json` por cada plan que vence en **exactamente 7 días**
  (`DOSSIER_DUE_DAYS` lo cambia); `--all-expiring` = todos los de la ventana; `--plan <id>` = manual.
  `python3 make_xlsx.py dossier <json>` → `Dossier-<Atleta>.xlsx` (historial completo de sesiones reportadas:
  fecha, tipo con color oficial de la API, RPE prog vs sRPE, duración/distancia real, comentario, dolor, estado,
  ★ sesiones clave; + hoja Competencias del plan).

- **Excel = formato preferido del coach.** 3 hojas: `Feedback`, `⚠ Atención` (KPIs + casos
  priorizados: dolor primero, luego sRPE↓, + competencias; incluye "Mejora ↓" en lila),
  `Competencias` (completadas + countdown A).
- **Hoja `Feedback` (layout):** ordenada **alfabéticamente por atleta** (sin acentos/mayúsc.);
  cada atleta abre con una **fila-separador combinada a lo ancho** con el nombre centrado (tamaño 12,
  fondo celeste) y cierra con una **fila vacía de respiro**. **Sin columna Atleta ni punto de leído.**
  Columnas: Fecha · Mom · Sesión · Deporte · Tipo (coloreado LIT/ThT/HIT) · sRPE · Feedback/comentario ·
  **Dolor/molestia** (SÍ rojo / NO / Mejora 🟣 lila) · **FIT (laps + métrica)**. Todo el contenido
  **centrado + al medio + ajustado**; encabezados centrados.
- **Columna FIT = métrica real del dispositivo** (no solo la notificación `key_session_fit`, que solo
  existe para sesiones clave): `feedback-table.js` enriquece cada fila leyendo `session`→`resume`
  (`ET.getSession`/`ET.fitMetric`) y muestra **resumen (km · duración · FC) + cada lap** (vuelta ·
  tiempo · dist · ritmo · FC), igual que renovación. Cuesta 1 llamada por sesión (en `--all` son muchas).
- **Resaltar siempre:** `sRPE ≥ 6`, competencias completadas, dolor/molestia.
- **Gotcha openpyxl:** `freeze_panes` por **string** (`"A2"`), no `ws.cell(...)` (materializa una fila
  fantasma). **No usar `drop_ghost_row`/`delete_rows` en hojas con celdas combinadas** (los separadores):
  `delete_rows` corrompe/borra los datos. El freeze por string ya evita la fila fantasma.
- Por defecto solo **sin leer** (`status=pending`); `feedback-table.js --all` incluye leídas.
- El Excel es export estático: **sin fórmulas**, no requiere recalc de LibreOffice.
- **Datos sensibles** (salud de atletas): entregar como **archivo** (`SendUserFile`), no
  publicar como Artifact. `report/` está en `.gitignore`.

## 4. Tarea programada

- Routine durable `Endurance — tabla de feedback (Lun–Vie)` (`trig_01NG5NSPkccbikqnNypUD8Wp`) —
  sesión nueva Lun–Vie **11:57 UTC (8:57 AR)** en `env_01DhayXXCk1WNRKQwpcp6SNe` (tiene ET_EMAIL/ET_PASSWORD).
- **NUNCA embeber código en el prompt como base64**: el clasificador de seguridad lo bloquea (con razón).
  La rutina **clona el repo público** `https://github.com/gianlucabalestreri1-ship-it/endurance-reports`
  (rama `main`) y corre el código legible: feedback diario + `plans.js --report --dossiers` +
  dossiers Excel + (solo lunes) `make_xlsx.py expiry`. Envía: Feedback siempre, Dossiers si hay,
  Vencimientos los lunes.
- **Push: DESBLOQUEADO (2026-10-12)** tras instalar/reconectar la Claude GitHub App. Rama de trabajo
  `claude/endurance-tool-feedback-table-1gybwt`. `git push -u origin <rama>` funciona desde la sesión.
  (Histórico: antes daba 403 read-only y el usuario subía a mano.) `report/` está en `.gitignore` (datos sensibles).
  `endurance.js` va DENTRO de `lib/`; se mantienen en sync `lib/endurance.js` y `endurance.js` raíz.
- En `SendUserFile` de las rutinas: no forzar `status:"proactive"` (dio InputValidationError en
  el entorno de la rutina); indicar "usá un status válido según el schema".

## 5. Optimizaciones / notas para la próxima corrida

- Usar **API HTTP pura** (ya). Nada de Playwright salvo exploración.
- `list_web_notification` devuelve 200 items; hoy cubre las 169 sin leer. Si alguna vez
  las sin-leer superan 200, agregar paginación en `args`.
- `node` está en `/opt/node22/bin/node`. `openpyxl` puede no estar preinstalado → `pip install -q openpyxl`.
- Recalc de LibreOffice se cuelga en este entorno → mantener el Excel **sin fórmulas** (valores literales).
