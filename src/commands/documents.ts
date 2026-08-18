import { Command } from 'commander';
import { withClient } from '../client.js';
import { printToConsole, isJsonMode, outputJson } from '../utils/logger.js';
import { errorPayload, exitStatusFor, hulyError } from '../utils/errors.js';

export function documentsCommand() {
    const cmd = new Command('docs')
        .description('Manage documents and teamspaces');

    cmd.command('teamspaces')
        .description('List all teamspaces')
        .action(async () => {
            try {
                await withClient(async (client) => {
                    const teamspaces = await client.getTeamspaces();

                    if (isJsonMode()) {
                        outputJson({ status: 'ok', count: teamspaces.length, data: teamspaces });
                        return;
                    }

                    if (teamspaces.length === 0) {
                        printToConsole('No teamspaces.');
                        return;
                    }

                    let output = `TEAMSPACES (${teamspaces.length})\n`;
                    output += '='.repeat(50) + '\n';
                    for (const ts of teamspaces) {
                        output += `  ${ts.name}\n`;
                        output += `    ID: ${ts._id}\n`;
                        if (ts.description) output += `    Description: ${ts.description}\n`;
                    }
                    printToConsole(output);
                });
            } catch (e: any) {
                if (isJsonMode()) outputJson(errorPayload(e));
                else console.error(`Error: ${e.message}`);
                process.exitCode = exitStatusFor(e);
            }
        });

    cmd.command('list')
        .description('List documents in a teamspace')
        .argument('<teamspace>', 'Teamspace name or ID')
        .action(async (teamspaceInput) => {
            try {
                await withClient(async (client) => {
                    const teamspaces = await client.getTeamspaces();
                    const ts = teamspaces.find((t: any) =>
                        t.name === teamspaceInput || t._id === teamspaceInput
                    );
                    if (!ts) {
                        const e = hulyError('not_found', `Teamspace not found: ${teamspaceInput}`);
                        if (isJsonMode()) outputJson(errorPayload(e)); else console.error(e.message);
                        process.exitCode = exitStatusFor(e);
                        return;
                    }

                    const docs = await client.getDocuments(ts._id);

                    if (isJsonMode()) {
                        outputJson({ status: 'ok', teamspace: ts.name, count: docs.length, data: docs });
                        return;
                    }

                    if (docs.length === 0) {
                        printToConsole(`Teamspace "${ts.name}" has no documents.`);
                        return;
                    }

                    let output = `TAI LIEU trong "${ts.name}" (${docs.length})\n`;
                    output += '='.repeat(50) + '\n';
                    for (const doc of docs) {
                        output += `  ${doc.title || '(untitled)'}\n`;
                        output += `    ID: ${doc._id}\n`;
                    }
                    printToConsole(output);
                });
            } catch (e: any) {
                if (isJsonMode()) outputJson(errorPayload(e));
                else console.error(`Error: ${e.message}`);
                process.exitCode = exitStatusFor(e);
            }
        });

    cmd.command('create')
        .description('Create a new document')
        .argument('<title>', 'Document title')
        .requiredOption('-t, --teamspace <teamspace>', 'Teamspace name or ID')
        .option('-c, --content <content>', 'Markdown content', '')
        .option('-f, --file <file>', 'Read content from a markdown file')
        .action(async (title, options) => {
            try {
                await withClient(async (client) => {
                    const teamspaces = await client.getTeamspaces();
                    const ts = teamspaces.find((t: any) =>
                        t.name === options.teamspace || t._id === options.teamspace
                    );
                    if (!ts) {
                        const e = hulyError('not_found', `Teamspace not found: ${options.teamspace}`);
                        if (isJsonMode()) outputJson(errorPayload(e)); else console.error(e.message);
                        process.exitCode = exitStatusFor(e);
                        return;
                    }

                    let content = options.content;
                    if (options.file) {
                        const { safeReadFile } = await import('../resolvers.js');
                        content = safeReadFile(options.file);
                    }

                    const doc = await client.createDocument(ts._id, title, content || '');

                    if (isJsonMode()) {
                        outputJson({ status: 'ok', data: doc });
                    } else {
                        printToConsole(`Created document: "${doc.title}" in teamspace "${ts.name}"\n  ID: ${doc._id}`);
                    }
                });
            } catch (e: any) {
                if (isJsonMode()) outputJson(errorPayload(e));
                else console.error(`Could not create the document: ${e.message}`);
                process.exitCode = exitStatusFor(e);
            }
        });

    cmd.command('create-teamspace')
        .description('Create a new teamspace')
        .argument('<name>', 'Teamspace name')
        .option('-d, --description <desc>', 'Teamspace description', '')
        .option('--private', 'Make teamspace private')
        .action(async (name, options) => {
            try {
                await withClient(async (client) => {
                    const ts = await client.createTeamspace(name, options.description, options.private);

                    if (isJsonMode()) {
                        outputJson({ status: 'ok', data: ts });
                    } else {
                        printToConsole(`Created teamspace: "${ts.name}"\n  ID: ${ts._id}`);
                    }
                });
            } catch (e: any) {
                if (isJsonMode()) outputJson(errorPayload(e));
                else console.error(`Could not create the teamspace: ${e.message}`);
                process.exitCode = exitStatusFor(e);
            }
        });

    cmd.command('read')
        .description('Read document content as markdown')
        .argument('<teamspace>', 'Teamspace name or ID')
        .argument('<title>', 'Document title (partial match)')
        .action(async (teamspaceInput, titleInput) => {
            try {
                await withClient(async (client) => {
                    const teamspaces = await client.getTeamspaces();
                    const ts = teamspaces.find((t: any) =>
                        t.name === teamspaceInput || t._id === teamspaceInput
                    );
                    if (!ts) {
                        const e = hulyError('not_found', `Teamspace not found: ${teamspaceInput}`);
                        if (isJsonMode()) outputJson(errorPayload(e)); else console.error(e.message);
                        process.exitCode = exitStatusFor(e);
                        return;
                    }

                    const docs = await client.getDocuments(ts._id);
                    const titleLower = titleInput.toLowerCase();
                    const doc = docs.find((d: any) =>
                        d.title?.toLowerCase().includes(titleLower) || d._id === titleInput
                    );
                    if (!doc) {
                        const e = hulyError('not_found', `Document not found: "${titleInput}"`);
                        if (isJsonMode()) outputJson(errorPayload(e)); else console.error(e.message);
                        process.exitCode = exitStatusFor(e);
                        return;
                    }

                    const content = await client.getDocumentContent(doc);

                    if (isJsonMode()) {
                        outputJson({ status: 'ok', data: { ...doc, markdownContent: content } });
                    } else {
                        let output = `TAI LIEU: ${doc.title}\n`;
                        output += '='.repeat(50) + '\n\n';
                        output += content || '(no content)';
                        printToConsole(output);
                    }
                });
            } catch (e: any) {
                if (isJsonMode()) outputJson(errorPayload(e));
                else console.error(`Error: ${e.message}`);
                process.exitCode = exitStatusFor(e);
            }
        });

    return cmd;
}
