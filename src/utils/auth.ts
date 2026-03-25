const DEFAULT_HOST = 'https://work.yody.io';
const DEFAULT_WORKSPACE_ID = '098f54fd-611a-41f7-b817-b69282fe8d91';

export function getHost(): string {
    return process.env.HULY_HOST || DEFAULT_HOST;
}

export function getWorkspaceId(): string {
    const workspaceId = process.env.HULY_WORKSPACE_ID || DEFAULT_WORKSPACE_ID;
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
