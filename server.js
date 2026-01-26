/**
 * ✅ pos360-edge/server.js
 * ✅ COPY-PASTE FINAL DEFINITIVO (FIX BLANK PAGE + strict MIME)
 *
 * Contexto:
 * - Tu index.html sale con <script src="/shop/assets/index-xxx.js">
 * - Pero los archivos reales están en /assets/* dentro del contenedor (dist/assets)
 * - Entonces: /shop/assets/* debe mapearse a /assets/*
 *
 * Estrategia:
 * - /shop/assets/*  -> proxy a FRONT /assets/*
 * - /shop/*         -> proxy a FRONT /*   (strip /shop)
 * - /assets/*       -> compat -> FRONT /assets/*
 * - /favicon.ico y /shop/favicon.ico -> FRONT /favicon.ico
 * - /api/*          -> API
 * - /app/*          -> APP
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

const PORT = parseInt(env("PORT", "3000"), 10) || 3000;
const PROXY_LOG_LEVEL = env("PROXY_LOG_LEVEL", "warn");

// Upstreams
const SHOP_UPSTREAM = env("SHOP_UPSTREAM", "http://srv-captain--pos360-frontend");
const APP_UPSTREAM = env("APP_UPSTREAM", "http://srv-captain--pos360-admin");
const API_ORIGIN = env("API_ORIGIN", "http://srv-captain--pos360-commerce-api:3000");
const API_BASE = env("API_BASE", "/api/v1");

// Base pública (solo debug)
const PUBLIC_BASE_URL = env("PUBLIC_BASE_URL", "https://sanjuantecnologia.com");

// ====== Core ======
app.disable("x-powered-by");
app.enable("strict routing");

// ====== Health ======
app.get("/health", (req, res) => {
  res.setHeader("X-EDGE-BUILD", "EDGE_FIX_STRIP_SHOP_ASSETS_01");
  res.json({
    ok: true,
    edge: "pos360-edge",
    time: new Date().toISOString(),
    host: req.headers.host || null,
    proto: req.headers["x-forwarded-proto"] || req.protocol,
  });
});

// ====== Proxy helper ======
function makeProxy(target, opts = {}) {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    secure: false,
    ...opts,
    onProxyReq(proxyReq, req, res) {
      proxyReq.setHeader("Host", req.headers.host || "");
      if (opts.onProxyReq) opts.onProxyReq(proxyReq, req, res);
    },
  });
}

/**
 * ✅ FRONT ASSETS: /shop/assets/* -> /assets/*
 * (lo que evita strict MIME)
 */
const shopAssetsProxy = makeProxy(SHOP_UPSTREAM, {
  pathRewrite: (path) => path.replace(/^\/shop\/assets\//, "/assets/"),
});

/**
 * ✅ FRONT general: /shop/* -> /*
 * (strip /shop para que el contenedor sirva dist como root)
 */
const shopProxy = makeProxy(SHOP_UPSTREAM, {
  // app.use("/shop/", ...) entrega path tipo "/" o "/product/303"
  // NO reinyectamos /shop
  pathRewrite: (path) => ensureSlashStart(path),
});

/**
 * ✅ Compat assets raíz: /assets/* -> /assets/*
 */
const rootAssetsProxy = makeProxy(SHOP_UPSTREAM);

/**
 * ✅ API: /api/* -> /api/v1/*
 */
const apiProxy = makeProxy(API_ORIGIN, {
  pathRewrite: (path) => {
    const base = ensureSlashStart(API_BASE);
    if (path.startsWith(base)) return path;
    return `${removeTrailingSlash(base)}${ensureSlashStart(path)}`;
  },
});

/**
 * ✅ APP
 */
const appProxy = makeProxy(APP_UPSTREAM);

// ====== Redirects base ======
app.get("/", (req, res) => res.redirect(301, "/shop/"));
app.get("/shop", (req, res) => res.redirect(301, "/shop/"));

// ====== ✅ MOUNTS (ORDEN IMPORTA) ======

// 1) assets bajo /shop (primero)
app.use("/shop/assets/", shopAssetsProxy);

// 2) compat assets raíz
app.use("/assets/", rootAssetsProxy);

// 3) compat favicons (raíz y bajo /shop)
app.get("/favicon.ico", rootAssetsProxy);
app.get("/shop/favicon.ico", rootAssetsProxy);
app.get("/robots.txt", rootAssetsProxy);
app.get("/manifest.webmanifest", rootAssetsProxy);
app.get("/manifest.json", rootAssetsProxy);

// 4) shop general
app.use("/shop/", shopProxy);

// 5) api
app.use("/api/", apiProxy);

// 6) app
app.use("/app/", appProxy);

// ====== 404 ======
app.use((req, res) => {
  res.setHeader("X-EDGE-HIT", "edge-404");
  res.status(404).json({ ok: false, error: "Not Found", path: req.originalUrl });
});

// ====== Start ======
app.listen(PORT, () => {
  console.log(`✅ pos360-edge listo en :${PORT}`);
  console.log(`shop -> ${SHOP_UPSTREAM}`);
  console.log(`api -> ${API_ORIGIN}${API_BASE}`);
  console.log(`app -> ${APP_UPSTREAM}`);
  console.log(`PUBLIC_BASE_URL -> ${PUBLIC_BASE_URL}`);
});
