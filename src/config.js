/**
 * src/config.js
 * Centraliza ENV + settings core
 */

const path = require("path");
const { env } = require("./utils/env");
const { ensureSlashStart, removeTrailingSlash } = require("./utils/path");

const PORT = parseInt(env("PORT", "3000"), 10) || 3000;
const PROXY_LOG_LEVEL = env("PROXY_LOG_LEVEL", "warn");

// Upstreams
const SHOP_UPSTREAM = env("SHOP_UPSTREAM", "http://srv-captain--pos360-frontend");
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
const OG_IMAGE_DEFAULT = env("OG_IMAGE_DEFAULT", `${PUBLIC_BASE_URL}/og-default.png`);
const FB_APP_ID = env("FB_APP_ID", "");

// Branch default
const OG_BRANCH_ID = env("OG_BRANCH_ID", "3");

// precio opcional
const OG_TITLE_INCLUDE_PRICE = env("OG_TITLE_INCLUDE_PRICE", "0") === "1";
const OG_PRICE_CURRENCY_DEFAULT = env("OG_PRICE_CURRENCY_DEFAULT", "ARS");

// Ruta local del PNG opcional
const OG_DEFAULT_FILE = path.join(__dirname, "..", "public", "og-default.png");

function applyCoreSettings(app) {
  app.disable("x-powered-by");
  app.enable("strict routing");
}

module.exports = {
  PORT,
  PROXY_LOG_LEVEL,
  SHOP_UPSTREAM,
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
  applyCoreSettings,
  // re-export helpers que se usan mucho
  ensureSlashStart,
  removeTrailingSlash,
};
