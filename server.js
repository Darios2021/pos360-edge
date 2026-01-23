/**
 * ✅ pos360-edge/server.js
 * Reverse proxy por PATH:
 * - /        -> TIENDA (shop)
 * - /shop/*  -> TIENDA
 * - /app/*   -> PLATAFORMA (admin/backoffice)
 * - /api/*   -> API
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

const PORT = parseInt(env("PORT", "3000"), 10) || 3000;

// 🔗 Upstreams
// TIENDA (public)
const SHOP_UPSTREAM = env(
  "SHOP_UPSTREAM",
  "http://srv-captain--pos360-frontend"
);

// PLATAFORMA (admin)  ✅ AJUSTÁ ESTE NOMBRE AL TUYO REAL
const APP_UPSTREAM = env(
  "APP_UPSTREAM",
  "http://srv-captain--pos360-admin"
);

// API (backend) ✅ SIN /api acá
const API_UPSTREAM = env(
  "API_UPSTREAM",
  "http://srv-captain--pos360-commerce-api:3000"
);

app.disable("x-powered-by");

function setForwardedHost(proxyReq, req) {
  proxyReq.setHeader("X-Forwarded-Host", req.headers.host || "");
}

// ------------------------------------------------------
// HEALTH
// ------------------------------------------------------
app.get("/health", (_req, res) =>
  res.status(200).json({ ok: true, service: "pos360-edge" })
);

// ------------------------------------------------------
// /api/* -> API
// ------------------------------------------------------
app.use(
  "/api",
  createProxyMiddleware({
    target: API_UPSTREAM,
    changeOrigin: true,
    xfwd: true,
    ws: true,
    onProxyReq: setForwardedHost,
    onError(err, _req, res) {
      console.error("[api-proxy] error:", err?.message || err);
      if (!res.headersSent) res.status(502);
      res.end("Bad gateway (api)");
    },
  })
);

// ------------------------------------------------------
// /app/* -> PLATAFORMA (admin)
// Si tu plataforma en el upstream vive en "/", esto STRIPEA /app:
//   /app/users -> /users
// Si tu plataforma realmente vive en "/app" también, BORRÁ pathRewrite.
// ------------------------------------------------------
app.use(
  "/app",
  createProxyMiddleware({
    target: APP_UPSTREAM,
    changeOrigin: true,
    xfwd: true,
    ws: true,
    pathRewrite: (path) => path.replace(/^\/app/, "") || "/", // ✅ strip /app
    onProxyReq: setForwardedHost,
    onError(err, _req, res) {
      console.error("[app-proxy] error:", err?.message || err);
      if (!res.headersSent) res.status(502);
      res.end("Bad gateway (app)");
    },
  })
);

// ------------------------------------------------------
// /shop/* -> TIENDA
// ------------------------------------------------------
app.use(
  "/shop",
  createProxyMiddleware({
    target: SHOP_UPSTREAM,
    changeOrigin: true,
    xfwd: true,
    ws: true,
    onProxyReq: setForwardedHost,
    onError(err, _req, res) {
      console.error("[shop-proxy] error:", err?.message || err);
      if (!res.headersSent) res.status(502);
      res.end("Bad gateway (shop)");
    },
  })
);

// ------------------------------------------------------
// ROOT "/" -> TIENDA como "/shop/*" (sin redirect)
// ------------------------------------------------------
app.use(
  "/",
  createProxyMiddleware({
    target: SHOP_UPSTREAM,
    changeOrigin: true,
    xfwd: true,
    ws: true,
    onProxyReq: setForwardedHost,
    pathRewrite: (path) => {
      if (path === "/") return "/shop/";
      return `/shop${path}`;
    },
    onError(err, _req, res) {
      console.error("[root-proxy] error:", err?.message || err);
      if (!res.headersSent) res.status(502);
      res.end("Bad gateway (root)");
    },
  })
);

app.listen(PORT, () => {
  console.log(`✅ pos360-edge on :${PORT}`);
  console.log(`   shop  -> ${SHOP_UPSTREAM}`);
  console.log(`   app   -> ${APP_UPSTREAM}`);
  console.log(`   api   -> ${API_UPSTREAM}`);
});
