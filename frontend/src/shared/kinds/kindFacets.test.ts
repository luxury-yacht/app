import { describe, expect, it } from 'vitest';
import {
  HELM_RELEASE_GVK,
  lookupKindByName,
  lookupKindFacets,
  lookupKindMetadata,
} from './kindFacets';

describe('lookupKindFacets', () => {
  it('finds a built-in kind by its complete identity, in any kind case', () => {
    expect(lookupKindFacets({ group: 'apps', version: 'v1', kind: 'Deployment' })?.kind).toBe(
      'Deployment'
    );
    expect(lookupKindFacets({ group: 'apps', version: 'v1', kind: 'deployment' })?.kind).toBe(
      'Deployment'
    );
  });

  it('rejects a version the backend does not serve for the kind', () => {
    expect(lookupKindFacets({ group: 'apps', version: 'v1beta1', kind: 'Deployment' })).toBeNull();
  });

  it('accepts every served version of a kind', () => {
    for (const version of ['v1', 'v2']) {
      expect(
        lookupKindFacets({ group: 'autoscaling', version, kind: 'HorizontalPodAutoscaler' })
          ?.objectMap
      ).toBe(true);
    }
  });

  it('gives no facets to a custom resource that shares a built-in kind name', () => {
    expect(
      lookupKindFacets({ group: 'batch.volcano.sh', version: 'v1alpha1', kind: 'Job' })
    ).toBeNull();
  });

  it('needs the group and version', () => {
    expect(lookupKindFacets({ kind: 'Pod', version: 'v1' })).toBeNull();
    expect(lookupKindFacets({ kind: 'Pod', group: '' })).toBeNull();
    expect(lookupKindFacets({ kind: 'Pod', group: '', version: 'v1' })?.panel.shell).toBe('exec');
  });

  it('serves the synthetic Helm release', () => {
    expect(lookupKindFacets(HELM_RELEASE_GVK)?.objectMap).toBe(true);
  });
});

describe('lookupKindMetadata', () => {
  it('ignores the version but not the group', () => {
    expect(lookupKindMetadata({ group: 'apps', kind: 'Deployment' })?.kind).toBe('Deployment');
    expect(lookupKindMetadata({ group: 'example.com', kind: 'Deployment' })).toBeNull();
  });
});

describe('lookupKindByName', () => {
  it('resolves a bare kind name to its built-in row', () => {
    expect(lookupKindByName(' node ')?.group).toBe('');
    expect(lookupKindByName('NotAKind')).toBeNull();
  });
});
