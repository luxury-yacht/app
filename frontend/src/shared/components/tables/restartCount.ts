import { TABLE_NO_VALUE_TEXT } from './tableNoValue';

export const formatRestartCount = (value?: number | null): string =>
  (value ?? 0) > 0 ? String(value) : TABLE_NO_VALUE_TEXT;
