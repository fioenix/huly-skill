#!/usr/bin/env node

// Proxy support for sandboxed environments (e.g. Claude Cowork).
// Native WebSocket doesn't respect HTTPS_PROXY — replace with undici's
// proxy-aware WebSocket before bundle loads.
const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
if (proxyUrl) {
  const { ProxyAgent, setGlobalDispatcher, WebSocket: UndiciWS } = require('undici');
  const proxyAgent = new ProxyAgent(proxyUrl);
  setGlobalDispatcher(proxyAgent);
  globalThis.WebSocket = class ProxyWebSocket extends UndiciWS {
    constructor(url, protocols) {
      super(url, { dispatcher: proxyAgent });
    }
  };
}

require('./bundle.cjs');
