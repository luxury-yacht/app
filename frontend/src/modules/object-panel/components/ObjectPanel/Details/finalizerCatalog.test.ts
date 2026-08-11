import { describe, expect, it } from 'vitest';
import { finalizerGuidance } from './finalizerCatalog';

describe('finalizerCatalog', () => {
  it('uses the qualifying domain to guide uncatalogued-finalizer diagnosis', () => {
    const guidance = finalizerGuidance('cert-manager.io/certificate-cleanup');

    expect(guidance.warnsAboutMissingAttribution).toBe(false);
    expect(guidance.explanation).toContain('domain prefix names the controller');
  });

  it('flags a finalizer that no domain attributes to a controller', () => {
    const guidance = finalizerGuidance('leftover-cleanup');

    expect(guidance.warnsAboutMissingAttribution).toBe(true);
    expect(guidance.nextStep).toContain('Identify the controller');
  });

  it('treats a leading slash as no qualifier rather than an empty domain', () => {
    expect(finalizerGuidance('/orphaned').warnsAboutMissingAttribution).toBe(true);
  });

  it('resolves the legacy metav1 finalizers by name without an attribution warning', () => {
    for (const name of ['kubernetes', 'foregroundDeletion', 'orphan']) {
      expect(finalizerGuidance(name).warnsAboutMissingAttribution).toBe(false);
    }
    expect(finalizerGuidance('kubernetes').explanation).toContain('namespace controller');
    expect(finalizerGuidance('orphan').explanation).toContain('orphaning the dependents');
  });

  it('states the external-resource consequence for load-balancer cleanup', () => {
    const guidance = finalizerGuidance('service.kubernetes.io/load-balancer-cleanup');

    expect(guidance.consequence).toContain('external load-balancer resources');
  });
});
