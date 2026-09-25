import { describe, expect, it } from 'vitest';
import type { panelwindow } from '@/core/backend-api/models';
import {
  buildPanelTarget,
  panelTargetFromSnapshot,
  panelTargetId,
  panelTargetSnapshot,
} from './panelTarget';

describe('identity panel targets', () => {
  it('round trips exact names without constructing Kubernetes object references', () => {
    const ref = {
      targetType: 'identity' as const,
      clusterId: 'cluster-a',
      kind: 'User' as const,
      name: ' alice ',
    };
    const target = buildPanelTarget(ref);
    const snapshot = panelTargetSnapshot(panelTargetId(target), target, 'details');
    expect(snapshot.objectRef).toBeUndefined();
    expect(panelTargetFromSnapshot(snapshot)).toEqual(ref);
    expect(
      new Set([
        panelTargetId(target),
        panelTargetId({ ...ref, name: 'alice' }),
        panelTargetId({ ...ref, kind: 'Group' }),
        panelTargetId({ ...ref, clusterId: 'cluster-b' }),
      ]).size
    ).toBe(4);
  });
  it('rejects incomplete references and resource tabs with a subject attached', () => {
    expect(() =>
      buildPanelTarget({ targetType: 'identity', clusterId: '', kind: 'User', name: 'alice' })
    ).toThrow();
    expect(() =>
      panelTargetFromSnapshot({
        kind: 'object' as panelwindow.TabKind,
        panelId: 'invalid',
        activeView: 'details',
        identityRef: { clusterId: 'a', kind: 'User', name: 'alice' },
      })
    ).toThrow();
  });
});
