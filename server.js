/**
 * ✅ pos360-edge/server.js
 * ✅ COPY-PASTE FINAL DEFINITIVO (FIX ASSETS 404 + /shop + compat /assets + compat /api/v1 + APP en /app)
 *
 * FIX CLAVE:
 * - Vite genera <script src="/shop/assets/..."> y <link href="/shop/assets/...">
 * - Express cuando montás "/shop/assets/" entrega al proxy SOLO "/index-xxx.js"
 * - Entonces el rewrite debe RE-PREFIJAR "/assets" (no hacer replace de "/shop")
 *
 * FIX API CLAVE:
 * - Tu frontend HOY está llamando "/api/v1/..." (según consola)
 * - En edge sólo existía "/api/..." => 404
 * - Solución: compat /api/v1/* (y opcional /public/*) hacia API_ORIGIN
 *
 * FIX APP CLAVE (backoffice dentro del MISMO frontend):
 * - Tu backoffice vive bajo "/shop/app/" (porque base pública es /shop/)
 * - Entonces /app/* debe redirigir a /shop/app/* (sin proxy a otro upstream)
 *
 * Rutas:
 *  - /health        -> 200
 *  - /              -> 301 /shop/
 *  - /shop          -> 301 /shop/
 *  - /shop/assets/* -> proxy a frontend como /assets/*
 *  - /shop/*        -> proxy a frontend (PRESERVA /shop hacia upstream)
 *  - /assets/*      -> (compat) proxy a frontend como /assets/*
 *  - /favicon.ico   -> (compat) proxy a frontend como /favicon.ico
 *  - /api/*         -> proxy a API (rewrite a /api/v1/*)
 *  - /api/v1/*      -> ✅ compat directo a API (builds que llaman /api/v1)
 *  - /public/*      -> ✅ compat directo a API (por si alguna vez se usa)
 *  - /app/*         -> ✅ redirect a /shop/app/*
 */

const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();

function env(name, fallback) {
  const v = process.env[name];
  return v !== undefined && v !== null && String(v).trim() !== ""
    ? String(v).trim()
    : fallback;
}

function ensureSlashStart(p) {
  if (!p) return "/";
  return p.startsWith("/") ? p : `/${p}`;
}
function removeTrailingSlash(p) {
  return p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;
}
function joinPrefix(prefix, path) {
  // prefix: "/shop/" o "/shop"
  // path: "/product/303" o "/"
  const pfx = removeTrailingSlash(ensureSlashStart(prefix));
  const pth = ensureSlashStart(path);
  if (pth === "/") return `${pfx}/`;
  return `${pfx}${pth}`;
}

const PORT = parseInt(env("PORT", "3000"), 10) || 3000;
const PROXY_LOG_LEVEL = env("PROXY_LOG_LEVEL", "warn");

// Upstreams
const SHOP_UPSTREAM = env("SHOP_UPSTREAM", "http://srv-captain--pos360-frontend");
const API_ORIGIN = env("API_ORIGIN", "http://srv-captain--pos360-commerce-api:3000");
const API_BASE = env("API_BASE", "/api/v1"); // default

// Base pública (no se usa en routing, queda para logs/debug)
const PUBLIC_BASE_URL = env("PUBLIC_BASE_URL", "https://sanjuantecnologia.com");

// Donde vive el frontend (público)
const FRONTEND_INDEX_PATH = env("FRONTEND_INDEX_PATH", "/shop/"); // "/shop/"
const APP_INDEX_PATH = env("APP_INDEX_PATH", "/shop/app/"); // backoffice dentro del mismo FE

// ====== Core settings ======
app.disable("x-powered-by");
app.enable("strict routing");

// ====== Health ======
app.get("/health", (req, res) => {
  res.setHeader("X-EDGE-BUILD", "EDGE_STABLE_SHOP_ASSETS_APIv1_APPREDIRECT_01");
  res.json({
    ok: true,
    edge: "pos360-edge",
    time: new Date().toISOString(),
    host: req.headers.host || null,
    proto: req.headers["x-forwarded-proto"] || req.protocol,
  });
});

// ====== Helpers: proxy builder ======
function makeProxy(target, opts = {}) {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    secure: false, // targets internos http
    ...opts,
    onProxyReq(proxyReq, req, res) {
      proxyReq.setHeader("Host", req.headers.host || "");
      if (opts.onProxyReq) opts.onProxyReq(proxyReq, req, res);
    },
    onError(err, req, res) {
      console.error("❌ proxy error:", req.method, req.originalUrl, err && err.message ? err.message : err);
      if (res.headersSent) return;
      res.status(502).json({
        ok: false,
        error: "Bad Gateway",
        path: req.originalUrl,
        message: String(err && err.message ? err.message : err),
      });
    },
  });
}

/**
 * ✅ 1) SHOP ASSETS FIRST
 * Montado en "/shop/assets/" => al proxy le llega "/index-xxx.js"
 * Necesitamos mandarlo al upstream como "/assets/index-xxx.js"
 */
const shopAssetsFirstProxy = makeProxy(SHOP_UPSTREAM, {
  pathRewrite: (p) => `/assets${ensureSlashStart(p)}`,
});

/**
 * ✅ 2) SHOP proxy general (PRESERVA /shop)
 * Express al montar "/shop/" pasa req.url SIN "/shop".
 * Acá lo reponemos: "/" -> "/shop/", "/product/303" -> "/shop/product/303"
 *
 * 🔥 IMPORTANTE:
 * - Esto evita el loop 301 que viste (upstream espera /shop porque Vite base="/shop/")
 */
const shopProxy = makeProxy(SHOP_UPSTREAM, {
  pathRewrite: (path) => joinPrefix(FRONTEND_INDEX_PATH, path),
});

/**
 * ✅ Compat: si el build/algún HTML pide /assets/* en raíz
 * Montado en "/assets/" => al proxy le llega "/index-xxx.js"
 * Debe ir a "/assets/index-xxx.js"
 */
const rootAssetsProxy = makeProxy(SHOP_UPSTREAM, {
  pathRewrite: (p) => `/assets${ensureSlashStart(p)}`,
});

/**
 * ✅ Compat: estáticos de raíz (favicon, robots, manifest)
 * Acá NO queremos prefijar /assets, deben pasar tal cual.
 */
const rootStaticProxy = makeProxy(SHOP_UPSTREAM);

/**
 * ✅ API proxy
 * /api/... -> /api/v1/...
 * si ya viene /api/v1 no lo duplica
 *
 * IMPORTANTE:
 * - Montado en "/api/" => al proxy le llega "/public/..."
 * - Por eso reinyectamos API_BASE
 */
const apiProxy = makeProxy(API_ORIGIN, {
  pathRewrite: (path) => {
    const base = ensureSlashStart(API_BASE); // "/api/v1"
    if (path.startsWith(base)) return path;
    return `${removeTrailingSlash(base)}${ensureSlashStart(path)}`;
  },
});

/**
 * ✅ COMPAT: /api/v1/* directo a la API
 * - Montado en "/api/v1/" => al proxy le llega "/public/..."
 * - Acá NO reescribimos
 */
const apiV1CompatProxy = makeProxy(API_ORIGIN);

/**
 * ✅ COMPAT: /public/* directo a la API
 */
const publicCompatProxy = makeProxy(API_ORIGIN);

// ====== Redirects base ======
app.get("/", (req, res) =>
  res.redirect(301, removeTrailingSlash(FRONTEND_INDEX_PATH) + "/")
);
app.get("/shop", (req, res) => res.redirect(301, "/shop/"));

// ✅ APP: como vive dentro del mismo FE en "/shop/app/", redirigimos
app.get("/app", (req, res) =>
  res.redirect(302, removeTrailingSlash(APP_INDEX_PATH) + "/")
);
app.use("/app/", (req, res) => {
  const rest = req.originalUrl.replace(/^\/app/, ""); // incluye el "/" del resto
  return res.redirect(302, removeTrailingSlash(APP_INDEX_PATH) + rest);
});

// ====== ✅ MOUNTS (ORDEN IMPORTA) ======

// ✅ 1) assets de vite bajo /shop (PRIMERO)
app.use("/shop/assets/", shopAssetsFirstProxy);

// ✅ 2) compat assets en raíz (por si algo pide /assets/*)
app.use("/assets/", rootAssetsProxy);

// ✅ 3) compat estáticos típicos en raíz
app.get("/favicon.ico", rootStaticProxy);
app.get("/robots.txt", rootStaticProxy);
app.get("/manifest.webmanifest", rootStaticProxy);
app.get("/manifest.json", rootStaticProxy);

// ✅ 4) shop general (DESPUÉS)
app.use("/shop/", shopProxy);

// ✅ 5) ✅ compat API PRIMERO (para builds que llaman /api/v1)
app.use("/api/v1/", apiV1CompatProxy);
app.use("/public/", publicCompatProxy);

// ✅ 6) api “oficial” del edge (/api -> /api/v1)
app.use("/api/", apiProxy);

// ====== 404 edge ======
app.use((req, res) => {
  res.setHeader("X-EDGE-HIT", "edge-404");
  res.status(404).json({ ok: false, error: "Not Found", path: req.originalUrl });
});

// ====== Start ======
app.listen(PORT, () => {
  console.log(`✅ pos360-edge listo en :${PORT}`);
  console.log(`shop -> ${SHOP_UPSTREAM}`);
  console.log(`api -> ${API_ORIGIN}${API_BASE}`);
  console.log(`app -> ${SHOP_UPSTREAM} (mapped to ${APP_INDEX_PATH})`);
  console.log(`PUBLIC_BASE_URL -> ${PUBLIC_BASE_URL}`);
  console.log(`FRONTEND_INDEX_PATH -> ${FRONTEND_INDEX_PATH}`);
  console.log(`APP_INDEX_PATH -> ${APP_INDEX_PATH}`);
});
