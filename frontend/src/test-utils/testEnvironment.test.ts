/**
 * frontend/src/test-utils/testEnvironment.test.ts
 *
 * The test environment settles WebCrypto digests within microtasks, with the
 * real algorithm. Table persistence hashes the cluster before it hydrates; a
 * digest left on Node's threadpool lands in a later event-loop turn than the
 * app-state harness's settle() drains, so under load a table could hydrate,
 * and read, after the test had already asserted. A different digest would
 * change every persisted table's storage key.
 */

import { computeClusterHash } from '@shared/components/tables/persistence/gridTablePersistence';
import { describe, expect, it } from 'vitest';

const drainMicrotasks = async () => {
  for (let turn = 0; turn < 10; turn++) {
    await Promise.resolve();
  }
};

const hex = (buffer: ArrayBuffer | undefined) =>
  buffer
    ? Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('')
    : undefined;

describe('WebCrypto digests in tests', () => {
  it('settle a table storage key hash within microtasks', async () => {
    let hash: string | undefined;
    void computeClusterHash('dev:alpha').then((value) => {
      hash = value;
    });

    await drainMicrotasks();

    expect(hash).toMatch(/^[0-9a-f]{12}$/);
  });

  it('compute the real SHA-256, so table storage keys are unchanged', async () => {
    let digest: ArrayBuffer | undefined;
    void crypto.subtle.digest('SHA-256', new TextEncoder().encode('abc')).then((value) => {
      digest = value;
    });

    await drainMicrotasks();

    expect(hex(digest)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
