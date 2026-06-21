# HANDOFF — Stress test E-14 (continuación en VPS)

> Para el nuevo Claude Code: estás retomando un trabajo de stress testing que venía
> corriéndose desde la Mac del usuario y ahora se mueve a este VPS (Ubuntu 24.04).
> **Lee TODO este documento antes de ejecutar nada.** Al final hay reglas de cómo
> trabajar con este usuario que son obligatorias.

---

## 1. Objetivo

Prueba de carga del flujo de envío de actas **E-14** por testigos electorales contra:
- URL: `https://stress.movimientopactohistorico.co`
- Servidor objetivo: IP `185.34.102.230`, en **Lausanne, Suiza** (proveedor Hidora), **sin Cloudflare** (golpeas el origen directo).
- Auth: **passwordless** (solo cédula, sin contraseña) — modo PASSWORDLESS_ANY.

Meta actual: medir la **capacidad real de concurrencia del servidor**, empujando un perfil en arco hasta 50 evidencias/seg.

## 2. Por qué estás en un VPS

Todo se corrió desde la Mac del usuario. El último test (arco 2→50/s, 3 fotos) reveló que el cuello
era **muy probablemente el ancho de banda de SUBIDA de la Mac** (uplink clavado en ~6 MB/s sostenido = saturado),
**no el servidor** (que solo dio ~1% de errores). Por eso se migra a un VPS en **Alemania/EU** (cerca de Suiza)
con puerto de red ≥600 Mbit/s, para eliminar ese cuello y medir el límite REAL del servidor.

**Tarea pendiente:** correr el mismo arco (3 fotos) desde el VPS.
- Si sigue topando ~11/s → el cuello ES el servidor.
- Si sube hacia 50/s → el cuello era el uplink de la Mac.

Cálculo de ancho de banda: 50/s × 3 fotos (~550 KB) ≈ **220 Mbit/s subida + ~290 bajada**. Por eso el VPS necesita ≥600 Mbit/s.

## 3. Archivos del proyecto

El usuario los sube manualmente (dijo que a `/root`). **La estructura de carpetas DEBE conservarse**
porque k6 abre archivos con rutas relativas. Estructura correcta (ej. en `/root/stresstest/`):

```
stresstest/
├── testigos_stress_100000.csv      # 100k testigos (NO subido a git; el usuario lo tiene)
├── assets/
│   ├── e14_1.jpg  e14_2.jpg  e14_3.jpg   # fotos reales ~145-200 KB
├── lib/
│   ├── config.js   # BASE_URL, IMAGES_COUNT (default 1), CSV_PATH, DEBUG
│   ├── data.js     # carga CSV (SharedArray, parseo manual, BOM) + tomarTestigoUnico() con OFFSET
│   ├── http.js     # xsrfToken() del cookie jar, headers Inertia, inertiaGet()
│   ├── auth.js     # loginPasswordless(documento)
│   └── e14.js      # enviarEvidencia(): dashboard→create→upload→store
├── smoke.js        # 1 VU/1 iter — valida el flujo
├── stress.js       # breakpoint ramping-vus (MAX_VUS)
├── sostenido.js    # constant-arrival-rate (RATE/seg por DURATION)
└── arco.js         # ramping-arrival-rate START→PICO→START (default 2→50→2 en 15min, pico min 7)
```

**Rutas relativas (CRÍTICO):** `open()` en k6 resuelve relativo al archivo que lo llama.
- `lib/data.js` abre `../testigos_stress_100000.csv`
- `lib/e14.js` abre `../assets/e14_1.jpg` (y _2, _3)

Si el usuario aplanó todo en `/root` sin subcarpetas, **se rompe**. Verifica la estructura y, si hace falta,
acomódala o ajusta `CSV_PATH` (`--env CSV_PATH=...`) y las rutas de `open()` en `lib/e14.js`.

## 4. El flujo HTTP (verificado, funciona)

Login passwordless (testigo NO administrativo, sin contraseña):
1. `GET /login` → siembra cookies (sesión + `XSRF-TOKEN`) y captura la versión Inertia del `data-page`.
2. `POST /login/check-credential` `{credential: documento}` → `{action:"passwordless"}`.
3. `POST /login` `{credential: documento}` → `302`.

Flujo E-14:
4. `GET /miembro/mi-testigo` (header `X-Inertia: true`) → `mesas[].slug`, `procesoActual.id`.
5. `GET /miembro/divipol/{slug}/{procesoId}/evidencias/create` (Inertia) → `formato_id` (E-14=**1**), `cargo_id` (**1**), `formulario_id`, campos.
6. `POST /miembro/api/files/upload` (multipart `files[]`, 1-3 jpg) → paths.
7. `POST /miembro/divipol/{slug}/{procesoId}/evidencias` → crea la evidencia → `302`.

CSRF: leer cookie `XSRF-TOKEN` del jar del VU → enviarlo en header `X-XSRF-TOKEN` (con `decodeURIComponent`). k6 mantiene el jar por VU.

Datos del CSV usados: `documento` (cédula con padding de ceros, ej. `0000157158`), `mesa_id`, `proceso_electoral_id` (=**4**).

## 5. Cómo correr

Instalar k6 en Ubuntu 24.04:
```
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install -y k6
```

Validar el flujo con 1 evidencia (primero esto SIEMPRE):
```
cd /root/stresstest
k6 run --env DEBUG=1 smoke.js
```
Debe terminar con `store 302/303` OK y crear una evidencia.

El test principal (arco de concurrencia, 3 fotos):
```
k6 run --env OFFSET=<fresco> --env IMAGES_COUNT=3 arco.js
```
Reporte HTML (el dashboard en vivo está roto, ver Gotchas): añadir
`K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_EXPORT=report-arco.html` antes de `k6 run`.

## 6. CRÍTICO: cédulas de un solo uso + OFFSET

Cada testigo solo puede enviar **UNA** evidencia (índice único `mesa+formato+proceso+cargo+testigo`).
Reenviar = `422`. Por eso cada corrida usa `--env OFFSET=N` para empezar en una cédula fresca del CSV.
Cuando el usuario **borra las evidencias** en su BD, todas las cédulas quedan libres y `OFFSET=0` sirve de nuevo.

**Antes de correr, CONFIRMA con el usuario** si borró las evidencias y desde qué `OFFSET` arrancar.
Ante la duda, usa un OFFSET alto no usado (p. ej. `70000`). No quemes cédulas equivocadas.

## 7. Resultados hasta ahora (desde la Mac, uplink limitado)

| Test | Resultado |
|---|---|
| Smoke 1 VU | Flujo OK 100% |
| 50 VUs (2 fotos) | 1.560 evid, p95 1.05s, holgado |
| 300 VUs | p95 5.95s, degradado |
| 500 VUs (pre-escalado) | p95 8.1s, ~8.4 evid/s, abortó |
| 500 VUs (post-escalado H del usuario) | fiabilidad subió (errores 3.3%→0.3%) pero throughput igual ~8/s |
| Arco 2→50/s, 3 fotos, 15min | pico 50/s NO alcanzado; ~11 evid/s reales; **13.310 dropped (57%)**; iteración 1m+; data_sent clavado 6 MB/s (uplink saturado) |

Conclusión: el escalado horizontal de nodos app mejoró fiabilidad pero no el techo de throughput;
y el arco apunta a que el cuello final fue el uplink de la Mac. **De ahí la migración al VPS.**

## 8. Gotchas

- **Dashboard web en vivo de k6 está ROTO e irreparable**: bug `Cannot convert undefined or null to object`
  (issue grafana/xk6-dashboard #258, proyecto archivado, cerrado "not planned"). Afecta k6 1.2.x/1.3.x.
  **No pierdas tiempo intentando arreglarlo.** Usa `K6_WEB_DASHBOARD_EXPORT=report.html` (reporte estático,
  ese SÍ se ve bien) o el resumen de stdout. Para un dashboard en vivo real: `--out` a Prometheus/InfluxDB + Grafana.
- **papaparse de `jslib.k6.io` NO resuelve** en k6 v1.2.1 → `data.js` parsea el CSV a mano.
- El CSV tiene **BOM** al inicio (ya se maneja).
- `open()` es relativo al archivo (ver sección 3).

## 9. OBLIGATORIO — cómo trabajar con este usuario

En la sesión anterior el usuario se frustró mucho. **No repitas estos errores:**
- **No asumas ni decidas por él.** Pregunta antes de cualquier acción con consecuencias.
- **NUNCA detengas un test en curso** salvo orden explícita e inequívoca. (Se malinterpretó un "detente"
  y se mató un test que él quería seguir corriendo — lo enfureció.) Si dice "para/detente" y hay ambigüedad,
  **aclara a qué se refiere antes de matar nada.**
- **No crees archivos ni soluciones alternativas** sin que lo pida.
- Si pide **"un comando a la vez"**, dale UNO, espera su output, y solo entonces el siguiente. No vuelques listas.
- Sé **honesto sobre lo que no se puede** (ej. el dashboard de k6). No des vueltas con workarounds.
- Confirma el **OFFSET** de cédulas con él antes de correr.

## 10. Constantes del entorno

- Servidor: `https://stress.movimientopactohistorico.co` (IP 185.34.102.230, Suiza, sin CDN).
- Proceso electoral: **id 4** (Presidencia 21 Junio). Formato **E-14 = id 1**. Cargo **Presidencia = id 1**.
- Login: passwordless, solo `credential` (la cédula tal cual viene en el CSV, con ceros).
- VPS recomendado: EU/Alemania, puerto ≥600 Mbit/s, Ubuntu 24.04. CPU/RAM no son el cuello (k6 es liviano); el puerto de red sí.
