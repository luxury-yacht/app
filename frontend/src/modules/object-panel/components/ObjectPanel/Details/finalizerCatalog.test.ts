import { describe, expect, it } from 'vitest';
import { finalizerGuidance } from './finalizerCatalog';

describe('finalizerCatalog', () => {
  it('attributes an uncatalogued finalizer to the domain that qualifies it', () => {
    const guidance = finalizerGuidance('cert-manager.io/certificate-cleanup');

    expect(guidance.attribution).toBe('domain');
    expect(guidance.category).toBe('cert-manager.io');
    expect(guidance.explanation).toContain('domain prefix names the controller');
  });

  it('flags a finalizer that no domain attributes to a controller', () => {
    const guidance = finalizerGuidance('leftover-cleanup');

    expect(guidance.attribution).toBe('none');
    expect(guidance.category).toBe('Unqualified');
    expect(guidance.nextStep).toContain('Identify the controller');
  });

  it('treats a leading slash as no qualifier rather than an empty domain', () => {
    expect(finalizerGuidance('/orphaned').category).toBe('Unqualified');
  });

  it('resolves the legacy metav1 finalizers by name, never as unqualified', () => {
    for (const name of ['kubernetes', 'foregroundDeletion', 'orphan']) {
      expect(finalizerGuidance(name).attribution).toBe('catalog');
    }
    expect(finalizerGuidance('kubernetes').category).toBe('Namespace cleanup');
    expect(finalizerGuidance('orphan').category).toBe('Orphaning');
  });

  it('states the external-resource consequence for load-balancer cleanup', () => {
    const guidance = finalizerGuidance('service.kubernetes.io/load-balancer-cleanup');

    expect(guidance.category).toBe('Cleanup');
    expect(guidance.consequence).toContain('external load-balancer resources');
  });
});
