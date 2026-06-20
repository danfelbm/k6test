# Stress test E-14 (k6)

Pruebas de carga del envío de actas **E-14** por testigos electorales contra
`https://stress.movimientopactohistorico.co`. Repo aislado (sin relación con el proyecto principal).

Detalles técnicos del flujo, parámetros y gotchas: ver [CLAUDE.md](CLAUDE.md).

## Requisitos

- [k6](https://k6.io) (probado con v1.2.1). `brew install k6`.
- El archivo `testigos_stress_100000.csv` en la raíz (100k testigos: `documento, mesa_id, proceso_electoral_id`).

## Uso rápido

```bash
# Valida el flujo completo con 1 cédula (la quema)
k6 run --env DEBUG=1 smoke.js

# Carga con dashboard en vivo (http://localhost:5665) + reporte HTML
K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_EXPORT=report.html \
  k6 run --env OFFSET=1000 --env MAX_VUS=50 stress.js
```

Parámetros (env): `MAX_VUS`, `OFFSET`, `IMAGES_COUNT`, `RAMP`, `HOLD`, `BASE_URL`, `DEBUG`, `IDX`.
Ver tabla en [CLAUDE.md](CLAUDE.md).

> **Cada cédula se usa una sola vez** (índice único). Avanza `OFFSET` en cada corrida para no chocar con cédulas
> ya quemadas. Para reiniciar las pruebas, borra las evidencias en el entorno y reusa `OFFSET=0`.

## RESULTADOS

Generador: una sola máquina (Mac, una IP). 2 imágenes por evidencia.

| Escenario | VUs máx | Evidencias creadas | checks OK | HTTP fallidos | p95 latencia req | p95 duración iteración | Veredicto |
|---|---:|---:|---:|---:|---:|---:|---|
| Smoke | 1 | 1 | 100% | 0% | 1.52 s | 6.9 s | Flujo validado ✓ |
| Carga ligera | 50 | 1.560 | 99.76% | 0.30% | 1.05 s | 5.7 s | Holgado ✓ |
| Breakpoint | 300 | 4.282 | 97.26% | 2.59% | 5.95 s | 26.9 s | Al borde ⚠ |
| Breakpoint | 500 | 3.965 | 96.43% | 3.33% | 8.10 s | 35.3 s | Punto de quiebre 🔴 |
| Breakpoint (post-escalado H) | 500 | 3.603 | 99.75% | 0.31% | 8.07 s | 33.6 s | Fiable, mismo techo ⚖️ |

Throughput observado: ~6,3 evid/s @ 50 VUs → ~8,9 evid/s @ 300 VUs → ~8,4 evid/s @ 500 VUs.
El throughput **se estanca en ~8–9 evidencias/s (~60 req/s)**: meter más VUs ya no procesa más, solo encola.

### Post-escalado horizontal (capa de aplicación)

Se repitió la corrida de 500 VUs tras escalar horizontalmente los nodos app:

- **Fiabilidad: mejoró fuerte.** HTTP fallidos 3,33% → 0,31%; checks 96,4% → 99,75%. Los fallos de login bajo
  carga (saturación de PHP-FPM) **desaparecieron** (0 de ~440).
- **Velocidad: sin cambio.** p95 latencia 8,10 → 8,07 s; throughput ~8,4 → ~8,0 evid/s; volvió a abortar al cruzar 8 s.
- **Conclusión:** el escalado de los nodos app **resolvió los errores pero no el techo de throughput**. Como sumar
  nodos no subió la velocidad, el cuello no está en esa capa: apunta a un **recurso compartido** que no escala
  horizontalmente (BD primary / storage / locks del `store`) o al **generador** (uplink de la Mac saturado por los
  uploads). Pendiente: desglosar latencia por etapa (o repetir con 1 imagen) para confirmar cuál.

### Lectura

- El flujo **funciona de punta a punta** (login passwordless → adjuntar → enviar → confirmar) en todos los niveles.
- Hasta **~50 VUs el sistema va holgado** (p95 ~1 s, <0,5% error).
- Entre **300 y 500 VUs el throughput se aplana** (~8–9 evid/s) mientras la latencia se dispara
  (iteración p95 27 s → 35 s, máx 1 min). Es la firma clásica de **saturación**: las peticiones se encolan.
- **Punto de quiebre ≈ 500 VUs concurrentes** (desde una sola IP): la corrida se autoabortó al cruzar p95 de
  latencia 8 s. Importante: el sistema **no devuelve errores masivos** (fallos 3,3 %), se vuelve **lento**.
- Cuellos dominantes desde una sola máquina/IP: el **rate-limit de login** (~50/seg → `429`) y el **ancho de banda
  de bajada** (las props de `mi-testigo` son pesadas, ~3 GB recibidos por corrida). Por eso este techo refleja el
  límite **del generador + throttle**, no necesariamente la capacidad real del backend.
- Para medir el límite real del servidor hace falta **multi-IP o k6 Cloud** (reparte el throttle de login entre orígenes).

Los reportes HTML por corrida quedan como `report-*.html` (gitignored).
