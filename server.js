/**
 * ✅ pos360-edge/server.js
 * ✅ COPY-PASTE FINAL DEFINITIVO
 *
 * Qué corrige:
 * - OG placeholders "__OG_TITLE__" etc: el EDGE los reemplaza para BOTS (Facebook/WhatsApp/Twitter/Telegram/Discord)
 * - Warning de Facebook: inyecta fb:app_id si hay FB_APP_ID
 * - Bug de assets: si el HTML viene con "/app/assets/" lo reescribe a "/shop/assets/" para rutas /shop/*
 * - Mantiene tus proxys existentes: /shop, /shop/assets, /assets, /api, /api/v1, /public, /app (transparente a /shop/app)
 *
 * Resultado:
 * - Facebook debugger deja de ver __OG_TITLE__ y te muestra OG reales (por lo menos default)
 * - Si tu frontend no inyecta server-side, el edge lo hace para bots
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
const API_BASE = env("API_BASE", "/api/v1");

// Base pública
const PUBLIC_BASE_URL = removeTrailingSlash(
  env("PUBLIC_BASE_URL", "https://sanjuantecnologia.com")
);

// Paths
const FRONTEND_INDEX_PATH = env("FRONTEND_INDEX_PATH", "/shop/");
const APP_INDEX_PATH = env("APP_INDEX_PATH", "/shop/app/");

// OG defaults (mínimo)
const OG_SITE_NAME = env("OG_SITE_NAME", "San Juan Tecnología");
const OG_TITLE_DEFAULT = env("OG_TITLE_DEFAULT", "San Juan Tecnología | Tienda");
const OG_DESCRIPTION_DEFAULT = env(
  "OG_DESCRIPTION_DEFAULT",
  "Electrónica, ecommerce, sistemas POS y soluciones tecnológicas para empresas."
);
const OG_IMAGE_DEFAULT = env("OG_IMAGE_DEFAULT", `${PUBLIC_BASE_URL}/og-default.png`);
const FB_APP_ID = env("FB_APP_ID", ""); // opcional: si lo ponés, desaparece el warning

// ====== Core settings ======
app.disable("x-powered-by");
app.enable("strict routing");

// ====== Health ======
app.get("/health", (req, res) => {
  res.setHeader("X-EDGE-BUILD", "EDGE_OG_INJECT_BOTS_ASSETFIX_01");
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
    secure: false,
    ...opts,
    onProxyReq(proxyReq, req, res) {
      // ✅ Importante: preserva Host público para que el upstream no genere URLs raras
      proxyReq.setHeader("Host", req.headers.host || "");
      if (opts.onProxyReq) opts.onProxyReq(proxyReq, req, res);
    },
    onError(err, req, res) {
      console.error(
        "❌ proxy error:",
        req.method,
        req.originalUrl,
        err && err.message ? err.message : err
      );
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

// ====== BOT detection + HTML injector ======
function isBot(req) {
  const ua = String(req.headers["user-agent"] || "").toLowerCase();
  if (!ua) return false;
  return (
    ua.includes("facebookexternalhit") ||
    ua.includes("facebot") ||
    ua.includes("whatsapp") ||
    ua.includes("twitterbot") ||
    ua.includes("telegrambot") ||
    ua.includes("discordbot") ||
    ua.includes("linkedinbot") ||
    ua.includes("slackbot") ||
    ua.includes("pinterest") ||
    ua.includes("googlebot") // opcional, ayuda SEO
  );
}

function wantsHtml(req) {
  const accept = String(req.headers.accept || "").toLowerCase();
  // si no hay accept, igual muchos bots scrapean sin accept fuerte
  return !accept || accept.includes("text/html") || accept.includes("*/*");
}

function injectFbAppId(html) {
  if (!FB_APP_ID) return html;
  if (html.includes('property="fb:app_id"') || html.includes("property='fb:app_id'")) {
    return html;
  }
  // lo metemos cerca del OG block si existe, sino antes de </head>
  const meta = `\n    <meta property="fb:app_id" content="${FB_APP_ID}" />\n`;
  if (html.includes('property="og:type"')) {
    return html.replace('property="og:type"', `property="fb:app_id" content="${FB_APP_ID}" />\n    <meta property="og:type"`);
  }
  return html.replace("</head>", `${meta}</head>`);
}

function replaceTokens(html, req) {
  const fullUrl = `${PUBLIC_BASE_URL}${req.originalUrl}`;
  const canonical = fullUrl;

  // ✅ Reemplazo de placeholders
  let out = html
    .replaceAll("__TITLE__", OG_TITLE_DEFAULT)
    .replaceAll("__DESCRIPTION__", OG_DESCRIPTION_DEFAULT)
    .replaceAll("__CANONICAL__", canonical)

    .replaceAll("__SITE_NAME__", OG_SITE_NAME)
    .replaceAll("__OG_TITLE__", OG_TITLE_DEFAULT)
    .replaceAll("__OG_DESCRIPTION__", OG_DESCRIPTION_DEFAULT)
    .replaceAll("__OG_URL__", fullUrl)
    .replaceAll("__OG_IMAGE__", OG_IMAGE_DEFAULT)
    .replaceAll("__OG_IMAGE_ALT__", OG_TITLE_DEFAULT);

  // ✅ Fix assets mismatch: si el HTML vino con /app/assets para una URL /shop/*
  // (esto te está pasando ahora mismo)
  if (req.originalUrl.startsWith("/shop/")) {
    out = out
      .replaceAll('src="/app/assets/', 'src="/shop/assets/')
      .replaceAll("src='/app/assets/", "src='/shop/assets/")
      .replaceAll('href="/app/assets/', 'href="/shop/assets/')
      .replaceAll("href='/app/assets/", "href='/shop/assets/");
  }

  // ✅ opcional: algunos templates usan /assets/ directo
  // tu edge ya soporta /assets/* compat, así que no toca.

  // ✅ Inyecta fb:app_id si corresponde
  out = injectFbAppId(out);

  return out;
}

async function fetchUpstreamHtml(pathname) {
  // Node 18+ tiene fetch global
  const url = `${removeTrailingSlash(SHOP_UPSTREAM)}${pathname}`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 6000);

  const resp = await fetch(url, {
    method: "GET",
    headers: {
      // pedimos HTML
      Accept: "text/html,*/*;q=0.8",
    },
    signal: controller.signal,
  }).finally(() => clearTimeout(t));

  const ct = String(resp.headers.get("content-type") || "");
  const text = await resp.text();

  return { status: resp.status, contentType: ct, body: text };
}

// Middleware que solo aplica a BOTS para /shop/*
async function botOgMiddleware(req, res, next) {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (!isBot(req)) return next();
    if (!wantsHtml(req)) return next();

    // 🔥 Ignorar assets/api/etc
    if (
      req.originalUrl.startsWith("/shop/assets/") ||
      req.originalUrl.startsWith("/assets/") ||
      req.originalUrl.startsWith("/api/") ||
      req.originalUrl.startsWith("/public/") ||
      req.originalUrl.startsWith("/app/")
    ) {
      return next();
    }

    // Pedimos al upstream el HTML REAL (ya con /shop prefix reinyectado)
    const upstreamPath = joinPrefix(FRONTEND_INDEX_PATH, req.path); // "/shop" + "/product/303"
    const { status, contentType, body } = await fetchUpstreamHtml(upstreamPath);

    // Si no es HTML, no tocamos
    if (!String(contentType).toLowerCase().includes("text/html")) {
      res.status(status).send(body);
      return;
    }

    const patched = replaceTokens(body, req);

    res.status(status);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("X-EDGE-HIT", "bot-og-inject");
    res.send(patched);
  } catch (e) {
    console.error("❌ botOgMiddleware error:", e && e.message ? e.message : e);
    // si falla, no rompemos navegación
    next();
  }
}

// ====== Proxys ======

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
 */
const shopProxy = makeProxy(SHOP_UPSTREAM, {
  pathRewrite: (path) => joinPrefix(FRONTEND_INDEX_PATH, path),
});

/**
 * ✅ 3) APP proxy TRANSPARENTE: /app/* -> /shop/app/*
 */
const appProxy = makeProxy(SHOP_UPSTREAM, {
  pathRewrite: (path) => joinPrefix(APP_INDEX_PATH, path),
});

/**
 * ✅ Compat: /assets/*
 */
const rootAssetsProxy = makeProxy(SHOP_UPSTREAM, {
  pathRewrite: (p) => `/assets${ensureSlashStart(p)}`,
});

/**
 * ✅ Compat: estáticos raíz
 */
const rootStaticProxy = makeProxy(SHOP_UPSTREAM);

/**
 * ✅ API proxy /api -> /api/v1
 */
const apiProxy = makeProxy(API_ORIGIN, {
  pathRewrite: (path) => {
    const base = ensureSlashStart(API_BASE);
    if (path.startsWith(base)) return path;
    return `${removeTrailingSlash(base)}${ensureSlashStart(path)}`;
  },
});

/**
 * ✅ /api/v1/* directo
 */
const apiV1CompatProxy = makeProxy(API_ORIGIN);

/**
 * ✅ /public/* directo
 */
const publicCompatProxy = makeProxy(API_ORIGIN);

// ====== Redirects base ======
app.get("/", (req, res) =>
  res.redirect(301, removeTrailingSlash(FRONTEND_INDEX_PATH) + "/")
);
app.get("/shop", (req, res) => res.redirect(301, "/shop/"));
app.get("/app", (req, res) => res.redirect(301, "/app/"));

// ====== ✅ MOUNTS (ORDEN IMPORTA) ======

// ✅ 0) BOT OG injector (ANTES que el proxy de shop)
app.use("/shop/", botOgMiddleware);

// ✅ 1) assets de vite bajo /shop (PRIMERO)
app.use("/shop/assets/", shopAssetsFirstProxy);

// ✅ 2) compat assets en raíz
app.use("/assets/", rootAssetsProxy);

// ✅ 3) compat estáticos típicos en raíz
app.get("/favicon.ico", rootStaticProxy);
app.get("/robots.txt", rootStaticProxy);
app.get("/manifest.webmanifest", rootStaticProxy);
app.get("/manifest.json", rootStaticProxy);

// ✅ 4) APP
app.use("/app/", appProxy);

// ✅ 5) shop general
app.use("/shop/", shopProxy);

// ✅ 6) compat API primero
app.use("/api/v1/", apiV1CompatProxy);
app.use("/public/", publicCompatProxy);

// ✅ 7) api “oficial”
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
  console.log(`app -> ${SHOP_UPSTREAM} (transparent /app -> ${APP_INDEX_PATH})`);
  console.log(`PUBLIC_BASE_URL -> ${PUBLIC_BASE_URL}`);
  console.log(`FRONTEND_INDEX_PATH -> ${FRONTEND_INDEX_PATH}`);
  console.log(`APP_INDEX_PATH -> ${APP_INDEX_PATH}`);
  console.log(`FB_APP_ID -> ${FB_APP_ID ? "SET" : "NOT_SET"}`);
});
