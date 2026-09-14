/**
 * Sanity check for editorBoard helpers (no live Chrome required).
 * Run: node src/editorBoard.check.js
 */
import assert from 'node:assert/strict';
import { DEFAULT_CDP, TIP_CDP, TIP_PAIR, withBoard } from './editorBoard.js';

assert.ok(DEFAULT_CDP.includes('9222'));
assert.ok(TIP_CDP.includes('remote-debugging-port'));
assert.ok(TIP_PAIR.includes('Allow agent'));

const bad = await withBoard('', async () => ({ ok: true }));
assert.equal(bad.ok, false);
assert.equal(bad.error, 'bad_pair_code');

console.log('editorBoard.check: ok');
