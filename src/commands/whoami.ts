import { Command } from 'commander';
import { HulyClient } from '../client.js';
import { printToConsole, isJsonMode, outputJson } from '../utils/logger.js';
import { maskToken } from '../utils/auth.js';

export function whoamiCommand() {
    return new Command('whoami')
        .description('Verify connection and show current account info')
        .action(async () => {
            const client = new HulyClient();
            try {
                await client.connect();

                const account = await client.getAccount();
                const host = process.env.HULY_HOST || '(not set)';
                const workspace = process.env.HULY_WORKSPACE_ID || '(not set)';
                const apiKey = process.env.HULY_API_KEY || '';

                if (isJsonMode()) {
                    outputJson({
                        status: 'ok',
                        data: {
                            host,
                            workspace,
                            apiKeyMasked: maskToken(apiKey),
                            account,
                        }
                    });
                } else {
                    let output = `✅ Ket noi thanh cong!\n\n`;
                    output += `🌐 Host: ${host}\n`;
                    output += `🏢 Workspace: ${workspace}\n`;
                    output += `🔑 API Key: ${maskToken(apiKey)}\n`;
                    output += `👤 Account: ${account.email || account.uuid || 'Unknown'}\n`;
                    if (account.fullSocialIds?.length > 0) {
                        output += `🆔 Person UUID: ${account.fullSocialIds[0].personUuid || 'N/A'}\n`;
                    }
                    printToConsole(output);
                }

            } catch (e: any) {
                if (isJsonMode()) outputJson({ status: 'error', error: e.message });
                else console.error(`❌ Ket noi that bai: ${e.message}`);
                process.exitCode = 1;
            } finally {
                await client.disconnect();
            }
        });
}
