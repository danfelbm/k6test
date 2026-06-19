import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, DEBUG } from './config.js';
import { baseHeaders, postHeaders } from './http.js';

// Extrae la versión de assets de Inertia desde el HTML inicial (atributo data-page).
// El HTML trae <div id="app" data-page="{...json HTML-encoded...}">.
function extraerInertiaVersion(html) {
    const m = (html || '').match(/data-page="([^"]+)"/);
    if (!m) {
        return '';
    }
    try {
        const json = m[1].replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&');
        const page = JSON.parse(json);
        return page.version || '';
    } catch (e) {
        return '';
    }
}

// Login passwordless de un testigo NO administrativo: 2 pasos, sin contraseña.
// Devuelve { ok, version, loginStatus } — version se reutiliza en los GET Inertia.
export function loginPasswordless(documento) {
    // 1) GET /login (HTML) → siembra cookies (sesión + XSRF-TOKEN) y captura la versión Inertia.
    const getRes = http.get(BASE_URL + '/login', { headers: baseHeaders(), tags: { name: '01_get_login' } });
    const version = extraerInertiaVersion(getRes.body);
    check(getRes, { 'GET /login 200': (r) => r.status === 200 });

    // 2) POST /login/check-credential → debe responder action=passwordless para no-admin.
    const checkRes = http.post(
        BASE_URL + '/login/check-credential',
        JSON.stringify({ credential: documento }),
        {
            headers: postHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
            tags: { name: '02_check_credential' },
        }
    );
    let action = null;
    try {
        action = checkRes.json('action');
    } catch (e) {
        action = null;
    }
    check(checkRes, {
        'check-credential 200': (r) => r.status === 200,
        'action passwordless': () => action === 'passwordless',
    });
    if (DEBUG && action !== 'passwordless') {
        console.log(`[auth] check-credential status=${checkRes.status} body=${String(checkRes.body).slice(0, 300)}`);
    }

    // 3) POST /login (sin password) → 302 hacia /miembro/...
    const loginRes = http.post(
        BASE_URL + '/login',
        JSON.stringify({ credential: documento, password: null, remember: false }),
        {
            headers: postHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
            redirects: 0,
            tags: { name: '03_login' },
        }
    );
    const loginOk = check(loginRes, {
        'login 302/200/204': (r) => r.status === 302 || r.status === 200 || r.status === 204,
    });
    if (DEBUG && !loginOk) {
        console.log(`[auth] login status=${loginRes.status} body=${String(loginRes.body).slice(0, 400)}`);
    }

    return { ok: loginOk && action === 'passwordless', version, loginStatus: loginRes.status };
}
