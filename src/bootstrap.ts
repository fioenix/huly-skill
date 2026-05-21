// Runtime bootstrap — MUST be imported before any module that touches the
// network or @hcengineering/api-client. Both the CLI and the MCP adapters
// import this first so the proxy + browser-API polyfills are in place.

// Proxy support — must run before any network calls.
import { ProxyAgent, setGlobalDispatcher, fetch as undiciFetch } from 'undici';

const _proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
if (_proxyUrl) {
    // Proxy environments (e.g. the Cowork sandbox) use TLS interception —
    // disable certificate verification only while a proxy is active.
    if (!process.env.NODE_TLS_REJECT_UNAUTHORIZED) {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }

    const _agent = new ProxyAgent(_proxyUrl);
    setGlobalDispatcher(_agent);
    // Node's built-in fetch uses its own internal undici instance which
    // setGlobalDispatcher may not reach — monkey-patch globalThis.fetch too.
    (globalThis as any).fetch = (url: any, opts: any = {}) => {
        return undiciFetch(url, { ...opts, dispatcher: _agent });
    };
}

import 'fake-indexeddb/auto';

// Polyfill minimal browser APIs that @hcengineering/api-client and
// client-resources expect to find on the global scope.
const globalAny = global as any;
if (typeof globalAny.window === 'undefined') {
    globalAny.window = global;

    globalAny.window.addEventListener = () => { };
    globalAny.window.removeEventListener = () => { };
    globalAny.window.requestAnimationFrame = (cb: any) => setTimeout(cb, 0);
    globalAny.window.cancelAnimationFrame = clearTimeout;

    globalAny.window.localStorage = {
        getItem: () => null,
        setItem: () => { },
        removeItem: () => { },
        clear: () => { }
    };
    globalAny.window.sessionStorage = globalAny.window.localStorage;
    globalAny.window.location = { origin: 'http://localhost' };

    if (typeof globalAny.navigator === 'undefined') {
        globalAny.navigator = { userAgent: 'node' };
    }
}
