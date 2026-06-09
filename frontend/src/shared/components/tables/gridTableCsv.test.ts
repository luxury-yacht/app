import { describe, expect, it } from 'vitest';

import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import { buildGridTableCsv } from './gridTableCsv';

interface Row {
  name: string;
  note: string;
}

// The CSV builder feeds each header/cell ReactNode through getTextContent; the real
// app renders to text, but for these rows the nodes are already strings.
const getTextContent = (node: unknown): string => String(node ?? '');

const columns = [
  { key: 'name', header: 'Name', render: (row: Row) => row.name },
  { key: 'note', header: 'Note', render: (row: Row) => row.note },
] as unknown as GridColumnDefinition<Row>[];

describe('buildGridTableCsv', () => {
  it('builds a header row + data rows from the displayed columns', () => {
    const csv = buildGridTableCsv(
      [
        { name: 'alpha', note: 'one' },
        { name: 'beta', note: 'two' },
      ],
      columns,
      getTextContent
    );

    expect(csv).toBe('Name,Note\nalpha,one\nbeta,two');
  });

  it('quotes and escapes cells containing commas, quotes, or newlines', () => {
    const csv = buildGridTableCsv([{ name: 'a,b', note: 'he said "hi"' }], columns, getTextContent);

    expect(csv).toBe('Name,Note\n"a,b","he said ""hi"""');
  });

  it('returns an empty string when there are no columns', () => {
    expect(buildGridTableCsv([{ name: 'a', note: 'b' }], [], getTextContent)).toBe('');
  });
});
