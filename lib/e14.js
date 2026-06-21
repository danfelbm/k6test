import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, IMAGES_COUNT, DEBUG } from './config.js';
import { inertiaGet, postHeaders } from './http.js';

// Imágenes precargadas como binario en el init context (una sola vez por proceso).
// Las rutas son relativas a este archivo (lib/), por eso el '../assets/'.
const IMG_FILES = [
    { bin: open('../assets/e14_1.jpg', 'b'), name: 'e14_1.jpg' },
    { bin: open('../assets/e14_2.jpg', 'b'), name: 'e14_2.jpg' },
    { bin: open('../assets/e14_3.jpg', 'b'), name: 'e14_3.jpg' },
];

// --- Think time: simula a la persona REAL navegando y LLENANDO el formulario (no instantáneo).
// Realista: unos segundos mirando el dashboard, y ~10s llenando el form + eligiendo/tomando fotos.
// Aleatorizado para que las entregas no lleguen todas sincronizadas (como en la vida real).
// Parametrizable por env. Para desactivarlo (p.ej. smoke rápido): THINK_FORM_MAX=0 THINK_NAV_MAX=0.
const THINK_NAV_MIN = parseFloat(__ENV.THINK_NAV_MIN || '2');
const THINK_NAV_MAX = parseFloat(__ENV.THINK_NAV_MAX || '5');
const THINK_FORM_MIN = parseFloat(__ENV.THINK_FORM_MIN || '7');
const THINK_FORM_MAX = parseFloat(__ENV.THINK_FORM_MAX || '13');
function think(min, max) {
    if (max > 0) sleep(min + Math.random() * Math.max(0, max - min));
}

// --- Paso A: dashboard mi-testigo → resolver el slug de la mesa del testigo ---
function obtenerDatosDashboard(fila, version) {
    const { res, page } = inertiaGet('/miembro/mi-testigo', version, { name: '04_mi_testigo' });
    check(res, { 'mi-testigo 200': (r) => r.status === 200 });
    if (!page || !page.props) {
        if (DEBUG) console.log(`[mi-testigo] sin props. status=${res.status} body=${String(res.body).slice(0, 300)}`);
        return null;
    }
    const props = page.props;
    if (DEBUG) console.log(`[mi-testigo] props keys: ${Object.keys(props).join(', ')}`);

    const mesas = props.mesas || [];
    if (DEBUG) console.log(`[mi-testigo] mesas[0]: ${JSON.stringify(mesas[0] || null).slice(0, 600)}`);

    // Buscar la mesa que coincide con el mesa_id del CSV; si no, la primera.
    let mesa = mesas.find((m) => String(m.id) === String(fila.mesa_id));
    if (!mesa && mesas.length) mesa = mesas[0];

    const procesoId =
        (props.procesoActual && props.procesoActual.id) || props.procesoVigenteId || fila.proceso_electoral_id;

    if (DEBUG) console.log(`[mi-testigo] slug=${mesa ? mesa.slug : null} procesoId=${procesoId}`);
    return mesa ? { slug: mesa.slug, procesoId, mesa } : null;
}

// --- Paso B: GET create → formato_id (E-14), cargo_id, formulario_id, campos ---
function obtenerDatosCreate(slug, procesoId, version) {
    const url = `/miembro/divipol/${slug}/${procesoId}/evidencias/create`;
    const { res, page } = inertiaGet(url, version, { name: '05_create' });
    check(res, { 'create 200': (r) => r.status === 200 });
    if (!page || !page.props) {
        if (DEBUG) console.log(`[create] sin props. status=${res.status} body=${String(res.body).slice(0, 300)}`);
        return null;
    }
    const p = page.props;
    if (DEBUG) console.log(`[create] props keys: ${Object.keys(p).join(', ')}`);

    // Formato E-14.
    const formatos = p.formatos || [];
    if (DEBUG) console.log(`[create] formatos: ${JSON.stringify(formatos).slice(0, 500)}`);
    let formato = formatos.find((f) => {
        const c = String(f.codigo || f.nombre || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        return c.indexOf('E14') >= 0;
    });
    if (!formato && formatos.length) formato = formatos[0];

    // Cargo.
    const cargos = p.cargosDisponibles || [];
    if (DEBUG) console.log(`[create] cargosDisponibles: ${JSON.stringify(cargos).slice(0, 500)}`);
    const cargo = cargos.length ? cargos[0] : null;
    const cargoId = cargo ? (cargo.value !== undefined ? cargo.value : cargo.id) : null;

    // Formulario vinculado: formulariosVinculados[formato_id][cargo_id] o ['global'].
    let formulario = null;
    const fv = p.formulariosVinculados || {};
    if (formato && fv[formato.id]) {
        formulario = (cargoId != null && fv[formato.id][cargoId]) || fv[formato.id]['global'] || null;
    }
    if (DEBUG) console.log(`[create] formulario: ${JSON.stringify(formulario).slice(0, 800)}`);

    return {
        formato_id: formato ? formato.id : null,
        cargo_id: cargoId,
        formulario_id: formulario ? formulario.id : null,
        formulario,
    };
}

// Genera respuestas válidas para los campos REQUERIDOS del formulario vinculado.
function generarRespuestas(formulario) {
    const respuestas = {};
    const campos = (formulario && (formulario.campos || formulario.configuracion_campos)) || [];
    for (const campo of campos) {
        const id = campo.id;
        const tipo = campo.tipo || campo.type;
        const req = campo.requerido || campo.required;
        if (!req) continue; // solo lo requerido basta para pasar validación
        if (tipo === 'number') {
            const cfg = campo.numberConfig || campo.config || {};
            const min = Number.isFinite(cfg.min) ? cfg.min : 0;
            const max = Number.isFinite(cfg.max) ? cfg.max : 200;
            respuestas[id] = Math.floor(min + Math.random() * (max - min + 1));
        } else if (tipo === 'select' && campo.options && campo.options.length) {
            const opt = campo.options[0];
            respuestas[id] = opt.value !== undefined ? opt.value : opt;
        } else {
            respuestas[id] = 'STRESS';
        }
    }
    return respuestas;
}

// --- Paso C: upload de imágenes → paths ---
function subirImagenes() {
    const data = { module: 'evidencias', field_id: 'formato-electoral' };
    for (let i = 0; i < IMAGES_COUNT; i++) {
        const f = IMG_FILES[i];
        data[`files[${i}]`] = http.file(f.bin, f.name, 'image/jpeg');
    }
    const res = http.post(BASE_URL + '/miembro/api/files/upload', data, {
        headers: postHeaders(),
        tags: { name: '06_upload' },
    });
    let paths = [];
    let names = [];
    try {
        const j = res.json();
        if (j && j.files) {
            paths = j.files.map((x) => x.path);
            names = j.files.map((x) => x.name);
        }
    } catch (e) {
        /* noop */
    }
    if (DEBUG && paths.length === 0) {
        console.log(`[upload] status=${res.status} body=${String(res.body).slice(0, 400)}`);
    }
    return { res, paths, names };
}

// --- Paso D: store de la evidencia ---
function enviarStore(fila, slug, procesoId, datos, paths, names) {
    const url = `/miembro/divipol/${slug}/${procesoId}/evidencias`;
    const body = {
        mesa_id: fila.mesa_id,
        formato_id: datos.formato_id,
        cargo_id: datos.cargo_id,
        observacion: 'Carga de estres automatizada',
    };
    if (datos.formulario_id) body.formulario_id = datos.formulario_id;
    paths.forEach((p, i) => {
        body[`archivos_paths[${i}]`] = p;
    });
    names.forEach((n, i) => {
        body[`archivos_nombres[${i}]`] = n;
    });
    const respuestas = generarRespuestas(datos.formulario);
    Object.keys(respuestas).forEach((k) => {
        body[`respuestas_formulario[${k}]`] = respuestas[k];
    });

    const res = http.post(BASE_URL + url, body, {
        headers: postHeaders(),
        redirects: 0,
        tags: { name: '07_store' },
    });
    if (DEBUG && !(res.status === 302 || res.status === 303)) {
        console.log(`[store] status=${res.status} body=${String(res.body).slice(0, 600)}`);
    }
    return res;
}

// Orquesta el flujo completo de una evidencia. Devuelve { ok, etapa, ... }.
export function enviarEvidencia(fila, version) {
    const md = obtenerDatosDashboard(fila, version);
    if (!md || !md.slug) {
        check(null, { 'slug resuelto': () => false });
        return { ok: false, etapa: 'dashboard' };
    }

    // El testigo ve su dashboard y hace clic para enviar el E-14 (no instantáneo).
    think(THINK_NAV_MIN, THINK_NAV_MAX);

    const datos = obtenerDatosCreate(md.slug, md.procesoId, version);
    if (!datos || !datos.formato_id || datos.cargo_id == null) {
        check(null, { 'datos create resueltos': () => false });
        return { ok: false, etapa: 'create', md };
    }

    // El testigo LLENA el formulario y selecciona/toma las fotos (lo más lento del flujo real, ~10s).
    think(THINK_FORM_MIN, THINK_FORM_MAX);

    const up = subirImagenes();
    const upOk = check(up.res, {
        'upload 200': (r) => r.status === 200 || r.status === 201,
        'paths recibidos': () => up.paths.length > 0,
    });
    if (!upOk) {
        return { ok: false, etapa: 'upload', md, datos };
    }

    const storeRes = enviarStore(fila, md.slug, md.procesoId, datos, up.paths, up.names);
    const ok = check(storeRes, { 'store 302/303': (r) => r.status === 302 || r.status === 303 });
    return { ok, etapa: 'store', storeRes, datos, md };
}
