import { SharedArray } from 'k6/data';
import exec from 'k6/execution';
import { CSV_PATH } from './config.js';

// Carga única del CSV en memoria compartida entre todos los VUs (no se duplica por VU).
// Parseo manual (el CSV es plano: sin comas internas ni comillas). Removemos el BOM
// inicial y resolvemos las columnas por nombre desde el encabezado.
export const testigos = new SharedArray('testigos', function () {
    let raw = open(CSV_PATH);
    if (raw.charCodeAt(0) === 0xfeff) {
        raw = raw.slice(1); // strip BOM
    }
    const lines = raw.split(/\r?\n/);
    const header = lines[0].split(',');
    const iDoc = header.indexOf('documento');
    const iMesa = header.indexOf('mesa_id');
    const iProc = header.indexOf('proceso_electoral_id');

    const out = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;
        const cols = line.split(',');
        const documento = (cols[iDoc] || '').trim();
        if (!documento) continue;
        out.push({
            documento,
            mesa_id: parseInt(cols[iMesa], 10),
            proceso_electoral_id: parseInt(cols[iProc], 10),
        });
    }
    return out;
});

// Devuelve una fila ÚNICA por iteración global (cada cédula se usa una sola vez).
// iterationInTest es un contador incremental a través de todos los VUs del escenario.
// __ENV.OFFSET desplaza el punto de inicio para NO reusar cédulas ya quemadas en
// corridas anteriores (cada evidencia solo puede enviarse una vez).
export function tomarTestigoUnico() {
    const offset = parseInt(__ENV.OFFSET || '0', 10);
    const n = testigos.length;
    const idx = (offset + exec.scenario.iterationInTest) % n;
    return testigos[idx];
}

// Selección por índice explícito (útil para depurar el smoke con cédulas frescas: __ENV.IDX).
export function pickTestigo(idx) {
    const n = testigos.length;
    const i = (((parseInt(idx, 10) || 0) % n) + n) % n;
    return testigos[i];
}
