/**
 * Output formatting utilities to provide Vietnamese output and emojis.
 * Also handles character length limits (splits if > 2500 chars).
 */

const MAX_OUTPUT_LENGTH = 2500;

export const PRIORITY_LABELS: Record<number, string> = {
    0: 'KHÔNG ƯU TIÊN',
    1: 'THẤP',
    2: 'TRUNG BÌNH',
    3: 'CAO',
    4: 'KHẨN CẤP'
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

/**
 * Splits output into multiple blocks if it exceeds telegram limit.
 */
export function printToConsole(text: string) {
    if (text.length <= MAX_OUTPUT_LENGTH) {
        console.log(text);
        return;
    }

    let currentBlock = '';
    const lines = text.split('\n');

    for (const line of lines) {
        if (currentBlock.length + line.length > MAX_OUTPUT_LENGTH) {
            console.log(currentBlock);
            currentBlock = line + '\n';
        } else {
            currentBlock += line + '\n';
        }
    }

    if (currentBlock.length > 0) {
        console.log(currentBlock);
    }
}
