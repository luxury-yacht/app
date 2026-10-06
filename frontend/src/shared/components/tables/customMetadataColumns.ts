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

/** A row's labels and annotations: in `metadata` for most resources, on the row itself for nodes. */
export const rowMetadataMaps = (
  row: unknown
): { labels?: Record<string, string>; annotations?: Record<string, string> } => {
  const metadataRow = row as CustomMetadataColumnRow;
  return {
    labels: metadataRow.metadata?.labels ?? metadataRow.labels,
    annotations: metadataRow.metadata?.annotations ?? metadataRow.annotations,
  };
};

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

const trimmedString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const isCustomMetadataColumnSource = (value: unknown): value is CustomMetadataColumnSource =>
  value === 'label' || value === 'annotation';

// One saved column definition, or null when it is malformed.
const parseCustomMetadataColumnDefinition = (
  candidate: unknown
): CustomMetadataColumnDefinition | null => {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return null;
  }
  const record = candidate as Record<string, unknown>;
  const metadataKey = trimmedString(record.metadataKey);
  const header = trimmedString(record.header);
  if (!isCustomMetadataColumnSource(record.source) || !metadataKey || !header) {
    return null;
  }
  return createCustomMetadataColumnDefinition({ source: record.source, metadataKey, header });
};

/** Saved column definitions, keeping the valid ones and the first of any repeated column. */
export const normalizeCustomMetadataColumnDefinitions = (
  value: unknown
): CustomMetadataColumnDefinition[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const definitions = new Map<string, CustomMetadataColumnDefinition>();
  for (const candidate of value) {
    const definition = parseCustomMetadataColumnDefinition(candidate);
    if (definition && !definitions.has(definition.key)) {
      definitions.set(definition.key, definition);
    }
  }
  return Array.from(definitions.values());
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
    const { labels, annotations } = rowMetadataMaps(row);
    collectMap('label', labels);
    collectMap('annotation', annotations);
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
        const { labels, annotations } = rowMetadataMaps(row);
        return (definition.source === 'label' ? labels : annotations)?.[definition.metadataKey];
      },
      { sortable: false, autoWidth: true }
    )
  );
