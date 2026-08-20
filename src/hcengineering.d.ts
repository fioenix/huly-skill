/**
 * Ambient declarations for the @hcengineering packages.
 *
 * From 0.7.423 these packages ship `lib/*.js` and `src/*.ts` but no `types/`
 * directory, while their package.json still points `"types"` and
 * `exports["."].types` at `types/index.d.ts`. TypeScript therefore resolves the
 * import to plain JavaScript and reports TS7016. `@hcengineering/text` and
 * `text-markdown` are transitive-only, so they never resolve at all (TS2307).
 *
 * Every value from these modules is already consumed through `as any` in
 * client.ts — the CJS interop there cannot be expressed in their real types
 * anyway — so the declarations below cover only what this repo imports. The
 * `Ref<T>` brand is what huly-types.ts relies on to keep its class-reference
 * constants distinguishable from bare strings.
 *
 * Remove this file if upstream starts shipping declarations again.
 */

declare module '@hcengineering/core' {
    export type Ref<T> = string & { __ref: T };
    export interface Doc {
        _id: Ref<Doc>;
    }
    export interface Class<T> extends Doc {}
    export interface Space extends Doc {}
    export interface AttachedDoc extends Doc {}
    const core: any;
    export default core;
}

declare module '@hcengineering/rank' {
    export function makeRank(prev: string | undefined, next: string | undefined): string;
    export function genRanks(count: number): string[];
}

declare module '@hcengineering/api-client' {
    const apiClient: any;
    export default apiClient;
}

declare module '@hcengineering/text' {
    const text: any;
    export default text;
}

declare module '@hcengineering/text-markdown' {
    const textMarkdown: any;
    export default textMarkdown;
}
