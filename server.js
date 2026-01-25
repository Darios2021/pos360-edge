/**
 * ✅ pos360-edge/server.js — FINAL DEFINITIVO
 * HOOK: bloquea 301/302 self-redirect a /shop/ aunque NO venga de res.redirect()
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
const PROXY_LOG_LEVEL = env("PROXY_LOG_LEVEL", "warn");

const SHOP_UPSTREAM = env("SHOP_UPSTREAM", "http://srv-captain--pos360-frontend").replace(/\/+$/, "");
const APP_UPSTREAM  = env("APP_UPSTREAM", "http://srv-captain--pos360-adminer").replace(/\/+$/, "");
const API_ORIGIN    = env("API_ORIGIN", "http://srv-captain--pos360-commerce-api:3000").replace(/\/+$/, "");

app.set("trust proxy", true);

// =======================
// HOOK GLOBAL: Cazar self-301
// =======================
app.use((req, res, next) => {
  const from = (req.originalUrl || req.url || "").toString();

  const _writeHead = res.writeHead.bind(res);
  res.writeHead = (statusCode, statusMessage, headers) => {
    // Normalizar params
    let code = statusCode;
    let hdrs = headers;

    if (typeof statusMessage === "object" && statusMessage !== null) {
      hdrs = statusMessage;
    }

    const location =
      (hdrs && (hdrs.Location || hdrs.location)) ||
      res.getHeader("Location") ||
      res.getHeader("location");

    // 🔥 Detectar loop: estando en /shop/ y queriendo Location /shop/
    if ((code === 301 || code === 302) && String(location || "") === "/shop/" && from.startsWith("/shop/")) {
      // Log con stack para saber QUIÉN lo setea
      const stack = new Error("SELF_301_STACK").stack;
      console.log("🛑 BLOCK SELF 301", JSON.stringify({ from, code, location }));
      console.log(stack);

      // Bloqueo real: convertir en 200 y borrar Location
      res.setHeader("X-EDGE-BLOCKED-REDIRECT", "WRITEHEAD");
      try { res.removeHeader("Location"); } catch {}
      try { res.removeHeader("location"); } catch {}

      // Si venían headers, limpiarlos también
      if (hdrs) {
        delete hdrs.Location;
        delete hdrs.location;
      }

      // Mandar 200 OK en vez de 301
      return _writeHead(200, hdrs);
    }

    return _writeHead(statusCode, statusMessage, headers);
  };

  next();
});

// =======================
// HEALTH
// =======================
app.get("/health", (req, res) => {
  res.setHeader("X-EDGE-BUILD", env("X_EDGE_BUILD", "EDGE_WRITEHEAD_BLOCK_01"));
  res.json({
    ok: true,
    service: "pos360-edge",
    build: env("X_EDGE_BUILD", "EDGE_WRITEHEAD_BLOCK_01"),
    shopUpstream: SHOP_UPSTREAM,
    appUpstream: APP_UPSTREAM,
    apiOrigin: API_ORIGIN,
  });
});

// ROOT y /shop (sin slash)
app.get("/", (req, res) => res.redirect(301, "/shop/"));
app.get("/shop", (req, res) => res.redirect(301, "/shop/"));

// API
app.use(
  "/api",
  createProxyMiddleware({
    target: API_ORIGIN,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    pathRewrite: { "^/api": "" },
    onProxyRes(proxyRes) {
      proxyRes.headers["X-EDGE-PROXY"] = "api";
    },
  })
);

// SHOP
app.use(
  "/shop/",
  createProxyMiddleware({
    target: SHOP_UPSTREAM,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    onProxyRes(proxyRes) {
      proxyRes.headers["X-EDGE-PROXY"] = "shop";
    },
  })
);

// APP
app.use(
  "/app/",
  createProxyMiddleware({
    target: APP_UPSTREAM,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    onProxyRes(proxyRes) {
      proxyRes.headers["X-EDGE-PROXY"] = "app";
    },
  })
);

// fallback
app.use((req, res) => res.status(404).send("edge: not found"));

app.listen(PORT, () => {
  console.log(`✅ pos360-edge WRITEHEAD BLOCK en :${PORT}`);
});
