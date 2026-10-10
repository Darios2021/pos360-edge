/**
 * src/proxy/proxies.js
 */

const { makeProxy } = require("./makeProxy");
const {
  SHOP_UPSTREAM,
  APP_UPSTREAM,
  API_ORIGIN,
  API_BASE,
  FRONTEND_INDEX_PATH,
  APP_INDEX_PATH,
} = require("../config");
const { ensureSlashStart, removeTrailingSlash, joinPrefix } = require("../utils/path");

const shopAssetsFirstProxy = makeProxy(SHOP_UPSTREAM, {
  pathRewrite: (p) => `/assets${ensureSlashStart(p)}`,
});

const shopProxy = makeProxy(SHOP_UPSTREAM, {
  pathRewrite: (p) => joinPrefix(FRONTEND_INDEX_PATH, p),
});

const appProxy = makeProxy(APP_UPSTREAM, {
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

// Socket.io de la API (avisos en vivo, p. ej. derivaciones). Montado en
// /socket.io/, Express le quita el prefijo: se repone acá. Sólo transporte
// polling; si el upgrade a websocket no pasa, el cliente sigue por polling.
const socketProxy = makeProxy(API_ORIGIN, {
  pathRewrite: (p) => `/socket.io${ensureSlashStart(p)}`,
});
const publicCompatProxy = makeProxy(API_ORIGIN);

module.exports = {
  shopAssetsFirstProxy,
  shopProxy,
  appProxy,
  rootAssetsProxy,
  rootStaticProxy,
  apiProxy,
  apiV1CompatProxy,
  publicCompatProxy,
  socketProxy,
};
