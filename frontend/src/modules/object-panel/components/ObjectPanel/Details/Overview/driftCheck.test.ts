/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/driftCheck.test.ts
 *
 * Runtime drift-check: every field of a kind's generated DTO class must be accounted for by its
 * Overview descriptor — shown via the schema, consumed by a derived sibling section, or explicitly
 * listed in `coveredElsewhere`. A new backend field that nobody places fails this test by name.
 */

import { describe, it, expect } from 'vitest';
import { registeredDescriptors } from './descriptorRegistry';
import { coverageKeys } from './schema';

describe('Overview descriptor drift-check', () => {
  for (const descriptor of registeredDescriptors) {
    it(`${descriptor.displayKind}: descriptor accounts for every DTO field`, () => {
      const allFields = Object.keys(new descriptor.dtoClass({}));
      const covered = coverageKeys(descriptor);
      const uncovered = allFields.filter((field) => !covered.has(field));
      expect(uncovered).toEqual([]);
    });
  }
});
