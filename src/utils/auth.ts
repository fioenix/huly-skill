export function getHost(): string {
  const host = process.env.HULY_HOST;
  if (!host) {
    throw new Error('❌ HULY_HOST environment variable is not set.');
  }
  return host;
}

export function getWorkspaceId(): string {
  const workspaceId = process.env.HULY_WORKSPACE_ID;
  if (!workspaceId) {
    throw new Error('❌ HULY_WORKSPACE_ID environment variable is not set.');
  }
  return workspaceId;
}

export function getApiKey(): string {
  const token = process.env.HULY_API_KEY;
  if (!token) {
    throw new Error('❌ HULY_API_KEY environment variable is not set.');
  }
  return token;
}

/**
 * Utility to safely mask an API key for logging
 */
export function maskToken(token: string): string {
  if (!token) return '';
  if (token.length <= 8) return '****';
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}
