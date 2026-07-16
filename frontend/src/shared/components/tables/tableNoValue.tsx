import type { ReactNode } from 'react';
import './tableNoValue.css';

export const TABLE_NO_VALUE_TEXT = '-';

export const isTableNoValueText = (value: unknown): value is string =>
  typeof value === 'string' && (value.trim() === TABLE_NO_VALUE_TEXT || value.trim() === '—');

export const normalizeTableNoValueText = (value: string): string =>
  isTableNoValueText(value) ? TABLE_NO_VALUE_TEXT : value;

export const renderTableNoValue = (): ReactNode => (
  <span className="table-no-value">{TABLE_NO_VALUE_TEXT}</span>
);

interface TableCellValueProps {
  children: ReactNode;
}

export function TableCellValue({ children }: TableCellValueProps) {
  return isTableNoValueText(children) ? renderTableNoValue() : children;
}
