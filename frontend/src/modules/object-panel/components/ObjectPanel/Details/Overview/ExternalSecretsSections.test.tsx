import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { ExternalSecretsSections } from './ExternalSecretsSections';

describe('ExternalSecretsSections data mappings', () => {
  it('keeps individual and bulk source keys, versions and conversion settings distinct', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(
          <ExternalSecretsSections
            facts={{
              externalSecret: {
                data: [
                  {
                    secretKey: 'password',
                    remoteRef: {
                      key: 'database',
                      property: 'password',
                      version: 'previous',
                      conversionStrategy: 'Unicode',
                      decodingStrategy: 'Base64',
                    },
                  },
                ],
                dataFrom: [
                  {
                    extract: {
                      key: 'application',
                      property: 'settings',
                      version: 'current',
                      conversionStrategy: 'Default',
                      decodingStrategy: 'Auto',
                    },
                  },
                ],
              },
            }}
          />
        );
      });
      const values = Array.from(container.querySelectorAll('.overview-card')).map((card) =>
        Array.from(card.querySelectorAll('.overview-value')).map((value) => value.textContent)
      );
      expect(values).toEqual([
        ['database', 'password', 'previous', 'Unicode', 'Base64'],
        ['application', 'settings', 'current', 'Default', 'Auto'],
      ]);
    } finally {
      act(() => root.unmount());
    }
  });

  it('retains find and generator configuration when an extract source is absent', async () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(
          <ExternalSecretsSections
            facts={{
              externalSecret: {
                dataFrom: [
                  {
                    find: {
                      path: '/team',
                      name: { regexp: '^app-' },
                      tags: { environment: 'test' },
                    },
                    sourceRef: {
                      generatorRef: {
                        name: 'token',
                        kind: 'Password',
                        apiVersion: 'generators.external-secrets.io/v1alpha1',
                      },
                    },
                  },
                ],
              },
            }}
          />
        );
      });
      const values = Array.from(container.querySelectorAll('.overview-value')).map(
        (value) => value.textContent
      );
      expect(values).toEqual([
        '/team',
        '^app-',
        'token',
        'Password',
        'generators.external-secrets.io/v1alpha1',
      ]);
      expect(container.textContent).toContain('environment=test');
    } finally {
      act(() => root.unmount());
    }
  });
});
