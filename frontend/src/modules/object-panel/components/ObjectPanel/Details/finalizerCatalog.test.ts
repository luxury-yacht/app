import { describe, expect, it } from 'vitest';
import { finalizerGuidance } from './finalizerCatalog';

describe('finalizerCatalog', () => {
  it('defaults unknown finalizers to identify-before-removal guidance', () => {
    const guidance = finalizerGuidance('example.com/cleanup');

    expect(guidance.recognized).toBe(false);
    expect(guidance.category).toBe('Unrecognized');
    expect(guidance.nextStep).toContain('Identify the controller');
  });

  it('recognizes the namespace controller finalizer that blocks namespace deletion', () => {
    const guidance = finalizerGuidance('kubernetes');

    expect(guidance.recognized).toBe(true);
    expect(guidance.category).toBe('Namespace cleanup');
  });

  it('states the external-resource consequence for load-balancer cleanup', () => {
    const guidance = finalizerGuidance('service.kubernetes.io/load-balancer-cleanup');

    expect(guidance.recognized).toBe(true);
    expect(guidance.consequence).toContain('external load-balancer resources');
  });
});
