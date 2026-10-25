import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// Resolve through the production Huly dependency context, not a root-level
// transitive alias which could select a different core version.
const require = createRequire(import.meta.url);
const apiEntry = require.resolve('@hcengineering/api-client');
const textEntry = createRequire(apiEntry).resolve('@hcengineering/text');
const { mergeAttributes } = createRequire(textEntry)('@tiptap/core');

test('JSON-owned __proto__ stays data and cannot change a merged attribute prototype', () => {
    for (const json of [
        '{"__proto__":{"syntheticCanary":"inherited"}}',
        '{"__proto__":null}',
        '{"__proto__":"literal"}',
    ]) {
        const payload = JSON.parse(json);
        for (const sources of [
            [payload], [payload, { id: 'retained' }],
            [{ id: 'retained' }, payload], [{ id: 'first' }, payload, { id: 'last' }],
        ]) {
            const merged = mergeAttributes(...sources);
            for (const value of [merged, mergeAttributes(merged)]) {
                assert.equal(Object.getPrototypeOf(value), Object.prototype);
                assert.equal(value.syntheticCanary, undefined);
                assert.equal(({} as any).syntheticCanary, undefined);
                const descriptor = Object.getOwnPropertyDescriptor(value, '__proto__');
                assert.ok(descriptor, 'the JSON key is preserved as an own data property');
                assert.equal(descriptor.value, payload.__proto__);
                assert.equal(descriptor.enumerable, true);
                assert.equal(descriptor.configurable, true);
                assert.equal(descriptor.writable, true);
            }
        }
    }
});

test('patched attribute merging preserves ordinary classes styles and scalar overwrites', () => {
    const merged = mergeAttributes(
        { class: 'a', style: 'color:red; font-size:12px', id: 'first' },
        { class: 'a b', style: 'color:blue', id: 'second' },
    );
    assert.deepEqual(merged, {
        class: 'a b', style: 'color: blue; font-size: 12px', id: 'second',
    });
});
