// The Edge Functions use a copy of packages/shared/src (Deno needs ".ts" on
// relative imports). This test fails when someone changes the engine and
// forgets to refresh the copy.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../../../scripts/sync-engine.mjs', import.meta.url));

describe('engine copy for Deno', () => {
  it('matches packages/shared/src', () => {
    expect(() => execFileSync(process.execPath, [script, '--check'], { stdio: 'pipe' })).not.toThrow();
  });
});
