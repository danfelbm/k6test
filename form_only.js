// Test "SOLO HASTA EL FORMULARIO": login → mi-testigo → página de create. PARA AHÍ.
// NO sube imágenes, NO envía evidencia, NO escribe en BD → NO quema cédulas (reutilizable).
// Objetivo: aislar la NAVEGACIÓN (requests GET livianas) del upload pesado + store.
//   - Si igual topa en ~11/s → el cuello es la concurrencia de requests desde una sola fuente.
//   - Si vuela a 30–50/s → el cuello vive en el upload/BD.
//
// Mismo perfil que arco.js (ramping-arrival-rate 2→PICO→2) para comparar manzana con manzana.
//   k6 run --env OFFSET=0 form_only.js
//   (reporte:  K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_EXPORT=report-formonly.html  antes del comando)
import { check } from 'k6';
import { loginPasswordless } from './lib/auth.js';
import { inertiaGet } from './lib/http.js';
import { tomarTestigoUnico } from './lib/data.js';
import { DEBUG } from './lib/config.js';

const PICO = parseInt(__ENV.PICO || '50', 10);
const START = parseInt(__ENV.START || '2', 10);
const SUBIDA = __ENV.SUBIDA || '7m';
const BAJADA = __ENV.BAJADA || '8m';
const MAX_VUS = parseInt(__ENV.MAX_VUS || '1000', 10);

export const options = {
    scenarios: {
        arco_form: {
            executor: 'ramping-arrival-rate',
            startRate: START,
            timeUnit: '1s',
            preAllocatedVUs: 100,
            maxVUs: MAX_VUS,
            stages: [
                { target: PICO, duration: SUBIDA },
                { target: START, duration: BAJADA },
            ],
        },
    },
    thresholds: {
        http_req_failed: ['rate<0.10'],
        checks: ['rate>0.90'],
    },
};

export default function () {
    const fila = tomarTestigoUnico();

    // 1) Login passwordless (no crea nada)
    const login = loginPasswordless(fila.documento);
    if (!login.ok) {
        return;
    }

    // 2) Dashboard mi-testigo → resolver mesa (slug) y proceso
    const { res: mtRes, page: mtPage } = inertiaGet('/miembro/mi-testigo', login.version, { name: '04_mi_testigo' });
    const mtOk = check(mtRes, { 'mi-testigo 200': (r) => r.status === 200 });
    if (!mtOk || !mtPage || !mtPage.props) {
        if (DEBUG) console.log(`[form] mi-testigo status=${mtRes.status}`);
        return;
    }
    const props = mtPage.props;
    const mesas = props.mesas || [];
    let mesa = mesas.find((m) => String(m.id) === String(fila.mesa_id));
    if (!mesa && mesas.length) mesa = mesas[0];
    if (!mesa || !mesa.slug) {
        check(null, { 'slug resuelto': () => false });
        return;
    }
    const procesoId =
        (props.procesoActual && props.procesoActual.id) || props.procesoVigenteId || fila.proceso_electoral_id;

    // 3) Página del FORMULARIO (create). PARAMOS AQUÍ — no upload, no store.
    const url = `/miembro/divipol/${mesa.slug}/${procesoId}/evidencias/create`;
    const { res: crRes } = inertiaGet(url, login.version, { name: '05_create' });
    check(crRes, { 'create (form) 200': (r) => r.status === 200 });
    // FIN. Ninguna evidencia creada, ninguna cédula quemada.
}
