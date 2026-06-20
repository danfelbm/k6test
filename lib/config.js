// Configuración central del test de estrés E-14.
// Todo parametrizable por variables de entorno (__ENV) para no tocar código entre corridas.

// URL base del entorno de estrés (sin slash final).
export const BASE_URL = (__ENV.BASE_URL || 'https://stress.movimientopactohistorico.co').replace(/\/$/, '');

// Cuántas imágenes adjuntar por evidencia (1 a 3). Default 1 (carga sostenida y experimento
// de aislamiento del cuello: menos peso de upload). Override con __ENV.IMAGES_COUNT.
export const IMAGES_COUNT = Math.min(3, Math.max(1, parseInt(__ENV.IMAGES_COUNT || '1', 10)));

// Ruta del CSV de testigos. El open() vive en lib/data.js, así que la ruta relativa
// por defecto sube un nivel ('../'). Override con __ENV.CSV_PATH (admite ruta absoluta).
export const CSV_PATH = __ENV.CSV_PATH || '../testigos_stress_100000.csv';

// User-Agent realista (algunos WAF / rate-limiters lo inspeccionan).
export const USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 k6-stress';

// Activa logs de depuración (dump de props Inertia, cuerpos de error, etc.).
export const DEBUG = !!__ENV.DEBUG;
