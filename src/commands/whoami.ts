import { Command } from 'commander';
import { withClient } from '../client.js';
import { printToConsole, isJsonMode, outputJson } from '../utils/logger.js';
import { maskToken } from '../utils/auth.js';
import { describeContext } from '../utils/context.js';
import { getActor, resolvePerson } from '../resolvers.js';

export function whoamiCommand() {
    return new Command('whoami')
        .description('Verify connection and show current account info')
        .option('--offline', 'Report configuration without connecting to Huly')
        .action(async (options) => {
            try {
                if (options.offline) {
                    const context = describeContext();
                    if (isJsonMode()) {
                        outputJson({ status: 'ok', data: context });
                        return;
                    }
                    let output = `🔍 Cau hinh (khong ket noi)\n\n`;
                    output += `📦 Phien ban: ${context.version}\n`;
                    output += `🌐 Host: ${context.host ?? '(chua dat)'}\n`;
                    output += `🏢 Workspace: ${context.workspace ?? '(chua dat)'}\n`;
                    output += `🔑 API Key: ${context.apiKey.masked || '(chua dat)'}\n`;
                    if (context.apiKey.claims) {
                        output += `   ↳ token thuoc account: ${context.apiKey.claims.account ?? 'N/A'}\n`;
                        output += `   ↳ token gan workspace: ${context.apiKey.claims.workspace ?? '(khong gan)'}\n`;
                        if (context.apiKey.claims.expiresOn) {
                            output += `   ↳ het han: ${context.apiKey.claims.expiresOn}\n`;
                        }
                    }
                    output += `🙋 HULY_ACTOR: ${context.actor ?? '(chua dat)'}\n`;
                    if (context.defaultAssignee) output += `📌 Assignee mac dinh: ${context.defaultAssignee}\n`;
                    if (context.proxy) output += `🛡️  Proxy: dang bat\n`;
                    for (const warning of context.warnings) output += `\n⚠️  ${warning}`;
                    printToConsole(output);
                    return;
                }

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
                    let actorIsTokenOwner: boolean | null = null;
                    if (actor) {
                        try {
                            const resolved = await resolvePerson(client, actor);
                            actorName = resolved.name;
                            // Huly records the token owner as author no matter what
                            // HULY_ACTOR says, so a mismatch means every write is
                            // attributed to someone else. Say so here.
                            const tokenPersonUuid = account.fullSocialIds?.[0]?.personUuid ?? account.uuid;
                            const persons = await client.getPersons();
                            const tokenPerson = persons.find((p: any) => p.personUuid === tokenPersonUuid);
                            actorIsTokenOwner = tokenPerson ? resolved._id === tokenPerson._id : null;
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
                                actor: actor
                                    ? { configured: actor, resolved: actorName, isTokenOwner: actorIsTokenOwner, error: actorError }
                                    : null,
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
                            if (actorIsTokenOwner === false) {
                                output += `⚠️  HULY_ACTOR khac chu token: Huly van ghi tac gia la chu token, `;
                                output += `${actorName} chi xuat hien o dong "Requested by".\n`;
                            }
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
