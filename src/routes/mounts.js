/**
 * src/routes/mounts.js
 * ✅ COPY-PASTE FINAL COMPLETO
 * Monta health + og-default + redirects + favicon same-origin + proxys con ORDEN correcto
 */

const { botOgMiddleware } = require("../og/botMiddleware");
const { registerOgDefaultRoute } = require("./ogDefault.route");
const { registerRedirectRoutes } = require("./redirects.route");

const faviconRoutes = require("./favicon.route");

const {
  shopAssetsFirstProxy,
  rootAssetsProxy,
  rootStaticProxy,
  appProxy,
  shopProxy,
  apiV1CompatProxy,
  publicCompatProxy,
  apiProxy,
} = require("../proxy/proxies");

function registerMounts(app) {
  // ====== Health ======
  app.get("/health", (req, res) => {
    res.setHeader("X-EDGE-BUILD", "EDGE_OG_PRODUCTS_VERSIONED_04_OGURL_PRICE");
    res.json({
      ok: true,
      edge: "pos360-edge",
      time: new Date().toISOString(),
      host: req.headers.host || null,
      proto: req.headers["x-forwarded-proto"] || req.protocol,
    });
  });

  // OG default
  registerOgDefaultRoute(app);

  // Redirects base
  registerRedirectRoutes(app);

  // ✅ Favicon same-origin (ANTES de /shop bot middleware y proxys)
  // Maneja:
  // - GET /favicon.ico
  // - GET /apple-touch-icon.png
  app.use(faviconRoutes);

  // ====== ✅ MOUNTS (ORDEN IMPORTA) ======
  app.use("/shop/", botOgMiddleware);

  app.use("/shop/assets/", shopAssetsFirstProxy);
  app.use("/assets/", rootAssetsProxy);

  // ✅ estos sí pueden seguir yendo al frontend
  app.get("/robots.txt", rootStaticProxy);
  app.get("/manifest.webmanifest", rootStaticProxy);
  app.get("/manifest.json", rootStaticProxy);

  app.use("/app/", appProxy);
  app.use("/shop/", shopProxy);

  app.use("/api/v1/", apiV1CompatProxy);
  app.use("/public/", publicCompatProxy);
  app.use("/api/", apiProxy);
}

module.exports = { registerMounts };
