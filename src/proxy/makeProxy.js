/**
 * src/proxy/makeProxy.js
 */

const { createProxyMiddleware } = require("http-proxy-middleware");
const { PROXY_LOG_LEVEL } = require("../config");

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
      console.error("❌ proxy error:", req.method, req.originalUrl, err && err.message ? err.message : err);
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

module.exports = { makeProxy };
