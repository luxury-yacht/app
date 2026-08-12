/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/driftCheck.test.ts
 *
 * Source drift-check: every field of a kind's generated DTO interface must be accounted for by its
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

const generatedDtoFields = (interfaceName: string): string[] => {
  const declaration = `export interface ${interfaceName} {`;
  const matches = generatedSources.filter((source) => source.includes(declaration));
  if (matches.length !== 1) {
    throw new Error(`Expected one generated ${interfaceName} interface, found ${matches.length}`);
  }
  const interfaceBody = matches[0]?.split(declaration, 2)[1]?.split(/^}/m, 1)[0] ?? '';
  return Array.from(interfaceBody.matchAll(/^\s+"([^"]+)"\??:/gm), (match) => match[1] as string);
};

describe('Overview descriptor drift-check', () => {
  for (const descriptor of registeredDescriptors) {
    it(`${descriptor.displayKind}: descriptor accounts for every DTO field`, () => {
      const allFields = generatedDtoFields(descriptor.dtoName);
      const covered = coverageKeys(descriptor);
      const uncovered = allFields.filter((field) => !covered.has(field));
      expect(uncovered).toEqual([]);
    });
  }
});
