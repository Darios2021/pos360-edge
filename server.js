/**
 * pos360-edge (COPY-PASTE FINAL DEFINITIVO)
 *
 * Objetivos:
 * - / -> /shop
 * - ✅ /api/v1/* => proxy a commerce-api
 * - ✅ /public/* => proxy a commerce-api (/api/v1/public/*)  <-- FIX “catálogo devuelve HTML”
 * - ✅ Inyección OG/Favicon para TODAS las rutas HTML del SHOP (no /app)
 *   - ✅ /shop/product/:id => OG por producto (requiere branch_id)
 * - ✅ /app y /app/* => proxy directo al frontend (admin), SIN OG injection
 * - ✅ Reescribe Location para que NUNCA aparezca http://srv-captain--...
 * - ✅ og:image fallback siempre válido (PNG 1x1)
 */

const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");

// node-fetch lazy (compat)
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

const app = express();
const PORT = process.env.PORT || 3000;

/* =========================
   ENV
   ========================= */
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || "https://sanjuantecnologia.com").replace(/\/+$/, "");

// Frontend interno (CapRover service name)
const FRONTEND_INTERNAL = String(process.env.FRONTEND_INTERNAL || "http://srv-captain--pos360-frontend").replace(/\/+$/, "");
const FRONTEND_INDEX_PATH = String(process.env.FRONTEND_INDEX_PATH || "/shop").replace(/\/+$/, "");

// API origin (recomendado) y API_BASE (compat)
const API_ORIGIN = String(process.env.API_ORIGIN || "https://pos360-commerce-api.cingulado.org").replace(/\/+$/, "");
const API_BASE = String(process.env.API_BASE || `${API_ORIGIN}/api/v1`).replace(/\/+$/, "");

// Endpoints API
const BRANDING_ENDPOINT = String(process.env.BRANDING_ENDPOINT || "/shop/branding/public").trim();
// Tu API de producto pide branch_id e id
const PRODUCT_PUBLIC_ENDPOINT = String(process.env.PRODUCT_PUBLIC_ENDPOINT || "/public/products").trim();
const OG_BRANCH_ID = Number(process.env.OG_BRANCH_ID || "3");

// Cache branding
const CACHE_SECONDS = Math.max(5, parseInt(process.env.BRANDING_CACHE_SECONDS || "60", 10) || 60);

/* =========================
   HELPERS
   ========================= */
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

function isShopProductPath(p) {
  return /^\/shop\/product\/(\d+)(\/)?$/i.test(p);
}

function getProductIdFromPath(p) {
  const m = p.match(/^\/shop\/product\/(\d+)(\/)?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* =========================
   SAFE OG IMAGE FALLBACK (PNG 1x1)
   - evita warnings “og:image content-type inválido”
   ========================= */
const ONE_BY_ONE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/erWn2kAAAAASUVORK5CYII=",
  "base64"
);

app.get("/og-default.png", (req, res) => {
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "public, max-age=86400");
  return res.status(200).send(ONE_BY_ONE_PNG);
});

/* =========================
   BRANDING CACHE
   ========================= */
let cachedBranding = null;
let cachedAt = 0;

async function loadBranding() {
  const now = Date.now();
  if (cachedBranding && now - cachedAt < CACHE_SECONDS * 1000) return cachedBranding;

  try {
    const r = await fetch(`${API_BASE}${BRANDING_ENDPOINT}`, {
      headers: { Accept: "application/json" },
      redirect: "follow",
    });
    if (!r.ok) throw new Error(`branding http ${r.status}`);
    const j = await r.json();

    const name = j?.name || "San Juan Tecnología";
    const favicon = absUrl(j?.favicon_url || j?.logo_url || "");
    const ogImage = absUrl(j?.og_image_url || j?.logo_url || j?.favicon_url || "");

    cachedBranding = { name, favicon, ogImage };
    cachedAt = now;
    return cachedBranding;
  } catch {
    cachedBranding = { name: "San Juan Tecnología", favicon: "", ogImage: "" };
    cachedAt = now;
    return cachedBranding;
  }
}

/* =========================
   PRODUCT OG helper
   ========================= */
function pickDescFromProduct(p) {
  const keys = ["short_description", "description", "desc", "summary"];
  for (const k of keys) {
    const v = p?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function pickImageFromProduct(p) {
  // Tu API ya entrega image_url en catalog. En producto puede variar.
  const tryKeys = [
    "og_image_url",
    "image_url",
    "image",
    "thumbnail",
    "thumb",
    "cover",
    "main_image",
    "primary_image",
    "photo_url",
    "picture",
  ];
  for (const k of tryKeys) {
    const v = p?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }

  // arrays típicos
  const arrs = [p?.images, p?.product_images, p?.gallery, p?.photos];
  for (const a of arrs) {
    if (Array.isArray(a) && a.length) {
      const first = a[0];
      const u =
        (typeof first === "string" && first) ||
        first?.url ||
        first?.image_url ||
        first?.src ||
        first?.path ||
        "";
      if (u) return String(u);
    }
  }

  return "";
}

/**
 * Tu API (según curl) requiere:
 * GET /api/v1/public/products?id=303&branch_id=3
 */
async function loadProductForOg(productId) {
  try {
    const url = new URL(`${API_BASE}${PRODUCT_PUBLIC_ENDPOINT}`);
    url.searchParams.set("id", String(productId));
    url.searchParams.set("branch_id", String(OG_BRANCH_ID || 3));

    const r = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      redirect: "follow",
    });
    if (!r.ok) throw new Error(`product http ${r.status}`);
    const j = await r.json();

    // tolerar envoltorios
    const p = j?.item || j?.product || j?.data || j;

    const name = String(p?.name || p?.title || "").trim();
    const desc = pickDescFromProduct(p);
    const img = pickImageFromProduct(p);

    return {
      name,
      desc,
      image: absUrl(img),
    };
  } catch {
    return null;
  }
}

/* =========================
   0) HOME
   ========================= */
app.get("/", (req, res) => res.redirect(301, "/shop"));

/* =========================
   1) ✅ API PROXY (tu backend real)
   /api/v1/* -> API_ORIGIN/api/v1/*
   ========================= */
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

/* =========================
   2) ✅ PUBLIC PROXY  (FIX catalog HTML)
   /public/* -> API_ORIGIN/api/v1/public/*
   Ej: /public/catalog -> /api/v1/public/catalog
   ========================= */
app.use(
  "/public",
  createProxyMiddleware({
    target: API_ORIGIN,
    changeOrigin: true,
    secure: true,
    ws: true,
    pathRewrite: { "^/public": "/api/v1/public" },
  })
);

/* =========================
   3) favicon.ico (tipo WP)
   ========================= */
app.get("/favicon.ico", async (req, res) => {
  const b = await loadBranding();
  if (b?.favicon) return res.redirect(302, b.favicon);
  return res.status(204).end();
});

/* =========================
   4) /favicon.png
   - porque vos estabas usando fallback /favicon.png y te daba 404
   - ahora: si hay branding.favicon => redirect; sino => og-default.png (200 image/png)
   ========================= */
app.get("/favicon.png", async (req, res) => {
  const b = await loadBranding();
  if (b?.favicon) return res.redirect(302, b.favicon);
  return res.redirect(302, `${PUBLIC_BASE_URL}/og-default.png`);
});

/* =========================
   5) HTML INJECTION (SOLO SHOP)
   - No toca /app
   - No toca /api/v1 ni /public
   ========================= */
app.get("*", async (req, res, next) => {
  try {
    // si no es html o es asset/api/public => proxy normal
    if (!wantsHtml(req)) return next();
    if (isAssetPath(req.path)) return next();
    if (req.path.startsWith("/api/v1/")) return next();
    if (req.path.startsWith("/public/")) return next();

    // ✅ /app queda sin inyección (admin)
    if (req.path === "/app" || req.path.startsWith("/app/")) return next();

    const [branding, indexRes] = await Promise.all([
      loadBranding(),
      fetch(`${FRONTEND_INTERNAL}${FRONTEND_INDEX_PATH}`, {
        headers: { Accept: "text/html" },
        redirect: "follow",
      }),
    ]);

    let html = await indexRes.text();

    // base OG
    let title = `${branding.name} | Tienda`;
    let desc = "Electrónica, ecommerce, sistemas POS y soluciones tecnológicas para empresas.";
    const canonical = `${PUBLIC_BASE_URL}${req.originalUrl || "/shop"}`;

    // favicon + ogImage (fallbacks)
    let favicon = branding.favicon || `${PUBLIC_BASE_URL}/favicon.png`; // ahora existe route y devuelve imagen
    let ogImage = branding.ogImage || favicon || `${PUBLIC_BASE_URL}/og-default.png`;

    // ✅ PRODUCT OG
    if (isShopProductPath(req.path)) {
      const productId = getProductIdFromPath(req.path);
      if (productId) {
        const p = await loadProductForOg(productId);
        if (p?.name) title = `${p.name} | ${branding.name}`;
        if (p?.desc) desc = p.desc.slice(0, 300);
        if (p?.image) ogImage = p.image;
      }
    }

    // 🧹 remover placeholders del build prerender si existen
    html = html
      .replaceAll("__TITLE__", "")
      .replaceAll("__DESCRIPTION__", "")
      .replaceAll("__CANONICAL__", "")
      .replaceAll("__FAVICON__", "")
      .replaceAll("__SITE_NAME__", "")
      .replaceAll("__OG_TITLE__", "")
      .replaceAll("__OG_DESCRIPTION__", "")
      .replaceAll("__OG_URL__", "")
      .replaceAll("__OG_IMAGE__", "")
      .replaceAll("__OG_IMAGE_ALT__", "");

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

<meta property="og:type" content="website" />
<meta property="og:site_name" content="${esc(branding.name)}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(desc)}" />
<meta property="og:url" content="${esc(canonical)}" />

<meta property="og:image" content="${esc(ogImage)}" />
<meta property="og:image:secure_url" content="${esc(ogImage)}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="${esc(title)}" />

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

/* =========================
   6) PROXY al frontend
   - /app y resto (SPA)
   - ✅ Rewrite Location: evita http://srv-captain--...
   ========================= */
app.use(
  "/",
  createProxyMiddleware({
    target: FRONTEND_INTERNAL,
    changeOrigin: true,
    ws: true,

    // ayuda a reescrituras
    autoRewrite: true,
    protocolRewrite: "https",

    onProxyReq(proxyReq) {
      // upstream entiende host real
      try {
        const host = new URL(PUBLIC_BASE_URL).host;
        proxyReq.setHeader("X-Forwarded-Host", host);
        proxyReq.setHeader("X-Forwarded-Proto", "https");
      } catch {}
    },

    onProxyRes(proxyRes) {
      // ✅ si backend devuelve Location: http://srv-captain--pos360-frontend/...
      const loc = proxyRes.headers["location"];
      if (loc && typeof loc === "string") {
        const fixed = loc
          .replace(/^http:\/\/srv-captain--pos360-frontend/i, PUBLIC_BASE_URL)
          .replace(/^https:\/\/srv-captain--pos360-frontend/i, PUBLIC_BASE_URL)
          .replace(/^http:\/\/srv-captain--pos360-frontend\/?/i, `${PUBLIC_BASE_URL}/`)
          .replace(/^https:\/\/srv-captain--pos360-frontend\/?/i, `${PUBLIC_BASE_URL}/`);
        proxyRes.headers["location"] = fixed;
      }
    },
  })
);

app.listen(PORT, () => console.log(`✅ pos360-edge on :${PORT}`));
