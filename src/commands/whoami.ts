import { Command } from 'commander';
import { withClient } from '../client.js';
import { printToConsole, isJsonMode, outputJson } from '../utils/logger.js';
import { maskToken } from '../utils/auth.js';
import { getActor, resolvePerson } from '../resolvers.js';

export function whoamiCommand() {
    return new Command('whoami')
        .description('Verify connection and show current account info')
        .action(async () => {
            try {
                await withClient(async (client) => {
                    const account = await client.getAccount();
                    const host = process.env.HULY_HOST || '(not set)';
                    const workspace = process.env.HULY_WORKSPACE_ID || '(not set)';
                    const apiKey = process.env.HULY_API_KEY || '';

                    // The token's account is not necessarily the caller — resolve
                    // HULY_ACTOR too so a misspelled name shows up here rather
                    // than at the first create.
                    const actor = getActor();
                    let actorName: string | null = null;
                    let actorError: string | null = null;
                    if (actor) {
                        try {
                            actorName = (await resolvePerson(client, actor)).name;
                        } catch (e: any) {
                            actorError = e.message;
                        }
                    }
                    const defaultAssignee = process.env.HULY_DEFAULT_ASSIGNEE?.trim() || null;

                    if (isJsonMode()) {
                        outputJson({
                            status: 'ok',
                            data: {
                                host,
                                workspace,
                                apiKeyMasked: maskToken(apiKey),
                                actor: actor ? { configured: actor, resolved: actorName, error: actorError } : null,
                                defaultAssignee,
                                account,
                            }
                        });
                    } else {
                        let output = `✅ Ket noi thanh cong!\n\n`;
                        output += `🌐 Host: ${host}\n`;
                        output += `🏢 Workspace: ${workspace}\n`;
                        output += `🔑 API Key: ${maskToken(apiKey)}\n`;
                        output += `👤 Account (chu token): ${account.email || account.uuid || 'Unknown'}\n`;
                        if (actor) {
                            output += actorError
                                ? `🙋 HULY_ACTOR: "${actor}" — KHONG resolve duoc: ${actorError}\n`
                                : `🙋 HULY_ACTOR: ${actorName} ("me" tro ve nguoi nay)\n`;
                        } else {
                            output += `🙋 HULY_ACTOR: chua dat ("me" = chu token)\n`;
                        }
                        if (defaultAssignee) output += `📌 Assignee mac dinh: ${defaultAssignee}\n`;
                        if (account.fullSocialIds?.length > 0) {
                            output += `🆔 Person UUID: ${account.fullSocialIds[0].personUuid || 'N/A'}\n`;
                        }
                        printToConsole(output);
                    }
                });
            } catch (e: any) {
                if (isJsonMode()) outputJson({ status: 'error', error: e.message });
                else console.error(`❌ Ket noi that bai: ${e.message}`);
                process.exitCode = 1;
            }
        });
}
