import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ConditionFacts } from '@/core/refresh/types';
import { claimProgressTracks, KarpenterProgress, poolProgressTracks } from './KarpenterProgress';

vi.mock('@shared/components/Tooltip', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const condition = (
  type: string,
  status: string,
  extra: Partial<ConditionFacts> = {}
): ConditionFacts => ({ type, status, lastTransitionTime: null, ...extra });

const mount = (node: ReactNode) => {
  const dom = document.createElement('div');
  dom.innerHTML = renderToStaticMarkup(node);
  return dom;
};

const stepStates = (dom: HTMLElement, label: string) =>
  [...dom.querySelectorAll(`[aria-label="${label}"] li`)].map((step) => [
    step.getAttribute('data-step'),
    step.getAttribute('data-state'),
  ]);

const chipVariant = (chip: Element) => {
  const match = /status-chip--(\w+)/.exec(chip.className);
  return match ? match[1] : 'none';
};

describe('Karpenter claim progress', () => {
  it('orders provisioning steps, derives each state, and surfaces the blocking reason', () => {
    const dom = mount(
      <KarpenterProgress
        tracks={claimProgressTracks}
        conditions={[
          condition('Registered', 'True'),
          condition('Launched', 'True'),
          condition('Initialized', 'False', {
            reason: 'NodeNotReady',
            message: 'Node registered but has not reported Ready.',
          }),
        ]}
      />
    );
    expect(stepStates(dom, 'Provisioning steps')).toEqual([
      ['Launched', 'done'],
      ['Registered', 'done'],
      ['Initialized', 'failed'],
      ['Ready', 'pending'],
    ]);
    const note = dom.querySelector('.karpenter-lifecycle-note');
    expect(note?.textContent).toContain('NodeNotReady');
    expect(note?.textContent).toContain('Node registered but has not reported Ready.');
    expect(dom.querySelector('[aria-label="Termination steps"]')).toBeNull();
  });

  it('reports the earliest incomplete step while later steps are still unknown', () => {
    const dom = mount(
      <KarpenterProgress
        tracks={claimProgressTracks}
        conditions={[
          condition('Launched', 'Unknown', {
            reason: 'AwaitingLaunch',
            message: 'Creating instance',
          }),
          condition('Registered', 'Unknown', { reason: 'AwaitingLaunch' }),
          condition('Ready', 'Unknown', {
            reason: 'AwaitingLaunch',
            message: 'Waiting on Launched',
          }),
        ]}
      />
    );
    expect(stepStates(dom, 'Provisioning steps')).toEqual([
      ['Launched', 'pending'],
      ['Registered', 'pending'],
      ['Initialized', 'pending'],
      ['Ready', 'pending'],
    ]);
    expect(dom.querySelector('.karpenter-lifecycle-note')?.textContent).toContain(
      'Creating instance'
    );
    expect(dom.textContent).not.toContain('Waiting on Launched');
  });

  it('shows termination progress only when present and keeps other conditions as polarity-aware chips', () => {
    const dom = mount(
      <KarpenterProgress
        tracks={claimProgressTracks}
        conditions={[
          condition('Launched', 'True'),
          condition('Registered', 'True'),
          condition('Initialized', 'True'),
          condition('Ready', 'True'),
          condition('Drifted', 'True', { reason: 'RequirementsDrifted' }),
          condition('Consolidatable', 'False'),
          condition('ConsistentStateFound', 'True'),
          condition('Drained', 'True'),
          condition('VolumesDetached', 'Unknown'),
        ]}
      />
    );
    expect(stepStates(dom, 'Termination steps')).toEqual([
      ['Drained', 'done'],
      ['VolumesDetached', 'pending'],
      ['InstanceTerminating', 'pending'],
    ]);
    expect(dom.querySelector('.karpenter-lifecycle-note')).toBeNull();
    expect(
      [...dom.querySelectorAll('.status-chip')].map((chip) => [chip.textContent, chipVariant(chip)])
    ).toEqual([
      ['Drifted', 'warning'],
      ['Consolidatable', 'healthy'],
      ['ConsistentStateFound', 'healthy'],
    ]);
  });

  it('renders nothing without conditions', () => {
    expect(
      renderToStaticMarkup(<KarpenterProgress tracks={claimProgressTracks} conditions={[]} />)
    ).toBe('');
  });
});

describe('Karpenter pool progress', () => {
  it('walks the readiness prerequisites into Ready and explains the failed prerequisite', () => {
    const dom = mount(
      <KarpenterProgress
        tracks={poolProgressTracks}
        conditions={[
          condition('Ready', 'False', {
            reason: 'UnhealthyDependents',
            message: 'NodeClassReady=False',
          }),
          condition('NodeClassReady', 'False', {
            reason: 'NodeClassNotReady',
            message: 'EC2NodeClass general-purpose is not ready',
          }),
          condition('ValidationSucceeded', 'True'),
          condition('NodeRegistrationHealthy', 'Unknown'),
        ]}
      />
    );
    expect(stepStates(dom, 'Readiness steps')).toEqual([
      ['ValidationSucceeded', 'done'],
      ['NodeClassReady', 'failed'],
      ['Ready', 'failed'],
    ]);
    const note = dom.querySelector('.karpenter-lifecycle-note');
    expect(note?.textContent).toContain('EC2NodeClass general-purpose is not ready');
    expect(dom.textContent).not.toContain('NodeClassReady=False');
    expect(dom.querySelector('[aria-label="Provisioning steps"]')).toBeNull();
    expect(
      [...dom.querySelectorAll('.status-chip')].map((chip) => [chip.textContent, chipVariant(chip)])
    ).toEqual([['NodeRegistrationHealthy', 'warning']]);
  });

  it('keeps a lone Ready condition as a chip when no prerequisite is reported', () => {
    const dom = mount(
      <KarpenterProgress tracks={poolProgressTracks} conditions={[condition('Ready', 'True')]} />
    );
    expect(dom.querySelector('[aria-label="Readiness steps"]')).toBeNull();
    expect(
      [...dom.querySelectorAll('.status-chip')].map((chip) => [chip.textContent, chipVariant(chip)])
    ).toEqual([['Ready', 'healthy']]);
  });
});
