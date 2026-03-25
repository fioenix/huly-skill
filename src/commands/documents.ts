import { Command } from 'commander';
import { withClient } from '../client.js';
import { printToConsole, isJsonMode, outputJson } from '../utils/logger.js';

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
                        printToConsole('Khong co teamspace nao.');
                        return;
                    }

                    let output = `TEAMSPACES (${teamspaces.length})\n`;
                    output += '='.repeat(50) + '\n';
                    for (const ts of teamspaces) {
                        output += `  ${ts.name}\n`;
                        output += `    ID: ${ts._id}\n`;
                        if (ts.description) output += `    Mo ta: ${ts.description}\n`;
                    }
                    printToConsole(output);
                });
            } catch (e: any) {
                if (isJsonMode()) outputJson({ status: 'error', error: e.message });
                else console.error(`Loi: ${e.message}`);
                process.exitCode = 1;
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
                        console.error(`Khong tim thay teamspace: ${teamspaceInput}`);
                        process.exitCode = 1;
                        return;
                    }

                    const docs = await client.getDocuments(ts._id);

                    if (isJsonMode()) {
                        outputJson({ status: 'ok', teamspace: ts.name, count: docs.length, data: docs });
                        return;
                    }

                    if (docs.length === 0) {
                        printToConsole(`Teamspace "${ts.name}" khong co tai lieu nao.`);
                        return;
                    }

                    let output = `TAI LIEU trong "${ts.name}" (${docs.length})\n`;
                    output += '='.repeat(50) + '\n';
                    for (const doc of docs) {
                        output += `  ${doc.title || '(Khong co tieu de)'}\n`;
                        output += `    ID: ${doc._id}\n`;
                    }
                    printToConsole(output);
                });
            } catch (e: any) {
                if (isJsonMode()) outputJson({ status: 'error', error: e.message });
                else console.error(`Loi: ${e.message}`);
                process.exitCode = 1;
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
                        console.error(`Khong tim thay teamspace: ${options.teamspace}`);
                        process.exitCode = 1;
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
                        printToConsole(`Da tao tai lieu: "${doc.title}" trong teamspace "${ts.name}"\n  ID: ${doc._id}`);
                    }
                });
            } catch (e: any) {
                if (isJsonMode()) outputJson({ status: 'error', error: e.message });
                else console.error(`Loi khi tao tai lieu: ${e.message}`);
                process.exitCode = 1;
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
                        printToConsole(`Da tao teamspace: "${ts.name}"\n  ID: ${ts._id}`);
                    }
                });
            } catch (e: any) {
                if (isJsonMode()) outputJson({ status: 'error', error: e.message });
                else console.error(`Loi khi tao teamspace: ${e.message}`);
                process.exitCode = 1;
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
                        console.error(`Khong tim thay teamspace: ${teamspaceInput}`);
                        process.exitCode = 1;
                        return;
                    }

                    const docs = await client.getDocuments(ts._id);
                    const titleLower = titleInput.toLowerCase();
                    const doc = docs.find((d: any) =>
                        d.title?.toLowerCase().includes(titleLower) || d._id === titleInput
                    );
                    if (!doc) {
                        console.error(`Khong tim thay tai lieu: "${titleInput}"`);
                        process.exitCode = 1;
                        return;
                    }

                    const content = await client.getDocumentContent(doc);

                    if (isJsonMode()) {
                        outputJson({ status: 'ok', data: { ...doc, markdownContent: content } });
                    } else {
                        let output = `TAI LIEU: ${doc.title}\n`;
                        output += '='.repeat(50) + '\n\n';
                        output += content || '(Khong co noi dung)';
                        printToConsole(output);
                    }
                });
            } catch (e: any) {
                if (isJsonMode()) outputJson({ status: 'error', error: e.message });
                else console.error(`Loi: ${e.message}`);
                process.exitCode = 1;
            }
        });

    return cmd;
}
