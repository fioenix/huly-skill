import { HttpsProxyAgent } from 'https-proxy-agent';

/**
 * Proxy support for the Huly WebSocket. Certificate checks stay on: a proxy
 * that intercepts TLS (the Cowork sandbox, a corporate gateway) is trusted by
 * giving Node its CA with NODE_EXTRA_CA_CERTS, not by turning verification off.
 */

/** Scheme and host of a URL, for diagnostics: never its credentials, path or query. */
export function redactUrl(raw: string): string {
    try {
        const url = new URL(raw);
        return `${url.protocol}//${url.host}`;
    } catch {
        return '<unparseable url>';
    }
}

export function proxyAgent(proxyUrl: string): HttpsProxyAgent<string> {
    return new HttpsProxyAgent(proxyUrl);
}

/** Options for undici's ProxyAgent, which `fetch` uses behind HTTPS_PROXY. */
export function fetchProxyOptions(proxyUrl: string): { uri: string } {
    return { uri: proxyUrl };
}

export function wsOptions(agent: HttpsProxyAgent<string>): { agent: HttpsProxyAgent<string> } {
    return { agent };
}

/**
 * Proxy-aware WebSocket factory, used in place of NodeWebSocketFactory when
 * HTTPS_PROXY is set. Returns undefined when no proxy is configured. `WebSocket`
 * is the `ws` constructor, passed in because `ws` is not a direct dependency.
 */
export function createProxySocketFactory(proxyUrl: string | undefined, WebSocket: any) {
    if (!proxyUrl) return undefined;
    const agent = proxyAgent(proxyUrl);

    return (url: string) => {
        // The Huly WebSocket URL carries the account JWT in its path.
        process.stderr.write(`[huly-ws] connecting: ${redactUrl(url)} via proxy ${redactUrl(proxyUrl)}\n`);
        const ws = new WebSocket(url, wsOptions(agent));
        const client: any = {
            get readyState() { return ws.readyState; },
            send(data: any) {
                if (data instanceof Blob) {
                    void data.arrayBuffer().then((buffer: ArrayBuffer) => ws.send(buffer));
                } else {
                    ws.send(data);
                }
            },
            close(code?: number) { ws.close(code); },
        };
        ws.on('message', (data: any) => {
            // As upstream NodeWebSocketFactory does: Huly recognises its
            // `ping`/`pong!` heartbeats only as strings or ArrayBuffers.
            const eventData = data instanceof Buffer ? new Uint8Array(data).buffer : data;
            client.onmessage?.({ data: eventData, type: 'message', target: undefined });
        });
        ws.on('close', (code: number, reason: Buffer) => {
            process.stderr.write(`[huly-ws] closed: code=${code} reason=${reason}\n`);
            client.onclose?.({ code, reason, wasClean: code === 1000, type: 'close', target: undefined });
        });
        ws.on('open', () => {
            process.stderr.write(`[huly-ws] connected!\n`);
            client.onopen?.({ type: 'open', target: undefined });
        });
        ws.on('error', (error: any) => {
            process.stderr.write(`[huly-ws] error: ${error.message || error}\n`);
            client.onerror?.({ type: 'error', target: undefined, error });
        });
        ws.on('unexpected-response', (_req: any, res: any) => {
            process.stderr.write(`[huly-ws] unexpected-response: status=${res.statusCode}\n`);
        });
        return client;
    };
}
