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

### Dolor / molestia
Detectar **solo en el `Comentario`** (no en el body completo: planes tipo "post lesión"
dan falsos positivos). Manejar **negaciones por-ocurrencia**: "sin dolor", "sin molestias",
"no molesta", "sin dolores ni molestias". Ver `detectPain` en `lib/endurance.js`
(bien calibrado: descarta negaciones y captura "no molesta… pero molesta y mucho").

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
- Rutas web (por si hace falta): plan = `#/plan/{athlete_id}/{plan_id}/{meso_id}/{micro_id}/`.

### Pendientes del "Asistente de informes" (guía 2026-10-11) — estado
- **Marcar leído**: método existe (`web_notifications_readed`); **falta desplegarlo en el repo** (no está en `endurance.js` subido).
- **Ritmo real vs objetivo**: datos alcanzables (arriba); **falta implementar** el parser de `records` → ritmo por bloque en el dossier.
- **Informe de renovación**: falta Excel único con **una pestaña por atleta**, a demanda desde la lista que pasa el coach (no por fecha), recortado al **último mesociclo** (+ anterior si dura ≤2 semanas).
- **Alerta de adherencia**: atletas activos sin feedback > 1 semana — **no implementado**.
- **Modelo de activación**: la guía lo quiere **a demanda** (hoy hay Routine programada) — decisión pendiente.

## 3. Cómo se entrega el resultado

Pipeline diario: **`node feedback-table.js`** → `report/feedback-table.html` + `report/feedback-data.json`
(incluye `upcoming`: próximas competencias = agenda con fecha + countdowns con semanas).
Luego **`python3 make_xlsx.py`** (necesita `pip install -q openpyxl`) → `report/Endurance-Feedback.xlsx`.

**Planes y dossiers** (`plans.js` + modos de `make_xlsx.py`):
- `node plans.js --report` → `plans-expiry-data.json`; `python3 make_xlsx.py expiry` → `Planes-Vencimientos.xlsx`
  (3 hojas: Por vencer ≤7 días con semáforo, Vencidos sin renovar, Competencias próximas). **Se envía los lunes.**
- `node plans.js --dossiers` → un `dossier-<plan>-data.json` por cada plan que vence en **exactamente 7 días**
  (`DOSSIER_DUE_DAYS` lo cambia); `--all-expiring` = todos los de la ventana; `--plan <id>` = manual.
  `python3 make_xlsx.py dossier <json>` → `Dossier-<Atleta>.xlsx` (historial completo de sesiones reportadas:
  fecha, tipo con color oficial de la API, RPE prog vs sRPE, duración/distancia real, comentario, dolor, estado,
  ★ sesiones clave; + hoja Competencias del plan).

- **Excel = formato preferido del coach.** 3 hojas: `Feedback` (por sesión, Tipo coloreado
  LIT/ThT/HIT, sRPE, dolor, FIT), `⚠ Atención` (KPIs + casos priorizados: dolor primero,
  luego sRPE↓, + competencias), `Competencias` (completadas + countdown A).
- **Resaltar siempre:** `sRPE ≥ 6`, competencias completadas, dolor/molestia.
- **MIT/HIIT/LIT:** métricas de dispositivo (distancia/duración) **solo si hay FIT** asociado.
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
- El **push desde sesiones de Claude está bloqueado** (token read-only → 403, incluso vía MCP):
  los cambios de código los sube el usuario a mano por la web de GitHub (Upload files / editar).
  `endurance.js` va DENTRO de `lib/`.
- En `SendUserFile` de las rutinas: no forzar `status:"proactive"` (dio InputValidationError en
  el entorno de la rutina); indicar "usá un status válido según el schema".

## 5. Optimizaciones / notas para la próxima corrida

- Usar **API HTTP pura** (ya). Nada de Playwright salvo exploración.
- `list_web_notification` devuelve 200 items; hoy cubre las 169 sin leer. Si alguna vez
  las sin-leer superan 200, agregar paginación en `args`.
- `node` está en `/opt/node22/bin/node`. `openpyxl` puede no estar preinstalado → `pip install -q openpyxl`.
- Recalc de LibreOffice se cuelga en este entorno → mantener el Excel **sin fórmulas** (valores literales).
