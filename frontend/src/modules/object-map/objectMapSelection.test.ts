import { describe, expect, it } from 'vitest';
import { computeObjectMapSelectionState } from './objectMapSelection';
import type { PositionedEdge } from './objectMapLayout';

const edge = (id: string, sourceId: string, targetId: string): PositionedEdge => ({
  id,
  sourceId,
  targetId,
  type: 'owner',
  label: 'owns',
  d: '',
  midX: 0,
  midY: 0,
  sameColumn: false,
});

describe('computeObjectMapSelectionState', () => {
  it('walks forward and backward from the active node', () => {
    const state = computeObjectMapSelectionState(
      [
        edge('edge-parent', 'deployment', 'replicaset'),
        edge('edge-child', 'replicaset', 'pod'),
        edge('edge-service', 'service', 'pod'),
        edge('edge-unrelated', 'configmap-a', 'configmap-b'),
      ],
      'replicaset'
    );

    expect(state.activeId).toBe('replicaset');
    expect(state.connectedIds).toEqual(new Set(['pod', 'deployment']));
    expect(state.connectedEdgeIds).toEqual(new Set(['edge-parent', 'edge-child']));
  });

  it('returns an empty selection when no node is active', () => {
    const state = computeObjectMapSelectionState([edge('edge-1', 'a', 'b')], null);

    expect(state.activeId).toBeNull();
    expect(state.connectedIds.size).toBe(0);
    expect(state.connectedEdgeIds.size).toBe(0);
  });
});
