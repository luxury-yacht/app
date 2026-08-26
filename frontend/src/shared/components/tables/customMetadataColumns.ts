import { createTextColumn } from '@shared/components/tables/columnFactories';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';

export type CustomMetadataColumnSource = 'label' | 'annotation';

export interface CustomMetadataColumnDefinition {
  key: string;
  source: CustomMetadataColumnSource;
  metadataKey: string;
  header: string;
}

export interface CustomMetadataColumnRow {
  metadata?: {
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  } | null;
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
