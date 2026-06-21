// Carga SOSTENIDA a tasa constante, para monitorear en tiempo real.
// Objetivo: 6 evidencias/seg fijas durante varios minutos (no es rampa: tasa de llegada constante).
// 1 imagen por evidencia (default actual en config.js).
//
// Arranca SOLO con la señal. Comando:
//   k6 run --env OFFSET=0 --env RATE=6 --env DURATION=10m sostenido.js
// Con dashboard en vivo + reporte:
//   K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_EXPORT=report-sostenido.html \
//     k6 run --env OFFSET=0 --env RATE=6 --env DURATION=10m sostenido.js
import { loginPasswordless } from './lib/auth.js';
import { enviarEvidencia } from './lib/e14.js';
import { tomarTestigoUnico } from './lib/data.js';

const RATE = parseInt(__ENV.RATE || '6', 10); // iteraciones (evidencias) por segundo
const DURATION = __ENV.DURATION || '10m'; // cuánto sostener la carga
// Con think time, VUs ≈ rate × latencia (~19s). Configurable por env para no quedarse sin VUs.
const MAX_VUS = parseInt(__ENV.MAX_VUS || '1500', 10);
const PRE_VUS = parseInt(__ENV.PRE_VUS || String(Math.min(MAX_VUS, Math.max(50, RATE * 20))), 10);

export const options = {
    scenarios: {
        sostenido: {
            executor: 'constant-arrival-rate',
            rate: RATE,
            timeUnit: '1s',
            duration: DURATION,
            // VUs pre-asignados para arrancar de inmediato a la tasa objetivo, con colchón
            // por si la latencia por iteración sube (ley de Little: VUs ≈ rate × latencia).
            preAllocatedVUs: PRE_VUS,
            maxVUs: MAX_VUS,
        },
    },
    // Umbrales informativos, SIN abortOnFail: la corrida debe completar toda la duración
    // para poder monitorear en tiempo real, aunque haya degradación puntual.
    thresholds: {
        http_req_failed: ['rate<0.05'],
        checks: ['rate>0.95'],
    },
};

export default function () {
    const fila = tomarTestigoUnico();
    const login = loginPasswordless(fila.documento);
    if (!login.ok) {
        return;
    }
    enviarEvidencia(fila, login.version);
}
