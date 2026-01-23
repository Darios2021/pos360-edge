/**
 * pos360-edge (COPY-PASTE FINAL - FIXED)
 *
 * FIXES:
 * - / -> /shop
 * - ✅ /api/v1/*  -> API_ORIGIN/api/v1/*     (rewrite correcto en mount)
 * - ✅ /public/*  -> API_ORIGIN/api/v1/public/* (rewrite correcto en mount)
 * - ✅ OG injection SOLO para SHOP HTML (no /app)
 *   - ✅ /shop/product/:id => OG por producto (usa branch_id + id query)
 * - ✅ og:image fallback SIEMPRE imagen real (og-default.png) (no redirect raro)
 * - ✅ /favicon.png y /favicon.ico SIEMPRE imagen real (o redirect a real)
 * - ✅ Location rewrite para que nunca salga srv-captain en redirects
 */

const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

const app = express();
const PORT = process.env.PORT || 3000;

/* =========================
   ENV
   ========================= */
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || "https://sanjuantecnologia.com").replace(/\/+$/, "");
const FRONTEND_INTERNAL = String(process.env.FRONTEND_INTERNAL || "http://srv-captain--pos360-frontend").replace(/\/+$/, "");
const FRONTEND_INDEX_PATH = String(process.env.FRONTEND_INDEX_PATH || "/shop").replace(/\/+$/, "");

const API_ORIGIN = String(process.env.API_ORIGIN || "https://pos360-commerce-api.cingulado.org").replace(/\/+$/, "");
const API_BASE = String(process.env.API_BASE || `${API_ORIGIN}/api/v1`).replace(/\/+$/, "");

const BRANDING_ENDPOINT = String(process.env.BRANDING_ENDPOINT || "/shop/branding/public").trim();

const PRODUCT_PUBLIC_ENDPOINT = String(process.env.PRODUCT_PUBLIC_ENDPOINT || "/public/products").trim();
const OG_BRANCH_ID = Number(process.env.OG_BRANCH_ID || "3");

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
   SAFE IMAGE (PNG 1x1) - REAL image/png
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
   PRODUCT OG
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
  const tryKeys = ["og_image_url", "image_url", "image", "thumbnail", "thumb", "cover", "main_image", "primary_image"];
  for (const k of tryKeys) {
    const v = p?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

async function loadProductForOg(productId) {
  try {
    const url = new URL(`${API_BASE}${PRODUCT_PUBLIC_ENDPOINT}`);
    // ✅ tu API exige id + branch_id
    url.searchParams.set("id", String(productId));
    url.searchParams.set("branch_id", String(OG_BRANCH_ID || 3));

    const r = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      redirect: "follow",
    });
    if (!r.ok) throw new Error(`product http ${r.status}`);

    const j = await r.json();
    const p = j?.item || j?.product || j?.data || j;

    const name = String(p?.name || p?.title || "").trim();
    const desc = pickDescFromProduct(p);
    const img = pickImageFromProduct(p);

    return { name, desc, image: absUrl(img) };
  } catch {
    return null;
  }
}

/* =========================
   0) HOME
   ========================= */
app.get("/", (req, res) => res.redirect(301, "/shop"));

/* =========================
   1) ✅ API PROXY (mount strips /api/v1)
   /api/v1/* -> API_ORIGIN/api/v1/*
   ========================= */
app.use(
  "/api/v1",
  createProxyMiddleware({
    target: API_ORIGIN,
    changeOrigin: true,
    secure: true,
    ws: true,
    // ✅ IMPORTANTE: dentro del middleware el path empieza con "/..."
    pathRewrite: (path) => `/api/v1${path}`,
  })
);

/* =========================
   2) ✅ PUBLIC PROXY (mount strips /public)
   /public/* -> API_ORIGIN/api/v1/public/*
   ========================= */
app.use(
  "/public",
  createProxyMiddleware({
    target: API_ORIGIN,
    changeOrigin: true,
    secure: true,
    ws: true,
    // ✅ IMPORTANTE: dentro del middleware el path empieza con "/catalog..."
    pathRewrite: (path) => `/api/v1/public${path}`,
  })
);

/* =========================
   3) favicon (NO 404)
   - Para browser puede ser branding
   - Para seguridad: si no hay branding => imagen real (og-default.png)
   ========================= */
app.get("/favicon.ico", async (req, res) => {
  const b = await loadBranding();
  if (b?.favicon) return res.redirect(302, b.favicon);
  res.setHeader("Content-Type", "image/png");
  return res.status(200).send(ONE_BY_ONE_PNG);
});

app.get("/favicon.png", async (req, res) => {
  const b = await loadBranding();
  if (b?.favicon) return res.redirect(302, b.favicon);
  res.setHeader("Content-Type", "image/png");
  return res.status(200).send(ONE_BY_ONE_PNG);
});

/* =========================
   4) HTML INJECTION (SOLO SHOP)
   ========================= */
app.get("*", async (req, res, next) => {
  try {
    if (!wantsHtml(req)) return next();
    if (isAssetPath(req.path)) return next();
    if (req.path.startsWith("/api/v1/")) return next();
    if (req.path.startsWith("/public/")) return next();

    // ✅ NO tocar /app (admin)
    if (req.path === "/app" || req.path.startsWith("/app/")) return next();

    const [branding, indexRes] = await Promise.all([
      loadBranding(),
      fetch(`${FRONTEND_INTERNAL}${FRONTEND_INDEX_PATH}`, {
        headers: { Accept: "text/html" },
        redirect: "follow",
      }),
    ]);

    let html = await indexRes.text();

    let title = `${branding.name} | Tienda`;
    let desc = "Electrónica, ecommerce, sistemas POS y soluciones tecnológicas para empresas.";
    const canonical = `${PUBLIC_BASE_URL}${req.originalUrl || "/shop"}`;

    const favicon = branding.favicon || `${PUBLIC_BASE_URL}/favicon.png`;

    // ✅ og:image fallback REAL (no redirect)
    let ogImage = branding.ogImage || `${PUBLIC_BASE_URL}/og-default.png`;

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
   5) Proxy resto al frontend (incluye /app)
   + Location rewrite srv-captain -> dominio público
   ========================= */
app.use(
  "/",
  createProxyMiddleware({
    target: FRONTEND_INTERNAL,
    changeOrigin: true,
    ws: true,
    autoRewrite: true,
    protocolRewrite: "https",

    onProxyReq(proxyReq) {
      try {
        const host = new URL(PUBLIC_BASE_URL).host;
        proxyReq.setHeader("X-Forwarded-Host", host);
        proxyReq.setHeader("X-Forwarded-Proto", "https");
      } catch {}
    },

    onProxyRes(proxyRes) {
      const loc = proxyRes.headers["location"];
      if (loc && typeof loc === "string") {
        proxyRes.headers["location"] = loc
          .replace(/^http:\/\/srv-captain--pos360-frontend/i, PUBLIC_BASE_URL)
          .replace(/^https:\/\/srv-captain--pos360-frontend/i, PUBLIC_BASE_URL);
      }
    },
  })
);

app.listen(PORT, () => console.log(`✅ pos360-edge on :${PORT}`));
