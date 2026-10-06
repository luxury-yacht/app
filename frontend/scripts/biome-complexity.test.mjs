import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// `npm run complexity` checks changed functions against the AGENTS.md cognitive-complexity
// target. Biome's default maximum is 15, so an unconfigured run silently passes scores of
// 13-15; these cases pin the committed threshold at exactly 12.
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

// Each top-level `if` adds exactly one to the cognitive-complexity score.
const functionWithComplexity = (score) => {
  const branches = Array.from(
    { length: score },
    (_, index) => `  if (value === ${index}) {\n    total += ${index};\n  }`
  );
  return `export function score(value: number): number {\n  let total = 0;\n${branches.join('\n')}\n  return total;\n}\n`;
};

const lintComplexity = (source) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'luxury-yacht-biome-complexity-'));
  temporaryDirectories.push(directory);
  const sourcePath = path.join(directory, 'fixture.ts');
  writeFileSync(sourcePath, source);
  return spawnSync(
    path.join(process.cwd(), 'node_modules', '.bin', 'biome'),
    ['lint', '--config-path', path.join(process.cwd(), 'biome.complexity.jsonc'), sourcePath],
    { encoding: 'utf8' }
  );
};

describe('local cognitive-complexity check', () => {
  it('reports a function scoring above 12', () => {
    const result = lintComplexity(functionWithComplexity(13));
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).not.toBe(0);
    expect(output).toContain('lint/complexity/noExcessiveCognitiveComplexity');
    expect(output).toContain('13');
  });

  it('accepts a function scoring exactly 12', () => {
    const result = lintComplexity(functionWithComplexity(12));
    const output = `${result.stdout}${result.stderr}`;

    expect(output).not.toContain('noExcessiveCognitiveComplexity');
    expect(result.status).toBe(0);
  });
});
