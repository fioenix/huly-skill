// One-off repair for issues whose `rank` was written by the pre-1.10.4
// makeRank. That version incremented the last character of the previous rank by
// one ASCII code point, so ranks drifted out of LexoRank's base-36 alphabet
// (`0|i005ef;`, `0|i005ef<`, … `0|i005efT`). The Huly UI cannot parse those and
// refuses to create any further issue in the project.
//
// Repair strategy: rewrite only the offending characters, keeping each rank in
// the byte-order slot it already occupies. Ranks sort as plain strings in the
// database, and the junk characters all sit between '9' and 'a' in ASCII, so a
// broken rank `<base><junk>` is replaced by `<base>z<counter>` — still greater
// than `<base>:`, still smaller than the next sibling `<base+1>:`, and inside
// the base-36 alphabet. LexoRank arithmetic is deliberately not used here: this
// data also holds ranks whose numeric LexoRank value disagrees with their byte
// position, and interpolating between those crosses the neighbours over.
//
// It reports by default and only rewrites with APPLY=1. pnpm's strict node_modules
// hides the transitive @hcengineering packages from tsx, so bundle it first:
//
//   npx esbuild scripts/fix-ranks.ts --bundle --platform=node --target=node20 \
//     --format=cjs --outfile=/tmp/fix-ranks.cjs \
//     --define:import.meta.url='"file:///bundle"' --define:__HULY_VERSION__='"dev"'
//   RANK_REPORT=/tmp/ranks.txt node /tmp/fix-ranks.cjs          # report
//   APPLY=1 RANK_REPORT=/tmp/ranks.txt node /tmp/fix-ranks.cjs  # rewrite
import '../src/bootstrap.js';
import { loadEnvFile } from '../src/env.js';
import { withClient } from '../src/client.js';
import { tracker } from '../src/huly-types.js';
import * as rankModule from '@hcengineering/rank';
import { writeFileSync } from 'node:fs';

// The only criterion that matters: can the UI's LexoRank parse it?
const platformMakeRank = (((rankModule as any).default ?? rankModule) as any).makeRank;
const parses = (rank: unknown): boolean => {
    if (typeof rank !== 'string' || rank === '') return false;
    try { platformMakeRank(rank, undefined); return true; } catch { return false; }
};

const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';
const isBase36 = (ch: string) => BASE36.includes(ch);

/** `0|i005efT` → `0|i005ef`: everything up to the first character LexoRank rejects. */
function baseOf(rank: string): string | null {
    const bar = rank.indexOf('|');
    if (bar !== 1 || !isBase36(rank[0])) return null;
    let end = bar + 1;
    while (end < rank.length && isBase36(rank[end])) end++;
    const base = rank.slice(0, end);
    return end > bar + 1 && parses(base) ? base : null;
}

const byteAsc = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Shortest base-36 string that byte-sorts strictly after `lo` and, when given,
 * strictly before `hi`. Appending is what makes room: `lo + c` always beats
 * `lo`, and when every single character overshoots `hi` the search goes one
 * level deeper on `lo + '0'`, which cannot.
 */
function betweenBytes(lo: string, hi: string | undefined, taken: Set<string>): string {
    // Bump the last character first, so a run of repairs reads `:0`, `:1`, `:2`
    // instead of growing one character longer each time.
    const lastIdx = BASE36.indexOf(lo[lo.length - 1]);
    if (lastIdx >= 0) {
        for (let k = lastIdx + 1; k < BASE36.length; k++) {
            const candidate = lo.slice(0, -1) + BASE36[k];
            if ((hi === undefined || candidate < hi) && !taken.has(candidate)) return candidate;
        }
    }
    for (let stem = lo; stem.length < lo.length + 12; stem += '0') {
        for (const ch of BASE36) {
            const candidate = stem + ch;
            if (candidate > lo && (hi === undefined || candidate < hi) && !taken.has(candidate)) return candidate;
        }
    }
    throw new Error(`no room between ${lo} and ${hi}`);
}

// The platform client fires background fetches (account, analytics) that reject
// on a flaky connection; an unhandled rejection would kill the run mid-repair.
process.on('unhandledRejection', (reason) => {
    say(`  ~~ ignored background rejection: ${String((reason as any)?.message ?? reason)}`);
});

const apply = process.env.APPLY === '1';
const out: string[] = [];
const report = () => { if (process.env.RANK_REPORT) writeFileSync(process.env.RANK_REPORT, out.join('\n')); };
const say = (m: string) => { out.push(m); report(); };

async function main() {
loadEnvFile();
await withClient(async (c) => {
    const raw = c.getRawClient() as any;
    const projects = await raw.findAll(tracker.class.Project, {});
    // One round trip: a query per project made this take minutes.
    const allIssues: any[] = await raw.findAll(tracker.class.Issue, {});
    const bySpace = new Map<string, any[]>();
    for (const i of allIssues) {
        const list = bySpace.get(i.space) ?? [];
        list.push(i);
        bySpace.set(i.space, list);
    }
    let fixed = 0;
    let skipped = 0;
    let missing = 0;

    for (const project of projects) {
        const issues: any[] = bySpace.get(project._id) ?? [];
        const broken = issues
            .filter((i) => typeof i.rank === 'string' && i.rank !== '' && !parses(i.rank))
            .sort((a, b) => byteAsc(a.rank, b.rank));
        const noRank = issues.filter((i) => typeof i.rank !== 'string' || i.rank === '');
        missing += noRank.length;
        if (broken.length === 0) continue;

        const taken = new Set<string>(issues.map((i) => i.rank).filter((r) => typeof r === 'string'));
        // Only parseable ranks define the slots: the broken ones are what moves.
        const anchors = issues
            .map((i) => i.rank)
            .filter((r): r is string => typeof r === 'string' && r !== '' && parses(r))
            .sort(byteAsc);
        const assigned: Array<{ old: string; rank: string }> = [];

        say(`\n${project.identifier}: ${broken.length} broken of ${issues.length}` +
            (noRank.length > 0 ? ` (+${noRank.length} with no rank, left alone)` : ''));

        let carry: { old: string; rank: string } | null = null;
        for (const issue of broken) {
            const base = baseOf(issue.rank);
            if (base === null) { say(`  SKIP ${issue.identifier} ${JSON.stringify(issue.rank)} — no parseable prefix`); skipped++; continue; }

            // The slot the old rank sits in today, bounded by real neighbours.
            const before = [...anchors].reverse().find((r) => r < issue.rank);
            const after = anchors.find((r) => r > issue.rank);
            let lo = before !== undefined && before > base ? before : base;
            // Consecutive broken ranks in the same slot keep their order.
            if (carry !== null && carry.rank > lo && (after === undefined || carry.rank < after)) lo = carry.rank;

            const rank = betweenBytes(lo, after, taken);
            taken.add(rank);
            assigned.push({ old: issue.rank, rank });
            carry = { old: issue.rank, rank };
            say(`  ${issue.identifier}  ${JSON.stringify(issue.rank)} -> ${rank}`);
            // Same call the skill's own updateTask uses for issue attributes.
            if (apply) await raw.updateDoc(tracker.class.Issue, issue.space, issue._id, { rank });
            fixed++;
        }

        // Each rewrite must land in the same slot the old rank held: strictly
        // between the neighbouring ranks the project already uses.
        for (const { old, rank } of assigned) {
            if (!parses(rank)) say(`  !! unparseable result: ${rank}`);
            const before = [...anchors].reverse().find((r) => r < old);
            const after = anchors.find((r) => r > old);
            if (before !== undefined && rank <= before) say(`  !! ${rank} does not stay after ${before} (was ${old})`);
            if (after !== undefined && rank >= after) say(`  !! ${rank} does not stay before ${after} (was ${old})`);
        }
        for (let k = 1; k < assigned.length; k++) {
            if (assigned[k].rank <= assigned[k - 1].rank) say(`  !! order lost: ${assigned[k - 1].rank} then ${assigned[k].rank}`);
        }
    }
    say(`\n${apply ? 'rewrote' : 'would rewrite'} ${fixed} ranks; skipped ${skipped}; ${missing} issues have no rank at all (untouched)`);
});
}
main().then(
    () => { report(); process.exit(0); },
    (err) => { say(`\nABORTED: ${err?.message ?? err}`); report(); process.exit(1); },
);
