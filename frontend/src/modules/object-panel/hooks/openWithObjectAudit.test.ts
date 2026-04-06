/**
 * frontend/src/modules/object-panel/hooks/openWithObjectAudit.test.ts
 *
 * Guardrail test for the kind-only-objects bug.
 *
 * Walks every .ts/.tsx file under frontend/src and finds every literal
 * call site of the form `openWithObject({ ... })` (or
 * `openWithObjectRef.current({ ... })`). For each literal, asserts that
 * the object expression includes BOTH a `group:` and a `version:` key,
 * OR spreads `...resolveBuiltinGroupVersion(...)`.
 *
 * Why: built-in Kinds are unique, but custom resources can share a Kind
 * across multiple groups (e.g. documentdb.services.k8s.aws/DBInstance vs
 * rds.services.k8s.aws/DBInstance). Without group/version on the
 * KubernetesObjectReference, the panel cannot disambiguate, and the
 * backend's legacy kind-only resolver picks the first match — landing
 * on the wrong CRD. See docs/plans/kind-only-objects.md.
 *
 * If a new openWithObject call site fails this test, the fix is to add
 * the missing fields rather than to add an exemption. Exemptions exist
 * only for synthetic kinds that never resolve to a real Kubernetes
 * GVK (e.g. Helm releases).
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// Files where literal openWithObject call sites use a synthetic kind
// that does NOT correspond to a real Kubernetes GVK and therefore has
// no meaningful group/version. Document the reason next to each entry.
const ALLOWED_LEGACY_FILES = new Map<string, string>([
  [
    // HelmRelease is the panel's synthetic name for a Helm CLI release
    // (managed by helm/v3, not the Kubernetes API). It is never resolved
    // through discovery, so group/version are intentionally absent.
    'src/modules/namespace/components/NsViewHelm.tsx',
    'HelmRelease is a synthetic Helm CLI kind, not a Kubernetes GVK',
  ],
]);

interface CallSite {
  file: string;
  line: number;
  text: string;
}

// Walk every .ts/.tsx file under the given directory, skipping the
// usual noise (node_modules, generated wails bindings, fixtures, and
// the test files themselves).
function* walkSourceFiles(root: string): Generator<string> {
  const stack: string[] = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name === 'node_modules' ||
          entry.name === 'wailsjs' ||
          entry.name === '__fixtures__' ||
          entry.name === 'dist'
        ) {
          continue;
        }
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      // Skip test files: tests assert against mocks; production code is
      // what actually constructs the references that hit the backend.
      if (/\.test\.(ts|tsx)$/.test(entry.name)) continue;
      yield full;
    }
  }
}

// Extract every `openWithObject(...)` (or `openWithObjectRef.current(...)`)
// literal call site, where the first argument is an object literal. Uses
// brace-depth counting (with simple string-literal awareness) so we can
// span multiple lines and handle nested objects/spreads.
function findOpenWithObjectLiterals(source: string): Array<{ start: number; body: string }> {
  const results: Array<{ start: number; body: string }> = [];
  // Match `openWithObject(` or `openWithObjectRef.current(` at any
  // position. Trailing whitespace and an opening `{` mark the literal.
  const pattern = /openWithObject(?:Ref\.current)?\s*\(\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    // Position of the opening `{` (last char of the regex match).
    const openBrace = match.index + match[0].length - 1;
    let depth = 0;
    let i = openBrace;
    let inString: '"' | "'" | '`' | null = null;
    let escape = false;
    let closeBrace = -1;
    for (; i < source.length; i++) {
      const ch = source[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (inString) {
        if (ch === '\\') {
          escape = true;
          continue;
        }
        if (ch === inString) {
          inString = null;
        }
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        inString = ch;
        continue;
      }
      if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          closeBrace = i;
          break;
        }
      }
    }
    if (closeBrace === -1) {
      throw new Error(`Unterminated openWithObject literal starting at offset ${match.index}`);
    }
    results.push({
      start: match.index,
      body: source.slice(openBrace, closeBrace + 1),
    });
  }
  return results;
}

function lineNumberAtOffset(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') line++;
  }
  return line;
}

function gatherViolations(): CallSite[] {
  const frontendSrc = path.resolve(__dirname, '../../..');
  const violations: CallSite[] = [];
  for (const file of walkSourceFiles(frontendSrc)) {
    const source = fs.readFileSync(file, 'utf8');
    if (!source.includes('openWithObject')) continue;
    const literals = findOpenWithObjectLiterals(source);
    if (literals.length === 0) continue;

    const relative = path.relative(path.resolve(frontendSrc, '..'), file);
    const allowed = ALLOWED_LEGACY_FILES.has(relative);

    for (const literal of literals) {
      // Strip line comments so // group: foo doesn't accidentally pass.
      const stripped = literal.body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      const hasGroupKey = /(^|[\s,{])group\s*:/.test(stripped);
      const hasVersionKey = /(^|[\s,{])version\s*:/.test(stripped);
      const hasResolveSpread = /\.\.\.resolveBuiltinGroupVersion\s*\(/.test(stripped);
      const ok = hasResolveSpread || (hasGroupKey && hasVersionKey);
      if (ok) continue;
      if (allowed) continue;
      violations.push({
        file: relative,
        line: lineNumberAtOffset(source, literal.start),
        text: literal.body.length > 240 ? `${literal.body.slice(0, 240)}…` : literal.body,
      });
    }
  }
  return violations;
}

describe('openWithObject audit (kind-only-objects guardrail)', () => {
  it('every openWithObject literal carries group + version (or spreads resolveBuiltinGroupVersion)', () => {
    const violations = gatherViolations();
    if (violations.length > 0) {
      const message = violations
        .map((v) => `  ${v.file}:${v.line}\n${v.text.replace(/^/gm, '    ')}`)
        .join('\n\n');
      throw new Error(
        `Found ${violations.length} openWithObject call site(s) missing group/version.\n\n` +
          message +
          '\n\nFix: add `group:` and `version:` keys to the literal, or spread ' +
          '`...resolveBuiltinGroupVersion(kind)` for a built-in. See ' +
          'docs/plans/kind-only-objects.md.'
      );
    }
    expect(violations).toEqual([]);
  });

  it('discovers at least one literal call site so the walker is wired up', () => {
    // Sanity check: if the walker silently finds nothing, the suite above
    // would pass vacuously. Assert we are reaching real production code.
    const frontendSrc = path.resolve(__dirname, '../../..');
    let total = 0;
    for (const file of walkSourceFiles(frontendSrc)) {
      const source = fs.readFileSync(file, 'utf8');
      if (!source.includes('openWithObject')) continue;
      total += findOpenWithObjectLiterals(source).length;
    }
    expect(total).toBeGreaterThan(10);
  });
});
