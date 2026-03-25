export function getHost(): string {
    const host = process.env.HULY_HOST;
    if (!host) {
        throw new Error(
            'HULY_HOST chua duoc cau hinh.\n' +
            '  → VD: export HULY_HOST="https://huly.io"'
        );
    }
    return host;
}

export function getWorkspaceId(): string {
    const workspaceId = process.env.HULY_WORKSPACE_ID;
    if (!workspaceId) {
        throw new Error(
            'HULY_WORKSPACE_ID chua duoc cau hinh.\n' +
            '  → Tim workspace ID trong Huly Settings > Workspace.\n' +
            '  → Nap bang: export HULY_WORKSPACE_ID="your-workspace-id"'
        );
    }
    return workspaceId;
}

export function getApiKey(): string {
    const token = process.env.HULY_API_KEY;
    if (!token) {
        throw new Error(
            'HULY_API_KEY chua duoc cau hinh.\n' +
            '  → Tao API key tai: Huly Settings > API Tokens.\n' +
            '  → Nap bang: export HULY_API_KEY="your-api-key"'
        );
    }
    return token;
}

export function maskToken(token: string): string {
    if (!token) return '';
    if (token.length <= 8) return '****';
    return `${token.slice(0, 4)}...${token.slice(-4)}`;
}
