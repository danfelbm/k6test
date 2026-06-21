// Test de CONCURRENCIA en ARCO: la tasa de llegada (iter/seg) sube poco a poco hasta un
// pico y luego baja. Perfil triangular: empieza en START, pico de PICO/seg al minuto 7,
// y baja de nuevo hasta terminar (~minuto 15). Sin meta de volumen.
// Cada iteración = 1 evidencia completa (login passwordless → mi-testigo → create → upload → store).
//
// Arranca SOLO con la señal:
//   K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_EXPORT=report-arco.html \
//     k6 run --env OFFSET=0 arco.js
import { loginPasswordless } from './lib/auth.js';
import { enviarEvidencia } from './lib/e14.js';
import { tomarTestigoUnico } from './lib/data.js';

const PICO = parseInt(__ENV.PICO || '50', 10); // tasa pico (iteraciones/seg)
const START = parseInt(__ENV.START || '2', 10); // tasa inicial y final
const SUBIDA = __ENV.SUBIDA || '7m'; // tiempo en alcanzar el pico
const BAJADA = __ENV.BAJADA || '8m'; // tiempo de descenso tras el pico
const MAX_VUS = parseInt(__ENV.MAX_VUS || '1000', 10); // techo de VUs para sostener el pico

export const options = {
    scenarios: {
        arco: {
            executor: 'ramping-arrival-rate',
            startRate: START,
            timeUnit: '1s',
            preAllocatedVUs: 100,
            maxVUs: MAX_VUS,
            stages: [
                { target: PICO, duration: SUBIDA }, // sube START → PICO (pico al final de SUBIDA)
                { target: START, duration: BAJADA }, // baja PICO → START (cierra el test)
            ],
        },
    },
    // Umbrales informativos, SIN abortOnFail: queremos ver el arco completo aunque el
    // sistema sature en el pico (ahí está el dato de concurrencia que buscamos).
    thresholds: {
        http_req_failed: ['rate<0.10'],
        checks: ['rate>0.90'],
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
