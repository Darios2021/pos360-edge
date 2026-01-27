/**
 * ✅ pos360-edge/server.js
 * ✅ COPY-PASTE FINAL DEFINITIVO (OG real + cache-busting PRO + precio opcional)
 *
 * Qué corrige:
 * - OG placeholders "__OG_TITLE__" etc: el EDGE los reemplaza para BOTS (Facebook/WhatsApp/Twitter/Telegram/Discord)
 * - Warning de Facebook: inyecta fb:app_id si hay FB_APP_ID
 * - Bug de assets: si el HTML viene con "/app/assets/" lo reescribe a "/shop/assets/" para rutas /shop/*
 * - Mantiene proxys: /shop, /shop/assets, /assets, /api, /api/v1, /public, /app (transparente a /shop/app)
 * - ✅ og-default.png: SIEMPRE 200 image/png y tamaño OG recomendado 1200x630
 * - ✅ OG de producto real: /shop/product/:id => consulta API pública y setea og:title/description/image reales
 * - ✅ Nivel 3 (PRO):
 *    - og:image => ...?v=<timestamp> (derivado del filename)
 *    - og:url   => .../shop/... ?ogv=<timestamp>  🔥 (evita cache fantasma de WhatsApp/Meta por URL)
 * - ✅ branch_id: respeta ?branch_id=3 en URL
 * - ✅ Precio opcional:
 *    - inyecta product:price:amount + product:price:currency si la API devuelve precio
 *    - opcional: OG_TITLE_INCLUDE_PRICE=1 => agrega “$xxxx” al og:title (WhatsApp lo muestra SIEMPRE)
 */

const express = require("express");
const path = require("path");
const fs = require("fs");
const zlib = require("zlib");
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
function joinPrefix(prefix, pth) {
  const pfx = removeTrailingSlash(ensureSlashStart(prefix));
  const p = ensureSlashStart(pth);
  if (p === "/") return `${pfx}/`;
  return `${pfx}${p}`;
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

// OG defaults
const OG_SITE_NAME = env("OG_SITE_NAME", "San Juan Tecnología");
const OG_TITLE_DEFAULT = env("OG_TITLE_DEFAULT", "San Juan Tecnología | Tienda");
const OG_DESCRIPTION_DEFAULT = env(
  "OG_DESCRIPTION_DEFAULT",
  "Electrónica, ecommerce, sistemas POS y soluciones tecnológicas para empresas."
);
const OG_IMAGE_DEFAULT = env("OG_IMAGE_DEFAULT", `${PUBLIC_BASE_URL}/og-default.png`);
const FB_APP_ID = env("FB_APP_ID", "");

// Branch default (si no viene en query)
const OG_BRANCH_ID = env("OG_BRANCH_ID", "3");

// ✅ Si querés que WhatsApp muestre precio sí o sí:
const OG_TITLE_INCLUDE_PRICE = env("OG_TITLE_INCLUDE_PRICE", "0") === "1";

// ✅ Moneda por defecto si API no trae
const OG_PRICE_CURRENCY_DEFAULT = env("OG_PRICE_CURRENCY_DEFAULT", "ARS");

// ✅ Ruta local del PNG opcional (si existiera, se usa)
const OG_DEFAULT_FILE = path.join(__dirname, "public", "og-default.png");

// ====== Core settings ======
app.disable("x-powered-by");
app.enable("strict routing");

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

// ====== PNG generator (sin deps) ======
let __crcTable = null;
function crc32(buf) {
  if (!__crcTable) {
    __crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      __crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = __crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);

  const crcBuf = Buffer.alloc(4);
  const crcVal = crc32(Buffer.concat([typeBuf, data]));
  crcBuf.writeUInt32BE(crcVal, 0);

  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function createSolidPng(width, height, rgba = [245, 245, 245, 255]) {
  const [r, g, b, a] = rgba;

  const rowLen = 1 + width * 4;
  const raw = Buffer.alloc(rowLen * height);

  const row = Buffer.alloc(rowLen);
  row[0] = 0; // filter 0
  for (let x = 0; x < width; x++) {
    const o = 1 + x * 4;
    row[o] = r;
    row[o + 1] = g;
    row[o + 2] = b;
    row[o + 3] = a;
  }
  for (let y = 0; y < height; y++) row.copy(raw, y * rowLen);

  const compressed = zlib.deflateSync(raw, { level: 9 });

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const OG_DEFAULT_PNG_BUFFER = createSolidPng(1200, 630, [245, 245, 245, 255]);

// ====== ✅ og-default.png ======
app.get("/og-default.png", async (req, res) => {
  try {
    if (fs.existsSync(OG_DEFAULT_FILE)) {
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.setHeader("X-EDGE-HIT", "og-default-local");
      return res.sendFile(OG_DEFAULT_FILE);
    }

    const upstreamUrl = `${removeTrailingSlash(SHOP_UPSTREAM)}/og-default.png`;
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 5000);

      const resp = await fetch(upstreamUrl, { method: "GET", signal: controller.signal }).finally(
        () => clearTimeout(t)
      );

      const ct = String(resp.headers.get("content-type") || "").toLowerCase();
      if (resp.ok && ct.includes("image/")) {
        const buf = Buffer.from(await resp.arrayBuffer());
        res.status(200);
        res.setHeader("Content-Type", ct || "image/png");
        res.setHeader("Cache-Control", "public, max-age=86400");
        res.setHeader("X-EDGE-HIT", "og-default-upstream");
        return res.send(buf);
      }
    } catch (_) {}

    res.status(200);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("X-EDGE-HIT", "og-default-generated");
    return res.send(OG_DEFAULT_PNG_BUFFER);
  } catch (e) {
    res.status(200);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("X-EDGE-HIT", "og-default-generated");
    return res.send(OG_DEFAULT_PNG_BUFFER);
  }
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

// ====== Bot detect + HTML injector ======
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
    ua.includes("googlebot")
  );
}

function wantsHtml(req) {
  const accept = String(req.headers.accept || "").toLowerCase();
  return !accept || accept.includes("text/html") || accept.includes("*/*");
}

function injectFbAppId(html) {
  if (!FB_APP_ID) return html;
  if (html.includes('property="fb:app_id"') || html.includes("property='fb:app_id'")) {
    return html;
  }
  const meta = `\n    <meta property="fb:app_id" content="${FB_APP_ID}" />\n`;
  if (html.includes('property="og:type"')) {
    return html.replace(
      'property="og:type"',
      `property="fb:app_id" content="${FB_APP_ID}" />\n    <meta property="og:type"`
    );
  }
  return html.replace("</head>", `${meta}</head>`);
}

function absolutizeUrl(u) {
  if (!u) return "";
  const s = String(u).trim();
  if (!s) return "";
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  if (s.startsWith("//")) return `https:${s}`;
  return `${PUBLIC_BASE_URL}${s.startsWith("/") ? "" : "/"}${s}`;
}

function pickFirstImage(obj) {
  if (!obj) return "";
  const candidates = [
    obj.og_image,
    obj.image,
    obj.image_url,
    obj.imageUrl,
    obj.cover,
    obj.cover_url,
    obj.thumbnail,
    obj.thumbnail_url,
    obj.photo,
    obj.photo_url,
    obj.main_image,
    obj.main_image_url,
  ];
  for (const c of candidates) {
    if (c && String(c).trim()) return String(c).trim();
  }
  const imgs = obj.images || obj.gallery || obj.pictures;
  if (Array.isArray(imgs) && imgs.length) {
    const first = imgs[0];
    if (typeof first === "string") return first;
    if (first && typeof first === "object") {
      return (
        first.url ||
        first.secure_url ||
        first.src ||
        first.path ||
        first.location ||
        first.public_url ||
        ""
      );
    }
  }
  return "";
}

function deriveImageVersion(imageUrl, productId, branchId) {
  const u = String(imageUrl || "");
  const m = u.match(/\/(\d{10,})-[^\/]+\.(webp|jpg|jpeg|png)(\?.*)?$/i);
  if (m && m[1]) return m[1];
  const m2 = u.match(/\/(\d{10,})\.(webp|jpg|jpeg|png)(\?.*)?$/i);
  if (m2 && m2[1]) return m2[1];
  return `p${String(productId || "").trim() || "x"}-b${String(branchId || "").trim() || "x"}`;
}

function addVersionParam(url, key, version) {
  if (!url) return url;
  const s = String(url);
  if (!version) return s;
  const re = new RegExp(`[?&]${key}=`, "i");
  if (re.test(s)) return s;
  return s.includes("?")
    ? `${s}&${key}=${encodeURIComponent(version)}`
    : `${s}?${key}=${encodeURIComponent(version)}`;
}

function normalizePrice(v) {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  if (!s) return "";
  // si viene "14.100,00" o "14100.00" lo dejamos simple
  const clean = s.replace(/\s/g, "");
  return clean;
}

async function fetchJson(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const text = await resp.text();
    if (!resp.ok) return { ok: false, status: resp.status, data: null, text };
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (_) {
      return { ok: false, status: resp.status, data: null, text };
    }
    return { ok: true, status: resp.status, data, text };
  } catch (e) {
    return { ok: false, status: 0, data: null, text: "" };
  } finally {
    clearTimeout(t);
  }
}

async function fetchProductOg(productId, branchId) {
  const id = String(productId || "").trim();
  const br = String(branchId || "").trim() || OG_BRANCH_ID;
  if (!id) return null;

  const base = removeTrailingSlash(API_ORIGIN) + ensureSlashStart(API_BASE);
  const branch = encodeURIComponent(br);

  const tries = [
    `${base}/public/products/${encodeURIComponent(id)}?branch_id=${branch}`,
    `${base}/public/product/${encodeURIComponent(id)}?branch_id=${branch}`,
    `${base}/public/products/${encodeURIComponent(id)}`,
    `${base}/public/product/${encodeURIComponent(id)}`,
    `${base}/public/catalog?branch_id=${branch}&product_id=${encodeURIComponent(id)}&page=1&limit=1`,
    `${base}/public/catalog?branch_id=${branch}&id=${encodeURIComponent(id)}&page=1&limit=1`,
  ];

  for (const url of tries) {
    const r = await fetchJson(url, 5000);
    if (!r.ok || !r.data) continue;

    const d = r.data;
    const item =
      d.item ||
      d.product ||
      (Array.isArray(d.items) && d.items[0]) ||
      (Array.isArray(d.data) && d.data[0]) ||
      d;

    if (!item || typeof item !== "object") continue;

    const name =
      item.name ||
      item.title ||
      item.product_name ||
      item.productTitle ||
      item.nombre ||
      "";

    const description =
      item.description ||
      item.desc ||
      item.short_description ||
      item.shortDescription ||
      item.descripcion ||
      "";

    const img = pickFirstImage(item);
    const imageAbs = img ? absolutizeUrl(img) : "";

    const safeName = String(name || "").trim();
    if (!safeName) continue;

    // ✅ precio (si la API lo trae)
    const rawPrice =
      item.price ??
      item.price_final ??
      item.price_list ??
      item.price_discount ??
      item.amount ??
      "";

    const price = normalizePrice(rawPrice);
    const currency =
      (item.currency || item.price_currency || item.currency_code || "").toString().trim() ||
      OG_PRICE_CURRENCY_DEFAULT;

    // ✅ title/desc
    let titleBase = `${safeName} | ${OG_SITE_NAME}`;
    if (OG_TITLE_INCLUDE_PRICE && price) {
      // WhatsApp lo muestra siempre
      titleBase = `${safeName} - $${price} | ${OG_SITE_NAME}`;
    }

    const desc = String(description || "").trim() || OG_DESCRIPTION_DEFAULT;

    // ✅ Versionado imagen (v=...)
    const baseImg = imageAbs || OG_IMAGE_DEFAULT;
    const v = deriveImageVersion(baseImg, id, br);
    const versionedImage = addVersionParam(baseImg, "v", v);

    return {
      ogTitle: titleBase,
      ogDescription: desc,
      ogImage: versionedImage,
      ogVersion: v, // ✅ la usamos para og:url (ogv=...)
      price: price,
      currency: currency,
    };
  }

  return null;
}

function matchProductId(pathname) {
  const m = String(pathname || "").match(/^\/shop\/product\/(\d+)(\/|$|\?)/i);
  return m ? m[1] : null;
}

function replaceTokens(html, req, overrides = null) {
  // ✅ FIX CLAVE:
  // botOgMiddleware está montado en "/shop/" => req.path NO incluye "/shop"
  // Por eso reinyectamos FRONTEND_INDEX_PATH para construir og:url correcto:
  const publicPathWithShop = joinPrefix(FRONTEND_INDEX_PATH, req.path); // "/shop" + "/product/309"
  const baseOgUrl = `${PUBLIC_BASE_URL}${removeTrailingSlash(publicPathWithShop)}`;

  // ✅ og:url PRO: versionado para matar cache fantasma de WhatsApp/Meta
  const ogv = overrides?.ogVersion || Date.now().toString();
  const fullOgUrl = addVersionParam(baseOgUrl, "ogv", ogv);

  // canonical: URL real visible por usuario (con query)
  const canonical = `${PUBLIC_BASE_URL}${req.originalUrl}`;

  const ogTitle = overrides?.ogTitle || OG_TITLE_DEFAULT;
  const ogDescription = overrides?.ogDescription || OG_DESCRIPTION_DEFAULT;
  const ogImage = overrides?.ogImage || OG_IMAGE_DEFAULT;

  let out = html
    .replaceAll("__TITLE__", ogTitle)
    .replaceAll("__DESCRIPTION__", ogDescription)
    .replaceAll("__CANONICAL__", canonical)

    .replaceAll("__SITE_NAME__", OG_SITE_NAME)
    .replaceAll("__OG_TITLE__", ogTitle)
    .replaceAll("__OG_DESCRIPTION__", ogDescription)
    .replaceAll("__OG_URL__", fullOgUrl)
    .replaceAll("__OG_IMAGE__", ogImage)
    .replaceAll("__OG_IMAGE_ALT__", ogTitle);

  // ✅ Fix assets mismatch: si el HTML vino con /app/assets para una URL /shop/*
  if (req.originalUrl.startsWith("/shop/")) {
    out = out
      .replaceAll('src="/app/assets/', 'src="/shop/assets/')
      .replaceAll("src='/app/assets/", "src='/shop/assets/")
      .replaceAll('href="/app/assets/', 'href="/shop/assets/')
      .replaceAll("href='/app/assets/", "href='/shop/assets/");
  }

  // ✅ Inyecta fb:app_id
  out = injectFbAppId(out);

  // ✅ Inyecta meta de precio (Facebook lo entiende; WhatsApp depende)
  if (overrides?.price) {
    const priceMeta =
      `\n    <meta property="product:price:amount" content="${String(overrides.price)}" />` +
      `\n    <meta property="product:price:currency" content="${String(
        overrides.currency || OG_PRICE_CURRENCY_DEFAULT
      )}" />\n`;
    out = out.replace("</head>", `${priceMeta}</head>`);
  }

  return out;
}

async function fetchUpstreamHtml(pathname) {
  const url = `${removeTrailingSlash(SHOP_UPSTREAM)}${pathname}`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 6000);

  const resp = await fetch(url, {
    method: "GET",
    headers: { Accept: "text/html,*/*;q=0.8" },
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

    if (
      req.originalUrl.startsWith("/shop/assets/") ||
      req.originalUrl.startsWith("/assets/") ||
      req.originalUrl.startsWith("/api/") ||
      req.originalUrl.startsWith("/public/") ||
      req.originalUrl.startsWith("/app/") ||
      req.originalUrl === "/og-default.png"
    ) {
      return next();
    }

    // ✅ Pedimos HTML al upstream usando prefijo /shop
    const upstreamPath = joinPrefix(FRONTEND_INDEX_PATH, req.path);
    const { status, contentType, body } = await fetchUpstreamHtml(upstreamPath);

    if (!String(contentType).toLowerCase().includes("text/html")) {
      res.status(status).send(body);
      return;
    }

    const pid = matchProductId(req.originalUrl);
    const branchId =
      (req.query && req.query.branch_id ? String(req.query.branch_id) : "") || OG_BRANCH_ID;

    const og = pid ? await fetchProductOg(pid, branchId) : null;

    const patched = replaceTokens(body, req, og);

    res.status(status);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("X-EDGE-HIT", og ? "bot-og-product" : "bot-og-default");
    res.send(patched);
  } catch (e) {
    console.error("❌ botOgMiddleware error:", e && e.message ? e.message : e);
    next();
  }
}

// ====== Proxys ======
const shopAssetsFirstProxy = makeProxy(SHOP_UPSTREAM, {
  pathRewrite: (p) => `/assets${ensureSlashStart(p)}`,
});

const shopProxy = makeProxy(SHOP_UPSTREAM, {
  pathRewrite: (p) => joinPrefix(FRONTEND_INDEX_PATH, p),
});

const appProxy = makeProxy(SHOP_UPSTREAM, {
  pathRewrite: (p) => joinPrefix(APP_INDEX_PATH, p),
});

const rootAssetsProxy = makeProxy(SHOP_UPSTREAM, {
  pathRewrite: (p) => `/assets${ensureSlashStart(p)}`,
});

const rootStaticProxy = makeProxy(SHOP_UPSTREAM);

const apiProxy = makeProxy(API_ORIGIN, {
  pathRewrite: (p) => {
    const base = ensureSlashStart(API_BASE);
    if (p.startsWith(base)) return p;
    return `${removeTrailingSlash(base)}${ensureSlashStart(p)}`;
  },
});

const apiV1CompatProxy = makeProxy(API_ORIGIN);
const publicCompatProxy = makeProxy(API_ORIGIN);

// ====== Redirects base ======
app.get("/", (req, res) => res.redirect(301, removeTrailingSlash(FRONTEND_INDEX_PATH) + "/"));
app.get("/shop", (req, res) => res.redirect(301, "/shop/"));
app.get("/app", (req, res) => res.redirect(301, "/app/"));

// ====== ✅ MOUNTS (ORDEN IMPORTA) ======
app.use("/shop/", botOgMiddleware);

app.use("/shop/assets/", shopAssetsFirstProxy);

app.use("/assets/", rootAssetsProxy);

app.get("/favicon.ico", rootStaticProxy);
app.get("/robots.txt", rootStaticProxy);
app.get("/manifest.webmanifest", rootStaticProxy);
app.get("/manifest.json", rootStaticProxy);

app.use("/app/", appProxy);

app.use("/shop/", shopProxy);

app.use("/api/v1/", apiV1CompatProxy);
app.use("/public/", publicCompatProxy);

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
  console.log(`OG_BRANCH_ID -> ${OG_BRANCH_ID}`);
  console.log(`OG_TITLE_INCLUDE_PRICE -> ${OG_TITLE_INCLUDE_PRICE ? "1" : "0"}`);
  console.log(`OG_DEFAULT_FILE -> ${OG_DEFAULT_FILE}`);
});
