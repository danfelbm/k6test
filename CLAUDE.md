# Stress test E-14 — Pacto Histórico (k6)

Repo aislado de pruebas de carga. **No tiene relación con el repo `votaciones`** y no debe mezclarse con él.
Prueba el flujo real de un testigo electoral que sube su acta E-14 en el entorno de estrés.

## Qué hace

Reproduce, a nivel HTTP (sin navegador), el flujo completo de un testigo:

1. `GET /login` → siembra cookies (sesión + `XSRF-TOKEN`) y captura la versión de assets de Inertia.
2. `POST /login/check-credential` `{credential}` → `{action: "passwordless"}` (testigo no admin).
3. `POST /login` `{credential}` (sin password) → `302`.
4. `GET /miembro/mi-testigo` (Inertia) → resuelve el `slug` de la mesa y el `procesoId`.
5. `GET /miembro/divipol/{slug}/{procesoId}/evidencias/create` (Inertia) → `formato_id` (E-14=1), `cargo_id`, `formulario_id` y los campos.
6. `POST /miembro/api/files/upload` (multipart, `files[]`, 1–3 JPG) → paths temporales.
7. `POST /miembro/divipol/{slug}/{procesoId}/evidencias` → crea la evidencia → `302` a la vista de detalle.

El "modal de confirmación" de envío es solo UI → en HTTP equivale al POST del paso 7. El modal "Activar
Notificaciones / Ahora no" es un prompt Web Push del navegador → **no existe en el plano HTTP, no se maneja**.

## Estructura

```
stresstest/
├── testigos_stress_100000.csv   # 100k testigos (gitignored). Columnas usadas: documento, mesa_id, proceso_electoral_id
├── assets/e14_1..3.jpg          # imágenes reales para adjuntar (el contenido no importa; la IA es asíncrona)
├── lib/
│   ├── config.js                # BASE_URL y parámetros por env
│   ├── data.js                  # carga del CSV (SharedArray, parseo manual, BOM) + asignación única de cédula
│   ├── http.js                  # XSRF token desde el cookie jar, headers Inertia, GET de props
│   ├── auth.js                  # loginPasswordless (los 3 requests + checks)
│   └── e14.js                   # flujo dashboard→create→upload→store + generador de respuestas_formulario
├── smoke.js                     # 1 VU / 1 iteración — valida el flujo end-to-end
└── stress.js                    # breakpoint: ramping-vus por escalones hasta el punto de quiebre
```

## Cómo correr

```bash
# 1) Smoke — valida todo el flujo con una cédula (la quema)
k6 run --env DEBUG=1 smoke.js
k6 run --env DEBUG=1 --env IDX=7 smoke.js        # depurar con otra cédula fresca

# 2) Carga / breakpoint con dashboard en vivo + reporte HTML
K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_EXPORT=report.html \
  k6 run --env OFFSET=1000 --env MAX_VUS=50 stress.js

# El dashboard en vivo queda en http://localhost:5665 mientras corre.
```

### Parámetros (env)

| Var | Default | Para qué |
|---|---|---|
| `BASE_URL` | `https://stress.movimientopactohistorico.co` | Entorno objetivo |
| `MAX_VUS` | `200` | Techo de usuarios concurrentes de la escalera |
| `OFFSET` | `0` | Desplaza el inicio en el CSV para **no reusar cédulas quemadas** entre corridas |
| `IMAGES_COUNT` | `2` | Imágenes a adjuntar (1–3) |
| `RAMP` / `HOLD` | `30s` / `45s` | Duración de subida / meseta por escalón |
| `IDX` | `0` | (solo smoke) índice de cédula a usar |
| `DEBUG` | — | Loguea props Inertia y cuerpos de error |

## Reglas y gotchas (IMPORTANTE)

- **Cada cédula se usa UNA sola vez.** Hay índice único `(mesa, formato, proceso, cargo, testigo)`; reenviar da `422`.
  Por eso cada corrida avanza `OFFSET`. Para reiniciar pruebas, el dueño del entorno **borra las evidencias** en BD.
- **`OFFSET` entre corridas**: lleva la cuenta. Smoke usó índice 0; las corridas de carga usan rangos altos y separados
  (p. ej. 1000, 20000, 40000) para no chocar.
- **CSRF**: la app valida el token CSRF. Se lee el cookie `XSRF-TOKEN` del jar del VU, se hace `decodeURIComponent`
  y se envía como header `X-XSRF-TOKEN` (idéntico a axios/Inertia). El cookie jar es por-VU, así que cada usuario
  mantiene su sesión.
- **Login passwordless = 2 pasos** (`check-credential` y luego `login`); el testigo no administrativo entra **sin password**.
- **Inertia**: para leer props, el GET lleva `X-Inertia: true` + `X-Inertia-Version`. La versión se extrae del
  `data-page` del HTML inicial de `/login`. Sin versión correcta, Inertia responde `409`.
- **`open()` resuelve relativo al archivo**: como vive en `lib/e14.js` y `lib/data.js`, las rutas suben un nivel
  (`../assets/...`, `../testigos_stress_100000.csv`).
- **papaparse remoto (`jslib.k6.io`) no resuelve en k6 v1.2.1** → el CSV se parsea manualmente (es plano, sin comillas).
- **Rate limit de login**: ~`3000/min por IP` (≈50/seg) y `60/min por credencial`. Desde **una sola IP** ese es el
  cuello para arrancar usuarios nuevos: por encima de ~300 VUs aparecen `429` en login. Para ir más alto se necesita
  multi-IP o k6 Cloud.
- **`mi-testigo` devuelve props Inertia muy pesados** → el ancho de banda de **bajada** del generador es un factor real
  al escalar (GBs en pocos minutos).

## Hallazgos de rendimiento

Ver `RESULTADOS` en el README. Resumen: el flujo es 100% funcional; el sistema sostiene cómodamente decenas de VUs
con p95 ~1s, y empieza a degradarse en latencia hacia ~300 VUs concurrentes desde una sola máquina/IP.
