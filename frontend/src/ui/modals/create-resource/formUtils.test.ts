import { describe, expect, it } from 'vitest';
import {
  getNestedValue,
  setNestedValue,
  unsetNestedValue,
  toStringMap,
  toMapEntries,
  toPersistedMap,
  arePersistedMapsEqual,
  fixedWidthStyle,
  shouldOmitEmptyValue,
  buildSelectOptions,
  getSelectFieldValue,
  fieldFlexStyle,
  getRequiredFieldErrors,
} from './formUtils';
import type { FormFieldDefinition } from './formDefinitions';

describe('formUtils', () => {
  // ─── getNestedValue ──────────────────────────────────────────────────

  describe('getNestedValue', () => {
    it('reads a top-level key', () => {
      expect(getNestedValue({ name: 'foo' }, ['name'])).toBe('foo');
    });

    it('reads a deeply nested key', () => {
      const obj = { a: { b: { c: 42 } } };
      expect(getNestedValue(obj, ['a', 'b', 'c'])).toBe(42);
    });

    it('returns undefined for missing paths', () => {
      expect(getNestedValue({ a: 1 }, ['b'])).toBeUndefined();
      expect(getNestedValue({ a: 1 }, ['a', 'b'])).toBeUndefined();
    });

    it('returns undefined when traversing through null', () => {
      expect(getNestedValue({ a: null } as Record<string, unknown>, ['a', 'b'])).toBeUndefined();
    });
  });

  // ─── setNestedValue ──────────────────────────────────────────────────

  describe('setNestedValue', () => {
    it('sets a top-level key', () => {
      expect(setNestedValue({}, ['name'], 'bar')).toEqual({ name: 'bar' });
    });

    it('sets a nested key and creates intermediates', () => {
      const result = setNestedValue({}, ['a', 'b'], 'val');
      expect(result).toEqual({ a: { b: 'val' } });
    });

    it('preserves other keys', () => {
      const result = setNestedValue({ x: 1, y: 2 }, ['x'], 99);
      expect(result).toEqual({ x: 99, y: 2 });
    });

    it('returns the original object for empty path', () => {
      const obj = { a: 1 };
      expect(setNestedValue(obj, [], 'anything')).toBe(obj);
    });
  });

  // ─── unsetNestedValue ────────────────────────────────────────────────

  describe('unsetNestedValue', () => {
    it('removes a top-level key', () => {
      expect(unsetNestedValue({ a: 1, b: 2 }, ['a'])).toEqual({ b: 2 });
    });

    it('removes a nested key', () => {
      const obj = { a: { b: 1, c: 2 } };
      expect(unsetNestedValue(obj, ['a', 'b'])).toEqual({ a: { c: 2 } });
    });

    it('prunes empty parent objects', () => {
      const obj = { a: { b: 1 } };
      expect(unsetNestedValue(obj, ['a', 'b'])).toEqual({});
    });

    it('returns the original object for empty path', () => {
      const obj = { a: 1 };
      expect(unsetNestedValue(obj, [])).toBe(obj);
    });

    it('handles missing intermediate paths gracefully', () => {
      const obj = { a: 1 };
      const result = unsetNestedValue(obj, ['b', 'c']);
      expect(result).toEqual({ a: 1 });
    });
  });

  // ─── Map utilities ───────────────────────────────────────────────────

  describe('toStringMap', () => {
    it('converts an object to a string map', () => {
      expect(toStringMap({ a: 1, b: 'two' })).toEqual({ a: '1', b: 'two' });
    });

    it('returns empty object for non-objects', () => {
      expect(toStringMap(null)).toEqual({});
      expect(toStringMap(undefined)).toEqual({});
      expect(toStringMap('string')).toEqual({});
      expect(toStringMap([])).toEqual({});
    });
  });

  describe('toMapEntries', () => {
    it('converts an object to [key, value] pairs', () => {
      expect(toMapEntries({ x: 'a', y: 'b' })).toEqual([
        ['x', 'a'],
        ['y', 'b'],
      ]);
    });
  });

  describe('toPersistedMap', () => {
    it('skips blank keys', () => {
      const rows: [string, string][] = [
        ['key1', 'val1'],
        ['', 'val2'],
      ];
      expect(toPersistedMap(rows)).toEqual({ key1: 'val1' });
    });

    it('skips excluded keys', () => {
      const rows: [string, string][] = [
        ['key1', 'val1'],
        ['key2', 'val2'],
      ];
      expect(toPersistedMap(rows, new Set(['key2']))).toEqual({ key1: 'val1' });
    });
  });

  describe('arePersistedMapsEqual', () => {
    it('returns true for identical maps', () => {
      const rows: [string, string][] = [['a', '1']];
      expect(arePersistedMapsEqual(rows, rows)).toBe(true);
    });

    it('returns false for different values', () => {
      expect(arePersistedMapsEqual([['a', '1']], [['a', '2']])).toBe(false);
    });

    it('returns false for different keys', () => {
      expect(arePersistedMapsEqual([['a', '1']], [['b', '1']])).toBe(false);
    });

    it('ignores blank keys in comparison', () => {
      expect(
        arePersistedMapsEqual(
          [
            ['a', '1'],
            ['', '2'],
          ],
          [['a', '1']]
        )
      ).toBe(true);
    });
  });

  // ─── Style utilities ─────────────────────────────────────────────────

  describe('fixedWidthStyle', () => {
    it('returns undefined when no inputWidth', () => {
      expect(fixedWidthStyle({})).toBeUndefined();
    });

    it('returns a fixed-width style object', () => {
      const style = fixedWidthStyle({ inputWidth: '6ch' });
      expect(style).toEqual({
        flex: '0 0 auto',
        width: '6ch',
        minWidth: '6ch',
        maxWidth: '6ch',
      });
    });
  });

  describe('fieldFlexStyle', () => {
    it('returns undefined when no fieldFlex', () => {
      expect(fieldFlexStyle({})).toBeUndefined();
    });

    it('returns a flex style', () => {
      expect(fieldFlexStyle({ fieldFlex: '0 0 auto' })).toEqual({ flex: '0 0 auto' });
    });
  });

  // ─── Field value utilities ────────────────────────────────────────────

  describe('shouldOmitEmptyValue', () => {
    it('returns true for empty strings on non-required fields by default', () => {
      const field = { key: 'f', label: 'F', path: ['f'], type: 'text' } as FormFieldDefinition;
      expect(shouldOmitEmptyValue(field, '')).toBe(true);
      expect(shouldOmitEmptyValue(field, '  ')).toBe(true);
    });

    it('returns true for empty arrays on non-required fields', () => {
      const field = { key: 'f', label: 'F', path: ['f'], type: 'string-list' } as FormFieldDefinition;
      expect(shouldOmitEmptyValue(field, [])).toBe(true);
    });

    it('returns false when value is non-empty', () => {
      const field = { key: 'f', label: 'F', path: ['f'], type: 'text' } as FormFieldDefinition;
      expect(shouldOmitEmptyValue(field, 'hello')).toBe(false);
    });

    it('returns false for non-empty arrays', () => {
      const field = { key: 'f', label: 'F', path: ['f'], type: 'string-list' } as FormFieldDefinition;
      expect(shouldOmitEmptyValue(field, ['a'])).toBe(false);
    });

    it('returns false for required fields even when empty', () => {
      const field = { key: 'f', label: 'F', path: ['f'], type: 'text', required: true } as FormFieldDefinition;
      expect(shouldOmitEmptyValue(field, '')).toBe(false);
    });

    it('returns false when omitIfEmpty is explicitly false', () => {
      const field = { key: 'f', label: 'F', path: ['f'], type: 'text', omitIfEmpty: false } as FormFieldDefinition;
      expect(shouldOmitEmptyValue(field, '')).toBe(false);
    });
  });

  describe('buildSelectOptions', () => {
    it('includes an empty option by default', () => {
      const field = {
        key: 'f', label: 'F', path: ['f'], type: 'select',
        options: [{ label: 'A', value: 'a' }],
      } as FormFieldDefinition;
      const opts = buildSelectOptions(field);
      expect(opts[0]).toEqual({ value: '', label: '-----' });
      expect(opts).toHaveLength(2);
    });

    it('excludes the empty option when includeEmptyOption is false', () => {
      const field = {
        key: 'f', label: 'F', path: ['f'], type: 'select',
        options: [{ label: 'A', value: 'a' }],
        includeEmptyOption: false,
      } as FormFieldDefinition;
      const opts = buildSelectOptions(field);
      expect(opts).toHaveLength(1);
      expect(opts[0].value).toBe('a');
    });
  });

  describe('getSelectFieldValue', () => {
    it('returns the value as-is when no implicitDefault', () => {
      const field = { key: 'f', label: 'F', path: ['f'], type: 'select' } as FormFieldDefinition;
      expect(getSelectFieldValue(field, 'TCP')).toBe('TCP');
      expect(getSelectFieldValue(field, '')).toBe('');
    });

    it('returns the implicitDefault when value is empty', () => {
      const field = {
        key: 'f', label: 'F', path: ['f'], type: 'select', implicitDefault: 'TCP',
      } as FormFieldDefinition;
      expect(getSelectFieldValue(field, '')).toBe('TCP');
      expect(getSelectFieldValue(field, 'UDP')).toBe('UDP');
    });
  });

  // ─── getRequiredFieldErrors ──────────────────────────────────────────

  describe('getRequiredFieldErrors', () => {
    const definition = {
      sections: [
        {
          fields: [
            { key: 'name', label: 'Name', path: ['metadata', 'name'], type: 'text', required: true } as FormFieldDefinition,
            { key: 'ns', label: 'Namespace', path: ['metadata', 'namespace'], type: 'text' } as FormFieldDefinition,
          ],
        },
      ],
    };

    it('returns errors for missing required fields', () => {
      const mockGet = (_yaml: string, path: string[]) => {
        if (path.join('.') === 'metadata.name') return undefined;
        return 'value';
      };
      const errors = getRequiredFieldErrors(definition, 'yaml', mockGet);
      expect(errors).toEqual(['Name is required']);
    });

    it('returns errors for empty string required fields', () => {
      const mockGet = (_yaml: string, path: string[]) => {
        if (path.join('.') === 'metadata.name') return '  ';
        return 'value';
      };
      const errors = getRequiredFieldErrors(definition, 'yaml', mockGet);
      expect(errors).toEqual(['Name is required']);
    });

    it('returns no errors when required fields have values', () => {
      const mockGet = () => 'some-value';
      const errors = getRequiredFieldErrors(definition, 'yaml', mockGet);
      expect(errors).toEqual([]);
    });

    it('ignores non-required fields', () => {
      const mockGet = () => undefined;
      const errors = getRequiredFieldErrors(definition, 'yaml', mockGet);
      // Only 'Name' is required, 'Namespace' is not.
      expect(errors).toEqual(['Name is required']);
    });
  });
});
