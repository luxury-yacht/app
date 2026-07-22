/**
 * frontend/src/modules/object-map/objectMapSelection.test.ts
 *
 * Tests selected and connected object-map edge state derivation.
 */

import { describe, expect, it } from 'vitest';
import type { PositionedEdge } from './objectMapLayout';
import {
  computeObjectMapSelectionState,
  isObjectMapEdgeDimmedBySelection,
} from './objectMapSelection';

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

describe('isObjectMapEdgeDimmedBySelection', () => {
  const edges = [edge('edge-related', 'replicaset', 'pod'), edge('edge-unrelated', 'a', 'b')];

  it('never dims when no node is selected', () => {
    const state = computeObjectMapSelectionState(edges, null);

    expect(isObjectMapEdgeDimmedBySelection(state, 'edge-related')).toBe(false);
    expect(isObjectMapEdgeDimmedBySelection(state, 'edge-unrelated')).toBe(false);
  });

  it('dims only edges unrelated to the active selection', () => {
    const state = computeObjectMapSelectionState(edges, 'replicaset');

    expect(isObjectMapEdgeDimmedBySelection(state, 'edge-related')).toBe(false);
    expect(isObjectMapEdgeDimmedBySelection(state, 'edge-unrelated')).toBe(true);
  });
});
