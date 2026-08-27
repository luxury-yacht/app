import { describe, expect, it } from 'vitest';
import { getNextClusterTabSelectionAfterClose, mergeClusterTabOrder } from './clusterTabOrder';

describe('clusterTabOrder', () => {
  it('covers clusterTabOrder scenarios', async () => {
    // Scenario: merges persisted tab order with newly opened selections
    expect(mergeClusterTabOrder(['a', 'b', 'c'], ['b'])).toEqual(['b', 'a', 'c']);
    // Scenario: activates the right-adjacent cluster after closing the active tab
    expect(getNextClusterTabSelectionAfterClose(['a', 'b', 'c'], 'b', 'b')).toBe('c');
    // Scenario: falls back to the left-adjacent cluster when closing the last active tab
    expect(getNextClusterTabSelectionAfterClose(['a', 'b', 'c'], 'c', 'c')).toBe('b');
    // Scenario: uses persisted visual order when choosing the adjacent cluster
    expect(getNextClusterTabSelectionAfterClose(['a', 'b', 'c'], 'b', 'b', ['c', 'b', 'a'])).toBe(
      'a'
    );
    // Scenario: keeps the current active cluster when closing an inactive tab
    expect(getNextClusterTabSelectionAfterClose(['a', 'b', 'c'], 'b', 'a')).toBe('a');
  });
});
