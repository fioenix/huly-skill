/**
 * Machine-readable error classification.
 *
 * Every JSON error this project emits carries `{ status: 'error', error }`, where
 * `error` is a human sentence — often Vietnamese. An agent reading that has to
 * guess from prose whether a call is worth retrying, and guessing wrong is
 * expensive in both directions: retrying a `not_found` burns turns, giving up on
 * a dropped WebSocket loses work that would have succeeded. `code` and
 * `retryable` answer that question without parsing the sentence.
 *
 * The message stays exactly as it was; this only adds fields beside it.
 */

export type ErrorCode =
    /** A configured credential is missing, expired, or bound elsewhere. */
    | 'auth'
    /** The connection to Huly failed or dropped — the one class worth retrying. */
    | 'connection'
    /** An id, name or identifier did not resolve to anything. */
    | 'not_found'
    /** The arguments were rejected before Huly saw them. */
    | 'invalid_input'
    /** Unclassified. Treated as not retryable, because guessing costs turns. */
    | 'unknown';

export type ErrorPayload = {
    status: 'error';
    error: string;
    code: ErrorCode;
    retryable: boolean;
    hint?: string;
};

/** Only a broken connection is worth another attempt with identical arguments. */
const RETRYABLE: ReadonlySet<ErrorCode> = new Set<ErrorCode>(['connection']);

const HINTS: Partial<Record<ErrorCode, string>> = {
    auth: 'Run huly whoami --offline (CLI) or huly_context (MCP) to see which credential is in scope.',
    connection: 'Transient — the same call may succeed on retry.',
};

/**
 * Ordered because the first match wins: a message may well mention both a
 * missing token and a failed connection, and the credential is the actionable
 * half. Patterns cover both languages this project speaks.
 */
const PATTERNS: [ErrorCode, RegExp][] = [
    ['auth', /HULY_(HOST|WORKSPACE_ID|API_KEY)|unauthori[sz]ed|forbidden|\b401\b|\b403\b|invalid token|token (expired|invalid)|xac minh tai khoan/i],
    ['connection', /ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|EPIPE|socket|websocket|network|fetch failed|timed? ?out|not connected|connection closed/i],
    ['not_found', /not found|khong tim thay|khong ton tai/i],
    ['invalid_input', /invalid|unrecognized|unrecognised|required|khong hop le|chi chap nhan|not confirmed/i],
];

/**
 * Process exit status per error class, for shell callers that branch on `$?`
 * rather than parsing JSON. 1 stays "something failed" so existing scripts that
 * only test for nonzero keep working.
 */
export const EXIT_STATUS: Record<ErrorCode, number> = {
    unknown: 1,
    auth: 2,
    not_found: 3,
    invalid_input: 4,
    connection: 5,
};

export function exitStatusFor(e: unknown): number {
    return EXIT_STATUS[classifyError(e)];
}

/** Error carrying an explicit code, for cases the caller already knows. */
export function hulyError(code: ErrorCode, message: string): Error & { code: ErrorCode } {
    return Object.assign(new Error(message), { code });
}

export function classifyError(e: unknown): ErrorCode {
    const explicit = (e as { code?: unknown })?.code;
    if (typeof explicit === 'string' && ['auth', 'connection', 'not_found', 'invalid_input', 'unknown'].includes(explicit)) {
        return explicit as ErrorCode;
    }
    // A wrapped error keeps the useful text in `cause`; Node's network errors put
    // the code there too (`fetch failed` alone says nothing).
    const text = [messageOf(e), typeof explicit === 'string' ? explicit : '', messageOf((e as { cause?: unknown })?.cause)]
        .filter(Boolean)
        .join(' ');
    for (const [code, pattern] of PATTERNS) {
        if (pattern.test(text)) return code;
    }
    return 'unknown';
}

/** The JSON envelope for a failure, identical across the CLI and MCP. */
export function errorPayload(e: unknown): ErrorPayload {
    const code = classifyError(e);
    const hint = HINTS[code];
    return {
        status: 'error',
        error: messageOf(e) || String(e),
        code,
        retryable: RETRYABLE.has(code),
        ...(hint ? { hint } : {}),
    };
}

function messageOf(e: unknown): string {
    if (!e) return '';
    if (typeof e === 'string') return e;
    const message = (e as { message?: unknown }).message;
    return typeof message === 'string' ? message : '';
}
