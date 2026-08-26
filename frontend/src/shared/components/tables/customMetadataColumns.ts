import type { ResourceTableMetadata } from '@core/refresh/types';
import { createTextColumn } from '@shared/components/tables/columnFactories';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';

export type CustomMetadataColumnSource = 'label' | 'annotation';

export interface CustomMetadataColumnDefinition {
  key: string;
  source: CustomMetadataColumnSource;
  metadataKey: string;
  header: string;
}

export interface AvailableCustomMetadataKey {
  source: CustomMetadataColumnSource;
  metadataKey: string;
  sampleValues: string[];
}

export interface CustomMetadataColumnRow {
  metadata?: ResourceTableMetadata | null;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

interface CreateCustomMetadataColumnDefinitionInput {
  source: CustomMetadataColumnSource;
  metadataKey: string;
  header: string;
}

export const createCustomMetadataColumnDefinition = ({
  source,
  metadataKey,
  header,
}: CreateCustomMetadataColumnDefinitionInput): CustomMetadataColumnDefinition => ({
  key: `metadata:${source}:${metadataKey}`,
  source,
  metadataKey,
  header,
});

export const defaultCustomMetadataColumnHeader = (metadataKey: string): string => {
  const segments = metadataKey.trim().split('/');
  const finalSegment = segments[segments.length - 1] ?? '';
  return finalSegment
    .split(/[-_.]/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
};

export const normalizeCustomMetadataColumnDefinitions = (
  value: unknown
): CustomMetadataColumnDefinition[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const definitions: CustomMetadataColumnDefinition[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      continue;
    }
    const record = candidate as Record<string, unknown>;
    const source = record.source;
    const metadataKey = typeof record.metadataKey === 'string' ? record.metadataKey.trim() : '';
    const header = typeof record.header === 'string' ? record.header.trim() : '';
    if ((source !== 'label' && source !== 'annotation') || !metadataKey || !header) {
      continue;
    }
    const definition = createCustomMetadataColumnDefinition({ source, metadataKey, header });
    if (seen.has(definition.key)) {
      continue;
    }
    seen.add(definition.key);
    definitions.push(definition);
  }
  return definitions;
};

const CUSTOM_METADATA_SAMPLE_VALUE_LIMIT = 3;

export const collectAvailableCustomMetadataKeys = <T>(rows: T[]): AvailableCustomMetadataKey[] => {
  const valuesBySource: Record<CustomMetadataColumnSource, Map<string, string[]>> = {
    label: new Map(),
    annotation: new Map(),
  };

  const collectMap = (
    source: CustomMetadataColumnSource,
    values: Record<string, string> | undefined
  ) => {
    for (const [key, value] of Object.entries(values ?? {})) {
      const samples = valuesBySource[source].get(key) ?? [];
      if (samples.length < CUSTOM_METADATA_SAMPLE_VALUE_LIMIT && !samples.includes(value)) {
        samples.push(value);
      }
      valuesBySource[source].set(key, samples);
    }
  };

  for (const row of rows) {
    const metadataRow = row as CustomMetadataColumnRow;
    collectMap('label', metadataRow.metadata?.labels ?? metadataRow.labels);
    collectMap('annotation', metadataRow.metadata?.annotations ?? metadataRow.annotations);
  }

  return (['label', 'annotation'] as const).flatMap((source) =>
    [...valuesBySource[source].entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([metadataKey, sampleValues]) => ({ source, metadataKey, sampleValues }))
  );
};

export const buildCustomMetadataGridColumns = <T>(
  definitions: CustomMetadataColumnDefinition[]
): GridColumnDefinition<T>[] =>
  definitions.map((definition) =>
    createTextColumn<T>(
      definition.key,
      definition.header,
      (row) => {
        const metadataRow = row as CustomMetadataColumnRow;
        const metadataMaps = metadataRow.metadata;
        const values =
          definition.source === 'label'
            ? (metadataMaps?.labels ?? metadataRow.labels)
            : (metadataMaps?.annotations ?? metadataRow.annotations);
        return values?.[definition.metadataKey];
      },
      { sortable: false, autoWidth: true }
    )
  );
