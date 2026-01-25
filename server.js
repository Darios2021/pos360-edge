/**
 * ✅ pos360-edge/server.js — FINAL DEFINITIVO ANTI-SELF-301
 * Proyecto: POS360 / sanjuantecnologia.com
 *
 * Objetivos:
 * - Evitar bucles 301 /shop/ -> /shop/ (self-redirect)
 * - Proxy robusto para /shop (cubre /shop y /shop/*)
 * - Forense: identificar quién intenta redirigir
 * - Trust proxy correcto para CapRover/Nginx
 */

const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();

// 🔑 Detrás de CapRover/Nginx esto es obligatorio
app.set("trust proxy", true);

// ❌ No usar strict routing en edge proxy (reduce problemas con trailing slash)
// app.set("strict routing", true);

/* =========================
 * ENV helpers
 * ========================= */
function env(name, fallback) {
  const v = process.env[name];
  return v !== undefined && v !== null && String(v).trim() !== ""
    ? String(v).trim()
    : fallback;
}

const PORT = parseInt(env("PORT", "3000"), 10) || 3000;
const PROXY_LOG_LEVEL = env("PROXY_LOG_LEVEL", "warn");

const PUBLIC_BASE_URL = env("PUBLIC_BASE_URL", "https://sanjuantecnologia.com").replace(/\/+$/, "");
const SHOP_UPSTREAM = env("SHOP_UPSTREAM", "http://srv-captain--pos360-frontend").replace(/\/+$/, "");
const APP_UPSTREAM = env("APP_UPSTREAM", "http://srv-captain--pos360-admin").replace(/\/+$/, "");
const API_ORIGIN = env("API_ORIGIN", "http://srv-captain--pos360-commerce-api:3000").replace(/\/+$/, "");

// ✅ marca de build para confirmar que corrió este código
const EDGE_BUILD = env("EDGE_BUILD", "EDGE_ANTI_SELF_301_2026-01-25_01");

/* =========================
 * HTTP helpers
 * ========================= */
function getHost(req) {
  return (req.headers["x-forwarded-host"] || req.headers.host || "")
    .toString()
    .split(",")[0]
    .trim();
}

function isHttps(req) {
  const xfProto = (req.headers["x-forwarded-proto"] || "")
    .toString()
    .split(",")[0]
    .trim()
    .toLowerCase();

  return xfProto === "https" || req.protocol === "https" || req.secure === true;
}

function forceForwardHeaders(proxyReq, req) {
  const host = getHost(req);
  proxyReq.setHeader("X-Forwarded-Proto", isHttps(req) ? "https" : "http");
  if (host) proxyReq.setHeader("X-Forwarded-Host", host);
}

/**
 * 🔁 Reescritura defensiva de Location para evitar redirects internos
 */
function rewriteLocation(proxyRes, req) {
  const loc = proxyRes.headers?.location;
  if (!loc || String(loc).startsWith("/")) return;

  const host = getHost(req);
  if (!host) return;

  let newLoc = String(loc);

  const targets = [
    /https?:\/\/srv-captain--pos360-frontend(?=\/|$)/i,
    /https?:\/\/srv-captain--pos360-admin(?=\/|$)/i,
    /https?:\/\/srv-captain--pos360-edge(?=\/|$)/i,
    /https?:\/\/127\.0\.0\.1(?=\/|$)/i,
    /https?:\/\/localhost(?=\/|$)/i,
  ];

  targets.forEach((rx) => {
    newLoc = newLoc.replace(rx, `https://${host}`);
  });

  if (isHttps(req)) {
    const escHost = host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    newLoc = newLoc.replace(new RegExp(`^http:\\/\\/${escHost}(?=\\/|$)`, "i"), `https://${host}`);
  }

  proxyRes.headers.location = newLoc;
}

/* =========================
 * 0) FORENSE: detectar redirects
 * ========================= */
app.use((req, res, next) => {
  const rid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  // Si Express intenta redirigir /shop/ -> /shop/ (self redirect), lo bloqueamos
  // Esto mata el loop aunque haya quedado middleware viejo en algún lado.
  const _redirect = res.redirect.bind(res);
  res.redirect = function (a, b) {
    const status = typeof a === "number" ? a : 302;
    const url = typeof a === "number" ? b : a;

    // Normalizamos url a string
    const target = (url ?? "").toString();

    if (
      status === 301 &&
      req.originalUrl === "/shop/" &&
      (target === "/shop/" || target === `${PUBLIC_BASE_URL}/shop/`)
    ) {
      console.log("🧨 BLOCKED SELF-301", {
        rid,
        status,
        from: req.originalUrl,
        to: target,
        xfProto: req.headers["x-forwarded-proto"],
        protocol: req.protocol,
        secure: req.secure,
      });
      // respondemos 200 vacío (o podés cambiar a next() si querés que el proxy responda)
      res.status(200).end();
      return;
    }

    console.log("↪️ RES.REDIRECT", {
      rid,
      status,
      to: target,
      from: req.originalUrl,
      xfProto: req.headers["x-forwarded-proto"],
      protocol: req.protocol,
      secure: req.secure,
    });

    return _redirect(status, url);
  };

  // Log mínimo útil
  if (req.originalUrl.startsWith("/shop")) {
    console.log("➡️ REQ", {
      rid,
      url: req.originalUrl,
      host: req.headers.host,
      xfHost: req.headers["x-forwarded-host"],
      xfProto: req.headers["x-forwarded-proto"],
      protocol: req.protocol,
      secure: req.secure,
    });
  }

  next();
});

/* =========================
 * 1) Health Check (con build ID)
 * ========================= */
app.get("/health", (req, res) => {
  res.setHeader("X-EDGE-BUILD", EDGE_BUILD);
  res.json({
    ok: true,
    service: "pos360-edge",
    build: EDGE_BUILD,
    shopUpstream: SHOP_UPSTREAM,
    appUpstream: APP_UPSTREAM,
    apiOrigin: API_ORIGIN,
  });
});

/* =========================
 * 2) Único redirect permitido: raíz → /shop/
 * ========================= */
app.get("/", (req, res) => {
  return res.redirect(301, "/shop/");
});

/* =========================
 * 3) API Proxy (/api -> API_ORIGIN)
 * ========================= */
app.use(
  "/api",
  createProxyMiddleware({
    target: API_ORIGIN,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    pathRewrite: { "^/api": "" },
    onProxyReq: forceForwardHeaders,
    onProxyRes: rewriteLocation,
  })
);

/* =========================
 * 4) SHOP Proxy (clave): /shop cubre /shop y /shop/*
 * ========================= */
app.use(
  "/shop",
  createProxyMiddleware({
    target: SHOP_UPSTREAM,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    onProxyReq: forceForwardHeaders,
    onProxyRes: rewriteLocation,
  })
);

/* =========================
 * 5) APP / Backoffice (/app ...)
 * ========================= */
app.use(
  "/app",
  createProxyMiddleware({
    target: APP_UPSTREAM,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    onProxyReq: forceForwardHeaders,
    onProxyRes: rewriteLocation,
  })
);

app.listen(PORT, () => {
  console.log(`✅ pos360-edge LISTEN ${PORT} build=${EDGE_BUILD}`);
});
