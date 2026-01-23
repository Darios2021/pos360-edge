/**
 * pos360-edge (FINAL DEFINITIVO)
 * - /        -> /shop
 * - /shop/*  -> ecommerce (SPA) + OG/Title/Favicon inyectados (dinámico)
 * - /app/*   -> plataforma (SPA admin) (mismo frontend o separado via APP_FRONTEND_INTERNAL)
 * - /api/v1/* -> proxy a commerce-api (evita que devuelva HTML)
 *
 * OG:
 * - Genérico para /shop/*
 * - ✅ Dinámico para /shop/product/:id  (usa API /api/v1/public/products/:id)
 */

const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

const app = express();
const PORT = process.env.PORT || 3000;

// =========================
// ENV
// =========================
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || "https://sanjuantecnologia.com").replace(/\/+$/, "");

// Frontends internos (CapRover internal DNS)
// - FRONTEND_INTERNAL: tu pos360-commerce-frontend (nginx)
// - APP_FRONTEND_INTERNAL: si el admin estuviera en otra app, setealo distinto
const FRONTEND_INTERNAL = String(process.env.FRONTEND_INTERNAL || "http://srv-captain--pos360-commerce-frontend").replace(
  /\/+$/,
  ""
);
const APP_FRONTEND_INTERNAL = String(process.env.APP_FRONTEND_INTERNAL || FRONTEND_INTERNAL).replace(/\/+$/, "");

// Qué endpoint del frontend devolver como index html
// OJO: tu nginx del frontend redirige / -> /shop/ y sirve siempre /index.html.
// Para capturar el HTML “base” pedimos /shop (o /shop/) para el ecommerce:
const FRONTEND_SHOP_INDEX_PATH = String(process.env.FRONTEND_SHOP_INDEX_PATH || "/shop/");
// Para el admin, vamos a servir /app/ como base (pero el frontend tiene que soportarlo; abajo te digo el ajuste)
const FRONTEND_APP_INDEX_PATH = String(process.env.FRONTEND_APP_INDEX_PATH || "/app/");

// API pública
const API_ORIGIN = String(process.env.API_ORIGIN || "https://pos360-commerce-api.cingulado.org").replace(/\/+$/, "");
const API_BASE = String(process.env.API_BASE || `${API_ORIGIN}/api/v1`).replace(/\/+$/, "");

// Branding endpoint (desde API)
const BRANDING_ENDPOINT = String(process.env.BRANDING_ENDPOINT || "/public/shop/branding").replace(/\/+$/, "");
const CACHE_SECONDS = Math.max(5, parseInt(process.env.BRANDING_CACHE_SECONDS || "60", 10) || 60);

// =========================
// Helpers
// =========================
function esc(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function absUrl(u) {
  const s = String(u || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("//")) return `https:${s}`;
  return `${PUBLIC_BASE_URL}${s.startsWith("/") ? "" : "/"}${s}`;
}

function wantsHtml(req) {
  const a = String(req.headers.accept || "");
  return a.includes("text/html") || a.includes("*/*") || a === "";
}

function isAssetPath(p) {
  return (
    p.startsWith("/assets/") ||
    p.startsWith("/favicon") ||
    p.startsWith("/robots.txt") ||
    p.startsWith("/sitemap") ||
    p.startsWith("/.well-known/") ||
    /\.[a-z0-9]{2,6}$/i.test(p)
  );
}

function matchShopProductId(pathname) {
  // /shop/product/295  -> 295
  const m = String(pathname || "").match(/^\/shop\/product\/(\d+)(?:\/|$)/i);
  return m ? m[1] : null;
}

// =========================
// Branding cache
// =========================
let cachedBranding = null;
let cachedBrandingAt = 0;

async function loadBranding() {
  const now = Date.now();
  if (cachedBranding && now - cachedBrandingAt < CACHE_SECONDS * 1000) return cachedBranding;

  try {
    const r = await fetch(`${API_BASE}${BRANDING_ENDPOINT}`, {
      headers: { Accept: "application/json" },
      redirect: "follow",
    });
    if (!r.ok) throw new Error(`branding http ${r.status}`);
    const j = await r.json();

    const name = j?.name || "San Juan Tecnología";
    const favicon = absUrl(j?.favicon_url);
    const ogImage = absUrl(j?.og_image_url || j?.logo_url || j?.favicon_url);

    cachedBranding = { name, favicon, ogImage };
    cachedBrandingAt = now;
    return cachedBranding;
  } catch {
    cachedBranding = { name: "San Juan Tecnología", favicon: "", ogImage: "" };
    cachedBrandingAt = now;
    return cachedBranding;
  }
}

// =========================
// Producto meta (para WhatsApp preview)
// =========================
async function loadProductMeta(productId) {
  try {
    const r = await fetch(`${API_BASE}/public/products/${encodeURIComponent(productId)}`, {
      headers: { Accept: "application/json" },
      redirect: "follow",
    });
    if (!r.ok) return null;

    const j = await r.json();

    // Ajuste robusto: distintos shapes comunes
    const name = j?.name || j?.product?.name || "";
    const brand = j?.brand || j?.product?.brand || "";
    const descRaw = j?.short_description || j?.description || j?.product?.description || "";

    // Imagen principal (varios formatos)
    const img =
      j?.image_url ||
      j?.main_image_url ||
      j?.product?.image_url ||
      (Array.isArray(j?.images) && (j.images[0]?.url || j.images[0])) ||
      (Array.isArray(j?.product_images) && (j.product_images[0]?.url || j.product_images[0])) ||
      "";

    const title = name ? `${name}${brand ? " · " + brand : ""}` : null;
    const description = descRaw ? String(descRaw).slice(0, 160) : null;
    const image = img ? absUrl(img) : null;

    return { title, description, image };
  } catch {
    return null;
  }
}

// =========================
// 0) HOME
// =========================
app.get("/", (req, res) => res.redirect(301, "/shop"));

// =========================
// 1) ✅ API PROXY
// /api/v1/* -> commerce-api
// =========================
app.use(
  "/api/v1",
  createProxyMiddleware({
    target: API_ORIGIN,
    changeOrigin: true,
    secure: true,
    ws: true,
    pathRewrite: { "^/api/v1": "/api/v1" },
  })
);

// =========================
// 2) ✅ /app -> plataforma (SPA)
// (si querés admin separado, seteá APP_FRONTEND_INTERNAL)
// =========================
app.use(
  "/app",
  createProxyMiddleware({
    target: APP_FRONTEND_INTERNAL,
    changeOrigin: true,
    ws: true,
  })
);

// =========================
// 3) HTML Injection SOLO para /shop/*
// - OG genérico
// - ✅ OG dinámico en /shop/product/:id
// =========================
app.get("/shop*", async (req, res, next) => {
  try {
    if (isAssetPath(req.path) || !wantsHtml(req)) return next();

    const productId = matchShopProductId(req.path);

    const [branding, productMeta, indexRes] = await Promise.all([
      loadBranding(),
      productId ? loadProductMeta(productId) : Promise.resolve(null),
      fetch(`${FRONTEND_INTERNAL}${FRONTEND_SHOP_INDEX_PATH}`, {
        headers: { Accept: "text/html" },
        redirect: "follow",
      }),
    ]);

    let html = await indexRes.text();

    const siteName = branding.name || "San Juan Tecnología";

    const title = productMeta?.title || `${siteName} | Tienda`;
    const desc =
      productMeta?.description ||
      "Electrónica, ecommerce, sistemas POS y soluciones tecnológicas para empresas.";

    const canonical = `${PUBLIC_BASE_URL}${req.originalUrl || "/shop"}`;

    const favicon = branding.favicon || `${PUBLIC_BASE_URL}/favicon.png`;
    const ogImage = productMeta?.image || branding.ogImage || favicon;

    // Evitar duplicados
    html = html.replace(/<title>.*?<\/title>/is, "");
    html = html.replace(/<meta\s+name=["']description["'][^>]*>/gi, "");
    html = html.replace(/<link\s+rel=["']canonical["'][^>]*>/gi, "");
    html = html.replace(/<link\s+rel=["']icon["'][^>]*>/gi, "");
    html = html.replace(/<link\s+rel=["']apple-touch-icon["'][^>]*>/gi, "");
    html = html.replace(/<meta\s+property=["']og:[^"']+["'][^>]*>/gi, "");
    html = html.replace(/<meta\s+name=["']twitter:[^"']+["'][^>]*>/gi, "");

    const inject = `
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}" />
<link rel="canonical" href="${esc(canonical)}" />

<link rel="icon" type="image/png" href="${esc(favicon)}" />
<link rel="apple-touch-icon" href="${esc(favicon)}" />

<meta property="og:type" content="product" />
<meta property="og:site_name" content="${esc(siteName)}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(desc)}" />
<meta property="og:url" content="${esc(canonical)}" />
<meta property="og:image" content="${esc(ogImage)}" />
<meta property="og:image:secure_url" content="${esc(ogImage)}" />

<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(desc)}" />
<meta name="twitter:image" content="${esc(ogImage)}" />
`;

    html = html.replace(/<\/head>/i, `${inject}\n</head>`);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    return res.status(200).send(html);
  } catch (e) {
    return next(e);
  }
});

// =========================
// 4) favicon.ico tipo WordPress
// =========================
app.get("/favicon.ico", async (req, res) => {
  const b = await loadBranding();
  if (b?.favicon) return res.redirect(302, b.favicon);
  return res.status(204).end();
});

// =========================
// 5) Proxy resto al frontend
// (assets, /shop/* que no agarró el injector, etc.)
// =========================
app.use(
  "/",
  createProxyMiddleware({
    target: FRONTEND_INTERNAL,
    changeOrigin: true,
    ws: true,
  })
);

app.listen(PORT, () => console.log(`✅ pos360-edge on :${PORT}`));
