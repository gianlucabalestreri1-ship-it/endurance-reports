# Endurance Reports

Tabla de feedback para entrenadores de **Endurance Tool** (`https://et.endurancegroup.org`).

Se loguea con las credenciales del coach, lee el panel de notificaciones y arma
una tabla agrupada por sesión con el feedback, el sRPE y el tipo de cada sesión,
resaltando lo que necesita atención.

## Qué produce

- **`report/feedback-table.html`** — reporte visual, agrupado por sesión.
- **`report/feedback-data.json`** — los mismos datos, estructurados.

### Contenido de la tabla

- **Atletas** — feedback de sesión (comentario + sRPE) y sesiones clave.
- **FIT** — feedback de dispositivo (Garmin/`.fit`): distancia y duración, asociado
  a la sesión cuando existe archivo. Las métricas de dispositivo se muestran solo
  cuando hay un FIT asociado a la sesión (MIT/HIIT/LIT).
- **Competencias** — competiciones completadas (con RPE) y cuenta regresiva de
  prioridad A.

### Resaltados

- **sRPE ≥ 6** — carga percibida alta (borde rojo + número en rojo).
- **Dolor / molestia** — detectado en el comentario, con manejo de negaciones
  (“sin dolor”, “sin molestias”, “no molesta”) para evitar falsos positivos.
- **Competencias completadas** — marcadas con ✓.

### Código de color por tipo de sesión (manual del entrenador)

| Color | Categoría | Ejemplos de tipo |
|-------|-----------|------------------|
| 🔵 azul | **LIT** (baja intensidad) | Resistencia/Fondo, Mantenimiento, Aguas abiertas |
| 🟡 amarillo | **ThT** (tempo/umbral) | Tempo, FTP/MLSS/Umbral |
| 🔴 rojo | **HIT** (alta intensidad) | HIIT (largo/corto), Neuromuscular/Velocidad |

## Uso

Requiere Node 18+ y las variables de entorno `ET_EMAIL` / `ET_PASSWORD`.

```bash
node feedback-table.js          # solo notificaciones sin leer (pendientes)
node feedback-table.js --all    # incluye también las ya leídas
```

Abrí `report/feedback-table.html` en el navegador.

## Cómo funciona

No usa navegador: llama directamente a la API JSON-RPC de Endurance Tool
(`api.app.endurancegroup.org/front_ws/call/`).

1. `login_coach` con email/contraseña → devuelve un token de sesión.
2. `list_web_notification` con el token en el header `Authorization` → devuelve
   las notificaciones. El `body` de cada notificación ya trae Atleta, Fecha,
   Tipo de sesión, sRPE, comentario y (para FIT) la distancia, así que no hace
   falta entrar sesión por sesión.

`lib/endurance.js` — cliente de API + parser. `feedback-table.js` — arma el reporte.

> **Datos sensibles:** el reporte incluye datos personales y de salud de los
> atletas. `report/` está en `.gitignore` y no se versiona.
