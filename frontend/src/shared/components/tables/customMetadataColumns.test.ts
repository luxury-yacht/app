import { describe, expect, it } from 'vitest';
import {
  buildCustomMetadataGridColumns,
  collectAvailableCustomMetadataKeys,
  createCustomMetadataColumnDefinition,
} from './customMetadataColumns';

describe('custom metadata columns', () => {
  it('covers custom metadata columns scenarios', async () => {
    {
      // Scenario: derives stable and source-specific identity from the exact metadata key
      const label = createCustomMetadataColumnDefinition({
        source: 'label',
        metadataKey: 'app.kubernetes.io/owner',
        header: 'Owner',
      });
      const renamed = createCustomMetadataColumnDefinition({
        source: 'label',
        metadataKey: 'app.kubernetes.io/owner',
        header: 'Team owner',
      });
      const annotation = createCustomMetadataColumnDefinition({
        source: 'annotation',
        metadataKey: 'app.kubernetes.io/owner',
        header: 'Owner annotation',
      });

      expect(label.key).toBe('metadata:label:app.kubernetes.io/owner');
      expect(renamed.key).toBe(label.key);
      expect(annotation.key).toBe('metadata:annotation:app.kubernetes.io/owner');
    }

    {
      // Scenario: renders exact label and annotation values and reserves the placeholder for missing keys
      const columns = buildCustomMetadataGridColumns<{
        metadata?: {
          labels?: Record<string, string>;
          annotations?: Record<string, string>;
        };
      }>([
        createCustomMetadataColumnDefinition({
          source: 'label',
          metadataKey: 'example.com/owner',
          header: 'Owner',
        }),
        createCustomMetadataColumnDefinition({
          source: 'annotation',
          metadataKey: 'example.com/note',
          header: 'Note',
        }),
      ]);

      const row = {
        metadata: {
          labels: { 'example.com/owner': 'platform' },
          annotations: { 'example.com/note': '' },
        },
      };

      expect(columns[0].render(row)).toBe('platform');
      expect(columns[1].render(row)).toBe('');
      expect(columns[0].render({})).toBe('-');
      expect(
        columns.every((column) => column.sortable === false && column.autoWidth === true)
      ).toBe(true);
    }
    // Scenario: collects grouped metadata keys with distinct sample values from nested and legacy rows
    expect(
      collectAvailableCustomMetadataKeys([
        {
          metadata: {
            labels: { 'example.com/team': 'platform', app: 'api' },
            annotations: { 'example.com/revision': '7' },
          },
        },
        {
          labels: { app: 'worker', tier: 'backend' },
          annotations: { 'example.com/checksum': 'abc' },
        },
      ])
    ).toEqual([
      { source: 'label', metadataKey: 'app', sampleValues: ['api', 'worker'] },
      { source: 'label', metadataKey: 'example.com/team', sampleValues: ['platform'] },
      { source: 'label', metadataKey: 'tier', sampleValues: ['backend'] },
      { source: 'annotation', metadataKey: 'example.com/checksum', sampleValues: ['abc'] },
      { source: 'annotation', metadataKey: 'example.com/revision', sampleValues: ['7'] },
    ]);
  });
});
