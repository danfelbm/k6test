// Breakpoint test: rampa incremental de usuarios concurrentes hasta el punto de quiebre.
// Cada iteración = 1 testigo completo (login passwordless → mi-testigo → create → upload → store).
//
// Uso típico (escalando):
//   k6 run --env OFFSET=1000  --env MAX_VUS=50   stress.js     # carga ligera
//   k6 run --env OFFSET=20000 --env MAX_VUS=300  stress.js     # subir el techo
//
// Dashboard en vivo + reporte HTML:
//   K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_EXPORT=report.html \
//     k6 run --env OFFSET=20000 --env MAX_VUS=300 stress.js
import { loginPasswordless } from './lib/auth.js';
import { enviarEvidencia } from './lib/e14.js';
import { tomarTestigoUnico } from './lib/data.js';

const MAX_VUS = parseInt(__ENV.MAX_VUS || '200', 10);

// Construye una escalera de escalones (subida + meseta) hacia MAX_VUS, para observar
// la degradación nivel por nivel en vez de un salto único.
function buildStages(max) {
    const subida = __ENV.RAMP || '30s';
    const meseta = __ENV.HOLD || '45s';
    const escalones = [10, 25, 50, 100, 200, 400, 800, 1500, 3000, 5000].filter((t) => t < max);
    escalones.push(max);

    const stages = [];
    for (const t of escalones) {
        stages.push({ duration: subida, target: t });
        stages.push({ duration: meseta, target: t });
    }
    stages.push({ duration: '20s', target: 0 }); // bajada controlada
    return stages;
}

export const options = {
    scenarios: {
        breakpoint: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: buildStages(MAX_VUS),
            gracefulRampDown: '15s',
            gracefulStop: '30s',
        },
    },
    // El punto de quiebre se detecta automáticamente: si el error global supera 5% o la
    // p95 de latencia supera 8s de forma sostenida, k6 aborta la corrida (ese es el límite).
    thresholds: {
        http_req_failed: [{ threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '15s' }],
        http_req_duration: [{ threshold: 'p(95)<8000', abortOnFail: true, delayAbortEval: '15s' }],
        checks: ['rate>0.95'],
    },
    // Latencia esperada generosa por el upload de imágenes.
    discardResponseBodies: false,
};

export default function () {
    const fila = tomarTestigoUnico();
    const login = loginPasswordless(fila.documento);
    if (!login.ok) {
        return; // el fallo ya quedó registrado en los checks de auth
    }
    enviarEvidencia(fila, login.version);
}
