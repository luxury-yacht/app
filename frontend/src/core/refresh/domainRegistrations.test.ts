import { describe, expect, it } from 'vitest';
import { registerDefaultRefreshDomains } from './domainRegistrations';
import type { StreamingRegistration } from './refreshRegistration';
import type { RefreshDomain } from './types';

const registeredStreaming = (domain: RefreshDomain): StreamingRegistration => {
  const streaming = new Map<RefreshDomain, StreamingRegistration | undefined>();
  registerDefaultRefreshDomains({
    registerDomain: (config) => {
      streaming.set(config.domain, config.streaming);
    },
  });
  const registration = streaming.get(domain);
  if (!registration) {
    throw new Error(`No streaming registration for ${domain}`);
  }
  return registration;
};

describe('resource-stream registration', () => {
  // The orchestrator calls start() outside a try block and routes failures
  // through the returned promise, so an unsupported scope must reject rather
  // than throw synchronously.
  it('reports an unsupported multi-cluster start as a rejected promise', async () => {
    const streaming = registeredStreaming('nodes');
    let started: ReturnType<StreamingRegistration['start']> | undefined;

    expect(() => {
      started = streaming.start('clusters=cluster-a,cluster-b|');
    }).not.toThrow();
    await expect(started).rejects.toThrow('single cluster');
  });

  it('reports an unsupported multi-cluster manual refresh as a rejected promise', async () => {
    const streaming = registeredStreaming('nodes');
    let refreshed: Promise<void> | undefined;

    expect(() => {
      refreshed = streaming.refreshOnce?.('clusters=cluster-a,cluster-b|');
    }).not.toThrow();
    await expect(refreshed).rejects.toThrow('single cluster');
  });
});
