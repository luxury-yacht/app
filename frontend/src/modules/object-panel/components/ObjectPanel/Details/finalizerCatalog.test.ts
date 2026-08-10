import { describe, expect, it } from 'vitest';
import { finalizerGuidance } from './finalizerCatalog';

describe('finalizerCatalog', () => {
  it('defaults unknown finalizers to identify-before-removal guidance', () => {
    const guidance = finalizerGuidance('example.com/cleanup');

    expect(guidance.title).toBe('Unknown finalizer');
    expect(guidance.nextStep).toContain('Identify the controller');
  });

  it('states the external-resource consequence for load-balancer cleanup', () => {
    expect(finalizerGuidance('service.kubernetes.io/load-balancer-cleanup').consequence).toContain(
      'external load-balancer resources'
    );
  });
});
