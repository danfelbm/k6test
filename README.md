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
| Carga ligera | 50 | 1.560 | 99.76% | 0.30% | **1.05 s** | 5.7 s | Holgado ✓ |
| Breakpoint | 300 | 4.282 | 97.26% | 2.59% | 5.95 s | **26.9 s** | Al borde ⚠ |
| Breakpoint | 500 | _(en curso)_ | | | | | |

Throughput observado: ~6,3 evidencias/s @ 50 VUs → ~8,9 evidencias/s @ 300 VUs (ya saturándose).

### Lectura

- El flujo **funciona de punta a punta** (login passwordless → adjuntar → enviar → confirmar).
- Hasta **~50 VUs el sistema va holgado** (p95 ~1 s, <0,5% error).
- Hacia **~300 VUs concurrentes desde una sola IP** empieza a degradarse: la latencia por iteración sube a
  decenas de segundos y el login arroja `429` (rate limit ~50/seg por IP). Ese rate-limit, más el ancho de banda
  de bajada (las props de `mi-testigo` son pesadas), son el primer cuello **del generador/throttle**, no
  necesariamente de la capacidad de procesar evidencias.
- Para empujar más allá hace falta **multi-IP o k6 Cloud** (reparte el throttle de login entre orígenes).

Los reportes HTML por corrida quedan como `report-*.html` (gitignored).
