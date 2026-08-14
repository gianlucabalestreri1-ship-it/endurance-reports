# Endurance Reports — memoria del proyecto

Objetivo: leer las notificaciones de **Endurance Tool** y entregar al coach una
**tabla de feedback** (por sesión) con reporte de atención. Este archivo estandariza
cómo se accede, dónde están los datos y cómo se entrega, para que cada corrida salga
optimizada. **La vía optimizada es HTTP puro (sin navegador).**

## 1. Acceso al sistema

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

## 3. Cómo se entrega el resultado

Pipeline: **`node feedback-table.js`** → `report/feedback-table.html` + `report/feedback-data.json`.
Luego **`python3 make_xlsx.py`** (necesita `pip install -q openpyxl`) → `report/Endurance-Feedback.xlsx`.

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

- Routine durable `Endurance — tabla de feedback (Lun–Vie)` — sesión nueva Lun–Vie
  **11:57 UTC (8:57 AR)**, corre el pipeline y envía el Excel.
- Va **autocontenida** (script embebido en el prompt, gzip+base64) porque el **push al
  repo está bloqueado** (token read-only → 403). **Si se habilita `contents: write`:**
  pushear el repo y simplificar la Routine a `clone → node feedback-table.js → python3 make_xlsx.py → enviar`.
- Regenerar el bundle embebido: concatenar `lib/endurance.js` (sin `module.exports`) +
  `feedback-table.js` (sin el `require` ni `module.exports`), dedupe `const fs`, `gzip -9 | base64 -w0`.

## 5. Optimizaciones / notas para la próxima corrida

- Usar **API HTTP pura** (ya). Nada de Playwright salvo exploración.
- `list_web_notification` devuelve 200 items; hoy cubre las 169 sin leer. Si alguna vez
  las sin-leer superan 200, agregar paginación en `args`.
- `node` está en `/opt/node22/bin/node`. `openpyxl` puede no estar preinstalado → `pip install -q openpyxl`.
- Recalc de LibreOffice se cuelga en este entorno → mantener el Excel **sin fórmulas** (valores literales).
