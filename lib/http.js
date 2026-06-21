import http from 'k6/http';
import { BASE_URL, USER_AGENT } from './config.js';

// Lee el cookie XSRF-TOKEN del jar del VU y lo devuelve decodificado, listo para
// enviarse en el header X-XSRF-TOKEN (replica exactamente lo que hace axios/Inertia).
export function xsrfToken() {
    const jar = http.cookieJar();
    const cookies = jar.cookiesForURL(BASE_URL + '/');
    const raw = cookies['XSRF-TOKEN'];
    if (!raw || !raw.length) {
        return '';
    }
    return decodeURIComponent(raw[0]);
}

// Headers base "de navegador".
export function baseHeaders(extra) {
    return Object.assign(
        {
            'User-Agent': USER_AGENT,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'es-CO,es;q=0.9',
            // Pide compresión como un navegador real (k6 descomprime solo). Antes faltaba
            // → el test bajaba sin comprimir (~5x más bytes que un usuario real).
            'Accept-Encoding': 'gzip, br',
        },
        extra || {}
    );
}

// Headers para un GET de página Inertia (devuelve JSON con las props).
export function inertiaHeaders(version) {
    return baseHeaders({
        'X-Inertia': 'true',
        'X-Inertia-Version': version || '',
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json, text/plain, */*',
    });
}

// Headers para un POST con cuerpo. Incluye el token CSRF y marca de XHR.
// No fija Content-Type a propósito: para multipart, k6 lo setea con su boundary.
export function postHeaders(extra) {
    return baseHeaders(
        Object.assign(
            {
                'X-XSRF-TOKEN': xsrfToken(),
                'X-Requested-With': 'XMLHttpRequest',
                Origin: BASE_URL,
                Referer: BASE_URL + '/',
            },
            extra || {}
        )
    );
}

// GET de una página Inertia → { res, page } donde page = {component, props, url, version}.
export function inertiaGet(url, version, tags) {
    const res = http.get(BASE_URL + url, { headers: inertiaHeaders(version), tags: tags || {} });
    let page = null;
    try {
        page = res.json();
    } catch (e) {
        page = null;
    }
    return { res, page };
}
