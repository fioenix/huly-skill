#!/usr/bin/env node

// Proxy support for sandboxed environments (Cowork, etc.)
//
// Problem: Node.js built-in fetch doesn't route through HTTPS_PROXY reliably.
// NODE_USE_ENV_PROXY resolves DNS locally first → fails when no DNS available.
// setGlobalDispatcher may not affect built-in fetch if undici versions differ.
//
// Solution: monkey-patch globalThis.fetch to use undici.fetch with ProxyAgent.

const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;

if (proxyUrl) {
  process.env.HTTPS_PROXY = proxyUrl;
  process.env.https_proxy = proxyUrl;

  try {
    const undici = require('undici');
    const proxyAgent = new undici.ProxyAgent(proxyUrl);

    // Also set global dispatcher (may help some code paths)
    undici.setGlobalDispatcher(proxyAgent);

    // Monkey-patch globalThis.fetch to force proxy usage
    const originalFetch = globalThis.fetch;
    globalThis.fetch = function(url, opts = {}) {
      return undici.fetch(url, { ...opts, dispatcher: proxyAgent });
    };

    process.stderr.write(`[huly] proxy patched: fetch + dispatcher → ${proxyUrl}\n`);
  } catch (e) {
    process.stderr.write(`[huly] proxy patch failed: ${e.message}\n`);
    process.env.NODE_USE_ENV_PROXY = '1';
  }
} else {
  process.stderr.write('[huly] no proxy\n');
}

require('./bundle.cjs');
