export const escapeCsvCell = (value: string): string =>
  /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

export const buildCsv = (rows: string[][]): string =>
  rows.map((row) => row.map(escapeCsvCell).join(',')).join('\n');
