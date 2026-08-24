/**
 * src/config.js
 * ✅ COPY-PASTE FINAL COMPLETO (SIN ROMPER NADA)
 * Centraliza ENV + settings core
 *
 * ✅ Agrega:
 * - FAVICON_STORAGE_URL / APPLE_TOUCH_STORAGE_URL (para servir favicon same-origin desde edge)
 * - BRAND_ASSET_VERSION (para cortar cache pegajoso, especialmente /shop)
 *
 * No altera tus defaults existentes.
 */

const path = require("path");
const { env } = require("./utils/env");
const { ensureSlashStart, removeTrailingSlash } = require("./utils/path");

const PORT = parseInt(env("PORT", "3000"), 10) || 3000;
const PROXY_LOG_LEVEL = env("PROXY_LOG_LEVEL", "warn");

// Upstreams
const SHOP_UPSTREAM = env("SHOP_UPSTREAM", "http://srv-captain--pos360-frontend");

// Backoffice POS (/app/). Se separa de SHOP_UPSTREAM para poder mover SOLO la
// tienda a otro servicio sin arrastrar el POS, que es lo que se usa en el
// mostrador y no puede cortarse.
//
// Por defecto vale lo mismo que SHOP_UPSTREAM: mientras no se setee por
// entorno, el ruteo es EXACTAMENTE el de antes.
//
// Los estáticos (/assets, robots, manifest) siguen en SHOP_UPSTREAM a
// propósito: recién cuando exista el otro servicio se va a poder ver qué
// pide cada build y decidir con datos en vez de suponer.
const APP_UPSTREAM = env("APP_UPSTREAM", SHOP_UPSTREAM);

const API_ORIGIN = env("API_ORIGIN", "http://srv-captain--pos360-commerce-api:3000");
const API_BASE = env("API_BASE", "/api/v1");

// Base pública
const PUBLIC_BASE_URL = removeTrailingSlash(env("PUBLIC_BASE_URL", "https://sanjuantecnologia.com"));

// Paths
const FRONTEND_INDEX_PATH = env("FRONTEND_INDEX_PATH", "/shop/");
const APP_INDEX_PATH = env("APP_INDEX_PATH", "/shop/app/");

// OG defaults
const OG_SITE_NAME = env("OG_SITE_NAME", "San Juan Tecnología");
const OG_TITLE_DEFAULT = env("OG_TITLE_DEFAULT", "San Juan Tecnología | Tienda");
const OG_DESCRIPTION_DEFAULT = env(
  "OG_DESCRIPTION_DEFAULT",
  "Electrónica, ecommerce, sistemas POS y soluciones tecnológicas para empresas."
);

// ✅ Por defecto apuntá a tu og estable en storage si no lo seteás por env
// (igual tu env actual ya lo pisa)
const OG_IMAGE_DEFAULT = env("OG_IMAGE_DEFAULT", `${PUBLIC_BASE_URL}/og-default.png`);

const FB_APP_ID = env("FB_APP_ID", "");

// Branch default
const OG_BRANCH_ID = env("OG_BRANCH_ID", "3");

// precio opcional
const OG_TITLE_INCLUDE_PRICE = env("OG_TITLE_INCLUDE_PRICE", "0") === "1";
const OG_PRICE_CURRENCY_DEFAULT = env("OG_PRICE_CURRENCY_DEFAULT", "ARS");

// Ruta local del PNG opcional
const OG_DEFAULT_FILE = path.join(__dirname, "..", "public", "og-default.png");

/**
 * ✅ Branding assets (favicon / apple-touch)
 * Tu storage público expone: https://storage-files.cingulado.org/<key>
 * y tus keys reales son pos360/shop/....
 */
const FAVICON_STORAGE_URL = env(
  "FAVICON_STORAGE_URL",
  "https://storage-files.cingulado.org/pos360/shop/favicon.png"
);

const APPLE_TOUCH_STORAGE_URL = env("APPLE_TOUCH_STORAGE_URL", FAVICON_STORAGE_URL);

/**
 * ✅ Para cortar cache pegajoso del favicon (sobre todo entrando /shop):
 * - Si lo seteás: BRAND_ASSET_VERSION=20260127
 * - Si no lo seteás, lo dejamos vacío y la route decide cómo versionar (ej diario).
 */
const BRAND_ASSET_VERSION = env("BRAND_ASSET_VERSION", "");

/**
 * ✅ Suspension administrativa del backoffice (/app/)
 *
 * Corte de acceso decidido por nosotros, NO una falla de infraestructura: la
 * pantalla lo dice con todas las letras. Apagado por defecto.
 *
 * - APP_SUSPENDIDO=1            prende el corte (pide restart)
 * - APP_SUSPENDIDO_FILE=<path>  archivo bandera: si existe, corta. Permite
 *                               prender y apagar en caliente, sin redeploy.
 *
 * Los textos y el contacto son configurables para no hardcodear datos del
 * cliente en el repo.
 */
const APP_SUSPENDIDO = env("APP_SUSPENDIDO", "0") === "1";
const APP_SUSPENDIDO_FILE = env("APP_SUSPENDIDO_FILE", "");

const SUSPENSION_TITULO = env("SUSPENSION_TITULO", "Servicio suspendido");
const SUSPENSION_MENSAJE = env(
  "SUSPENSION_MENSAJE",
  "El acceso al panel de gestión está suspendido temporalmente. Para reactivarlo, comunicate con el administrador del sistema."
);
const SUSPENSION_CONTACTO_TEXTO = env("SUSPENSION_CONTACTO_TEXTO", "");
const SUSPENSION_CONTACTO_HREF = env("SUSPENSION_CONTACTO_HREF", "");
const SUSPENSION_CONTACTO_BOTON = env("SUSPENSION_CONTACTO_BOTON", "Contactar");
const SUSPENSION_RETRY_AFTER = parseInt(env("SUSPENSION_RETRY_AFTER", "3600"), 10) || 3600;

function applyCoreSettings(app) {
  app.disable("x-powered-by");
  app.enable("strict routing");
}

module.exports = {
  PORT,
  PROXY_LOG_LEVEL,
  SHOP_UPSTREAM,
  APP_UPSTREAM,
  API_ORIGIN,
  API_BASE,
  PUBLIC_BASE_URL,
  FRONTEND_INDEX_PATH,
  APP_INDEX_PATH,
  OG_SITE_NAME,
  OG_TITLE_DEFAULT,
  OG_DESCRIPTION_DEFAULT,
  OG_IMAGE_DEFAULT,
  FB_APP_ID,
  OG_BRANCH_ID,
  OG_TITLE_INCLUDE_PRICE,
  OG_PRICE_CURRENCY_DEFAULT,
  OG_DEFAULT_FILE,

  // ✅ NUEVOS exports (no rompen nada)
  FAVICON_STORAGE_URL,
  APPLE_TOUCH_STORAGE_URL,
  BRAND_ASSET_VERSION,

  // ✅ Suspension del backoffice
  APP_SUSPENDIDO,
  APP_SUSPENDIDO_FILE,
  SUSPENSION_TITULO,
  SUSPENSION_MENSAJE,
  SUSPENSION_CONTACTO_TEXTO,
  SUSPENSION_CONTACTO_HREF,
  SUSPENSION_CONTACTO_BOTON,
  SUSPENSION_RETRY_AFTER,

  applyCoreSettings,

  // re-export helpers que se usan mucho
  ensureSlashStart,
  removeTrailingSlash,
};
