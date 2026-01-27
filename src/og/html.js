/**
 * src/og/html.js
 * ✅ COPY-PASTE FINAL
 * - Detecta bots
 * - Reemplaza tokens OG
 * - Inyecta fb:app_id
 * - FIX: elimina og:image:width/height (WhatsApp descarta si no coincide con la imagen real)
 */

const {
  FB_APP_ID,
  OG_SITE_NAME,
  OG_TITLE_DEFAULT,
  OG_DESCRIPTION_DEFAULT,
  OG_IMAGE_DEFAULT,
  PUBLIC_BASE_URL,
  FRONTEND_INDEX_PATH,
  OG_PRICE_CURRENCY_DEFAULT,
} = require("../config");

const { joinPrefix, removeTrailingSlash } = require("../utils/path");
const { addVersionParam } = require("./productOg");

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
  if (html.includes('property="fb:app_id"') || html.includes("property='fb:app_id'")) return html;

  const meta = `\n    <meta property="fb:app_id" content="${FB_APP_ID}" />\n`;
  if (html.includes('property="og:type"')) {
    return html.replace(
      'property="og:type"',
      `property="fb:app_id" content="${FB_APP_ID}" />\n    <meta property="og:type"`
    );
  }
  return html.replace("</head>", `${meta}</head>`);
}

/**
 * ✅ WhatsApp puede ignorar og:image si width/height no coincide con la imagen real
 * -> eliminamos esas metas para evitar mismatch.
 */
function stripOgImageSizeMeta(html) {
  if (!html) return html;

  // elimina <meta property="og:image:width" ...> y height (comillas simples o dobles)
  return html
    .replace(/<meta[^>]+property=['"]og:image:width['"][^>]*>\s*/gi, "")
    .replace(/<meta[^>]+property=['"]og:image:height['"][^>]*>\s*/gi, "");
}

function replaceTokens(html, req, overrides = null) {
  const publicPathWithShop = joinPrefix(FRONTEND_INDEX_PATH, req.path);
  const baseOgUrl = `${PUBLIC_BASE_URL}${removeTrailingSlash(publicPathWithShop)}`;

  const ogv = overrides?.ogVersion || Date.now().toString();
  const fullOgUrl = addVersionParam(baseOgUrl, "ogv", ogv);

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

  // Fix assets mismatch: /app/assets -> /shop/assets si estamos en /shop/*
  if (req.originalUrl.startsWith("/shop/")) {
    out = out
      .replaceAll('src="/app/assets/', 'src="/shop/assets/')
      .replaceAll("src='/app/assets/", "src='/shop/assets/")
      .replaceAll('href="/app/assets/', 'href="/shop/assets/')
      .replaceAll("href='/app/assets/", "href='/shop/assets/");
  }

  out = injectFbAppId(out);

  // meta de precio (si hay)
  if (overrides?.price) {
    const priceMeta =
      `\n    <meta property="product:price:amount" content="${String(overrides.price)}" />` +
      `\n    <meta property="product:price:currency" content="${String(
        overrides.currency || OG_PRICE_CURRENCY_DEFAULT
      )}" />\n`;
    out = out.replace("</head>", `${priceMeta}</head>`);
  }

  // ✅ CLAVE: evitamos que WA descarte og:image por mismatch de size
  out = stripOgImageSizeMeta(out);

  return out;
}

function matchProductId(pathname) {
  const m = String(pathname || "").match(/^\/shop\/product\/(\d+)(\/|$|\?)/i);
  return m ? m[1] : null;
}

module.exports = { isBot, wantsHtml, replaceTokens, matchProductId };
