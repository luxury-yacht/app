/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Yaml/yamlDiff.test.ts
 *
 * Test suite for yamlDiff.
 * Covers key behaviors and edge cases for yamlDiff.
 */

import { describe, it, expect } from 'vitest';

import { computeLineDiff } from './yamlDiff';

describe('yamlDiff', () => {
  it('produces context, added, and removed lines', () => {
    const before = ['apiVersion: v1', 'kind: Pod', 'metadata:', '  name: demo'].join('\n');
    const after = ['apiVersion: v1', 'kind: Deployment', 'metadata:', '  name: demo'].join('\n');

    const result = computeLineDiff(before, after);
    expect(result.truncated).toBe(false);
    expect(result.lines.some((line) => line.type === 'removed' && line.value === 'kind: Pod')).toBe(
      true
    );
    expect(
      result.lines.some((line) => line.type === 'added' && line.value === 'kind: Deployment')
    ).toBe(true);
    expect(result.lines[0]).toMatchObject({
      type: 'context',
      value: 'apiVersion: v1',
    });
  });

  it('marks the diff as truncated when exceeding the line threshold', () => {
    const before = new Array(2001).fill('before').join('\n');
    const after = new Array(2000).fill('after').join('\n');
    const result = computeLineDiff(before, after);
    expect(result.truncated).toBe(true);
    expect(result.lines).toHaveLength(0);
  });
});
