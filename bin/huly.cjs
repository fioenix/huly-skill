#!/usr/bin/env node

// Proxy support for sandboxed environments (Cowork, etc.)
//
// Node.js 22 built-in fetch with NODE_USE_ENV_PROXY still resolves DNS
// locally before routing through proxy → fails in sandbox (no DNS).
// Fix: undici.ProxyAgent + setGlobalDispatcher sends CONNECT directly
// to proxy (proxy resolves DNS).
//
// HTTPS_PROXY is also read by the bundled ws/https-proxy-agent for
// WebSocket connections (Huly Transactor).

const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;

if (proxyUrl) {
  // Ensure both casings are set (ws reads lowercase, Node reads uppercase)
  process.env.HTTPS_PROXY = proxyUrl;
  process.env.https_proxy = proxyUrl;

  // Patch global fetch dispatcher — the critical fix for sandboxed fetch
  try {
    const { ProxyAgent, setGlobalDispatcher } = require('undici');
    setGlobalDispatcher(new ProxyAgent(proxyUrl));
  } catch (e) {
    // undici not available (Node <18), fall back to NODE_USE_ENV_PROXY
    process.env.NODE_USE_ENV_PROXY = '1';
  }
}

require('./bundle.cjs');
