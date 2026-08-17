const MAX_OUTPUT_LENGTH = 2500;

let jsonMode = false;

export function setJsonMode(enabled: boolean) {
    jsonMode = enabled;
}

export function isJsonMode(): boolean {
    return jsonMode;
}

export const PRIORITY_LABELS: Record<number, string> = {
    0: 'KHONG UU TIEN',
    1: 'THAP',
    2: 'TRUNG BINH',
    3: 'CAO',
    4: 'KHAN CAP'
};

export function formatDate(timestamp: number | undefined | null, includeTime = false): string {
    if (!timestamp) return 'N/A';
    const date = new Date(timestamp);

    if (includeTime) {
        return date.toLocaleDateString('vi-VN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }
    return date.toLocaleDateString('vi-VN');
}

// bootstrap.ts sends console.log to stderr to keep the Huly client's chatter
// off stdout, so this project's own output writes to stdout directly.
function writeStdout(text: string) {
    process.stdout.write(text + '\n');
}

export function outputJson(data: any) {
    writeStdout(JSON.stringify(data, null, 2));
}

export function printToConsole(text: string) {
    if (text.length <= MAX_OUTPUT_LENGTH) {
        writeStdout(text);
        return;
    }

    let currentBlock = '';
    const lines = text.split('\n');

    for (const line of lines) {
        if (currentBlock.length + line.length + 1 > MAX_OUTPUT_LENGTH) {
            writeStdout(currentBlock);
            currentBlock = line + '\n';
        } else {
            currentBlock += line + '\n';
        }
    }

    if (currentBlock.length > 0) {
        writeStdout(currentBlock);
    }
}
