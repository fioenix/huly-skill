#!/usr/bin/env node

// Cowork sandbox support: route traffic through local HTTP proxy.
// Safe to set unconditionally — no-op if proxy isn't present.
if (!process.env.HTTPS_PROXY && !process.env.https_proxy) {
  process.env.HTTPS_PROXY = 'http://127.0.0.1:3128';
}
process.env.NODE_USE_ENV_PROXY = process.env.NODE_USE_ENV_PROXY || '1';

require('./bundle.cjs');
