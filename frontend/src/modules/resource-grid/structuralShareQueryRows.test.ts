import { structuralShareResourceRows } from '@shared/utils/structuralShareResourceRows';
import { describe, expect, it } from 'vitest';
import { makeResourceRef } from '@/test-utils/makeResourceRef';

interface Row {
  ref: ReturnType<typeof makeResourceRef>;
  status: string;
  labels?: Record<string, string>;
  conditions?: Array<{ type: string; status: string }>;
}

const row = (
  name: string,
  overrides: Partial<Omit<Row, 'ref'>> & { ref?: Partial<Row['ref']> } = {}
): Row => {
  const { ref: refOverrides, ...rowOverrides } = overrides;
  return {
    ref: makeResourceRef({
      clusterId: 'cluster-a',
      kind: 'ConfigMap',
      resource: 'configmaps',
      namespace: 'default',
      name,
      ...refOverrides,
    }),
    status: 'Ready',
    labels: { app: name },
    conditions: [{ type: 'Ready', status: 'True' }],
    ...rowOverrides,
  };
};

describe('structuralShareResourceRows', () => {
  it('reuses the previous array, row, and ref when every value is unchanged', () => {
    const previous = [row('api')];
    const incoming = [row('api')];

    const shared = structuralShareResourceRows(previous, incoming, 'row-and-ref');

    expect(shared).toBe(previous);
    expect(shared[0]).toBe(previous[0]);
    expect(shared[0].ref).toBe(previous[0].ref);
  });

  it('keeps the ref but allocates the incoming row when a scalar changes', () => {
    const previous = [row('api')];
    const incoming = [row('api', { status: 'Updating' })];

    const shared = structuralShareResourceRows(previous, incoming, 'row-and-ref');

    expect(shared).not.toBe(previous);
    expect(shared[0]).toBe(incoming[0]);
    expect(shared[0].ref).toBe(previous[0].ref);
    expect(shared[0].status).toBe('Updating');
  });

  it.each([
    ['map', { labels: { app: 'api', tier: 'backend' } }],
    ['array', { conditions: [{ type: 'Ready', status: 'False' }] }],
  ])('does not mask a changed nested %s value', (_label, overrides) => {
    const previous = [row('api')];
    const incoming = [row('api', overrides)];

    const shared = structuralShareResourceRows(previous, incoming, 'row-and-ref');

    expect(shared[0]).toBe(incoming[0]);
    expect(shared[0].ref).toBe(previous[0].ref);
  });

  it('allocates a new ref and row when canonical identity changes', () => {
    const previous = [row('api')];
    const incoming = [row('api', { ref: { uid: 'replacement' } })];

    const shared = structuralShareResourceRows(previous, incoming, 'row-and-ref');

    expect(shared[0]).toBe(incoming[0]);
    expect(shared[0].ref).toBe(incoming[0].ref);
    expect(shared[0].ref).not.toBe(previous[0].ref);
  });

  it('reuses matching rows across reordering without reusing the old array', () => {
    const previous = [row('api'), row('worker')];
    const incoming = [row('worker'), row('api')];

    const shared = structuralShareResourceRows(previous, incoming, 'row-and-ref');

    expect(shared).not.toBe(previous);
    expect(shared[0]).toBe(previous[1]);
    expect(shared[1]).toBe(previous[0]);
  });

  it('reuses surviving rows across insertion and deletion', () => {
    const api = row('api');
    const worker = row('worker');
    const inserted = row('inserted');

    const afterInsertion = structuralShareResourceRows(
      [api, worker],
      [row('api'), inserted, row('worker')],
      'row-and-ref'
    );
    expect(afterInsertion[0]).toBe(api);
    expect(afterInsertion[1]).toBe(inserted);
    expect(afterInsertion[2]).toBe(worker);

    const afterDeletion = structuralShareResourceRows(
      afterInsertion,
      [row('worker')],
      'row-and-ref'
    );
    expect(afterDeletion).toEqual([worker]);
    expect(afterDeletion[0]).toBe(worker);
  });

  it('does not reuse ambiguous duplicate canonical keys', () => {
    const previous = [row('api'), row('api')];
    const incoming = [row('api'), row('api')];

    const shared = structuralShareResourceRows(previous, incoming, 'row-and-ref');

    expect(shared[0]).toBe(incoming[0]);
    expect(shared[1]).toBe(incoming[1]);
  });

  it('reuses refs but skips recursive row comparison in ref-only mode', () => {
    const previous = [row('api')];
    const incoming = [row('api')];

    const shared = structuralShareResourceRows(previous, incoming, 'ref-only');

    expect(shared).toBe(incoming);
    expect(shared[0]).toBe(incoming[0]);
    expect(shared[0].ref).toBe(previous[0].ref);
  });
});
