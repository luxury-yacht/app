/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/driftCheck.test.ts
 *
 * Runtime drift-check: every field of a kind's generated DTO class must be accounted for by its
 * Overview descriptor — shown via the schema, consumed by a derived sibling section, or explicitly
 * listed in `coveredElsewhere`. A new backend field that nobody places fails this test by name.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { registeredDescriptors } from './descriptorRegistry';
import { coverageKeys } from './schema';

const generatedModelFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return generatedModelFiles(entryPath);
    }
    return entry.name === 'models.ts' ? [entryPath] : [];
  });

const bindingDirectory = path.resolve(import.meta.dirname, '../../../../../../../bindings');
const generatedSources = generatedModelFiles(bindingDirectory).map((file) =>
  readFileSync(file, 'utf8')
);

const generatedDtoFields = (className: string): string[] => {
  const declaration = `export class ${className} {`;
  const matches = generatedSources.filter((source) => source.includes(declaration));
  if (matches.length !== 1) {
    throw new Error(`Expected one generated ${className} class, found ${matches.length}`);
  }
  const classBody = matches[0]?.split(declaration, 2)[1]?.split('/** Creates a new', 1)[0] ?? '';
  return Array.from(classBody.matchAll(/^\s+"([^"]+)"\??:/gm), (match) => match[1] as string);
};

describe('Overview descriptor drift-check', () => {
  for (const descriptor of registeredDescriptors) {
    it(`${descriptor.displayKind}: descriptor accounts for every DTO field`, () => {
      const allFields = generatedDtoFields(descriptor.dtoClass.name);
      const covered = coverageKeys(descriptor);
      const uncovered = allFields.filter((field) => !covered.has(field));
      expect(uncovered).toEqual([]);
    });
  }
});
