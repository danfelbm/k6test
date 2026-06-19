// Smoke test: 1 VU, 1 iteración. Valida el flujo completo end-to-end y deja trazas.
// Uso:  k6 run --env DEBUG=1 smoke.js
// Depurar con cédula fresca:  k6 run --env DEBUG=1 --env IDX=5 smoke.js
import { loginPasswordless } from './lib/auth.js';
import { enviarEvidencia } from './lib/e14.js';
import { pickTestigo, testigos } from './lib/data.js';

export const options = {
    vus: 1,
    iterations: 1,
};

export default function () {
    const fila = pickTestigo(__ENV.IDX || 0);
    console.log(
        `[smoke] testigos=${testigos.length} | documento=${fila.documento} mesa_id=${fila.mesa_id} proceso=${fila.proceso_electoral_id}`
    );

    const login = loginPasswordless(fila.documento);
    console.log(`[smoke] login ok=${login.ok} status=${login.loginStatus} version="${login.version}"`);
    if (!login.ok) {
        console.log('[smoke] ABORTADO: el login falló.');
        return;
    }

    const r = enviarEvidencia(fila, login.version);
    console.log(`[smoke] resultado: etapa=${r.etapa} ok=${r.ok}`);
    if (r.datos) {
        console.log(
            `[smoke] ids usados: formato_id=${r.datos.formato_id} cargo_id=${r.datos.cargo_id} formulario_id=${r.datos.formulario_id}`
        );
    }
    if (r.storeRes) {
        console.log(
            `[smoke] store status=${r.storeRes.status} location=${r.storeRes.headers['Location'] || '(none)'}`
        );
    }
    if (r.ok) {
        console.log('[smoke] ✅ EVIDENCIA ENVIADA (esta cédula queda quemada).');
    }
}
