/**
 * ✅ pos360-edge/server.js — COPY-PASTE FINAL DEFINITIVO
 * Reverse proxy por PATH:
 * - /        -> /shop/
 * - /shop/*  -> TIENDA
 * - /app/*   -> PLATAFORMA (admin/backoffice)  ✅ reescribe Location: /auth -> /app/auth
 * - /api/*   -> API => mapea a /api/v1/*
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

function mustEnv(name) {
  const v = env(name, "");
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

const PORT = parseInt(env("PORT", "3000"), 10) || 3000;
const LOG_LEVEL = env("PROXY_LOG_LEVEL", "warn");

// 🔗 Upstreams internos
const SHOP_UPSTREAM = env("SHOP_UPSTREAM", "http://srv-captain--pos360-frontend");
const APP_UPSTREAM = env("APP_UPSTREAM", ""); // requerido para /app/*
const API_ORIGIN = env("API_ORIGIN", "http://srv-captain--pos360-commerce-api:3000");

// ✅ API real = /api/v1
const API_V1_TARGET = `${API_ORIGIN.replace(/\/$/, "")}/api/v1`;

app.disable("x-powered-by");

// ------------------------------------------------------
// Helpers
// ------------------------------------------------------
function setForwardedHeaders(proxyReq, req, extra = {}) {
  proxyReq.setHeader("X-Forwarded-Host", req.headers.host || "");
  proxyReq.setHeader("X-Forwarded-Proto", req.headers["x-forwarded-proto"] || req.protocol || "https");
  proxyReq.setHeader("X-Real-IP", req.headers["x-real-ip"] || req.ip || "");
  proxyReq.setHeader("X-Forwarded-For", req.headers["x-forwarded-for"] || req.ip || "");
  Object.entries(extra).forEach(([k, v]) => proxyReq.setHeader(k, v));
}

function proxyError(where) {
  return (err, _req, res) => {
    console.error(`[${where}] proxy error:`, err?.message || err);
    if (!res.headersSent) res.status(502);
    res.end(`Bad gateway (${where})`);
  };
}

function rewriteLocationToApp(proxyRes) {
  const loc = proxyRes.headers?.location;
  if (!loc || typeof loc !== "string") return;

  // si ya viene con /app, no tocar
  if (loc.startsWith("/app/") || loc === "/app") return;

  // solo rutas absolutas del mismo host
  if (loc.startsWith("/")) {
    proxyRes.headers.location = "/app" + loc;
  }
}

// ------------------------------------------------------
// HEALTH
// ------------------------------------------------------
app.get("/health", (_req, res) =>
  res.status(200).json({
    ok: true,
    service: "pos360-edge",
    shop: SHOP_UPSTREAM,
    app: APP_UPSTREAM || "(missing)",
    api: API_V1_TARGET,
  })
);

// ------------------------------------------------------
// ROOT
// ------------------------------------------------------
app.get("/", (_req, res) => res.redirect(301, "/shop/"));
app.get("/shop", (_req, res) => res.redirect(301, "/shop/"));
app.get("/app", (_req, res) => res.redirect(301, "/app/"));

// ------------------------------------------------------
// /api/* -> API (/api => /api/v1)
// Ej: /api/public/catalog -> http://api:3000/api/v1/public/catalog
// ------------------------------------------------------
app.use(
  "/api",
  createProxyMiddleware({
    target: API_V1_TARGET,
    changeOrigin: true,
    xfwd: true,
    ws: true,
    logLevel: LOG_LEVEL,

    // ✅ sacamos /api y dejamos el resto
    pathRewrite: (path) => path.replace(/^\/api/, "") || "/",

    onProxyReq(proxyReq, req) {
      setForwardedHeaders(proxyReq, req);
    },

    onError: proxyError("api"),
  })
);

// ------------------------------------------------------
// /app/* -> ADMIN (STRIP /app)
// + reescribe redirects Location: /x => /app/x
// ------------------------------------------------------
app.use("/app", (req, res, next) => {
  if (!APP_UPSTREAM) {
    return res
      .status(500)
      .send("EDGE misconfig: missing APP_UPSTREAM env (needed for /app/*)");
  }
  return next();
});

app.use(
  "/app",
  createProxyMiddleware({
    target: () => mustEnv("APP_UPSTREAM"),
    changeOrigin: true,
    xfwd: true,
    ws: true,
    logLevel: LOG_LEVEL,

    // ✅ hacia el upstream sacamos el prefijo /app
    pathRewrite: (path) => path.replace(/^\/app/, "") || "/",

    onProxyReq(proxyReq, req) {
      setForwardedHeaders(proxyReq, req, { "X-Forwarded-Prefix": "/app" });
    },

    onProxyRes(proxyRes) {
      rewriteLocationToApp(proxyRes);

      // (Opcional) si cookies quedan con Path=/ y te jode en /app
      // const sc = proxyRes.headers["set-cookie"];
      // if (Array.isArray(sc)) {
      //   proxyRes.headers["set-cookie"] = sc.map((c) =>
      //     c.replace(/;\s*Path=\/(\s*;|$)/i, "; Path=/app$1")
      //   );
      // }
    },

    onError: proxyError("app"),
  })
);

// ------------------------------------------------------
// /shop/* -> FRONT (STRIP /shop)
// ------------------------------------------------------
app.use(
  "/shop",
  createProxyMiddleware({
    target: SHOP_UPSTREAM,
    changeOrigin: true,
    xfwd: true,
    ws: true,
    logLevel: LOG_LEVEL,

    // ✅ hacia el upstream sacamos el prefijo /shop
    pathRewrite: (path) => path.replace(/^\/shop/, "") || "/",

    onProxyReq(proxyReq, req) {
      setForwardedHeaders(proxyReq, req);
    },

    onError: proxyError("shop"),
  })
);

// ------------------------------------------------------
// Fallback: todo lo demás -> /shop/* (para assets o links sin prefijo)
// ------------------------------------------------------
app.use(
  "/",
  createProxyMiddleware({
    target: SHOP_UPSTREAM,
    changeOrigin: true,
    xfwd: true,
    ws: true,
    logLevel: LOG_LEVEL,

    pathRewrite: (path) => {
      if (path === "/") return "/";
      return path; // el upstream ya recibe raíz del frontend
    },

    onProxyReq(proxyReq, req) {
      setForwardedHeaders(proxyReq, req);
    },

    onError: proxyError("root"),
  })
);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ pos360-edge on :${PORT}`);
  console.log(`   shop -> ${SHOP_UPSTREAM}`);
  console.log(`   app  -> ${APP_UPSTREAM || "(missing)"}`);
  console.log(`   api  -> ${API_V1_TARGET}`);
});
