/**
 * frontend/src/modules/object-panel/hooks/openWithObjectAudit.test.ts
 *
 * Guardrail tests for the kind-only-objects bug.
 *
 * Walks every .ts/.tsx file under frontend/src and finds every literal
 * `KubernetesObjectReference` that ends up feeding the object panel via
 * one of two entry points:
 *
 *   1. `openWithObject({ ... })` (or `openWithObjectRef.current({ ... })`) —
 *      direct call into useObjectPanel from view files and command-palette
 *      handlers.
 *   2. `<ObjectPanelLink objectRef={{ ... }}>` — JSX prop on the shared
 *      panel-link component, used by the Overview details to render
 *      clickable inline references (Owner, Node, Service, ServiceAccount,
 *      HPA scale target, Helm release resources, Endpoints targetRefs, …).
 *      ObjectPanelLink forwards `objectRef` straight to `openWithObject`
 *      so the same group/version invariant applies.
 *
 * For each literal, asserts the object expression includes BOTH a `group:`
 * and a `version:` key, OR spreads `...resolveBuiltinGroupVersion(...)`,
 * OR spreads `...parseApiVersion(...)`.
 *
 * Why: built-in Kinds are unique, but custom resources can share a Kind
 * across multiple groups (e.g. documentdb.services.k8s.aws/DBInstance vs
 * rds.services.k8s.aws/DBInstance). Without group/version on the
 * KubernetesObjectReference, the panel cannot disambiguate, and the
 * backend's strict GVK resolver hard-errors on missing apiVersion.
 *
 * If a new call site fails this test, the fix is to add the missing
 * fields rather than to add an exemption. Exemptions exist only for
 * synthetic kinds that never resolve to a real Kubernetes GVK (e.g.
 * Helm releases).
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

// Extract every object literal that follows a regex match in the source.
// `pattern` must end at (or just before) the opening `{` of the literal so
// the brace counter has the right starting point. Used by both the
// openWithObject(...) walker and the <ObjectPanelLink objectRef={{...}}>
// walker — both consume the same shape (a `KubernetesObjectReference`
// literal) and need the same group/version invariant.
function findObjectLiteralsAfter(
  source: string,
  pattern: RegExp,
  patternName: string
): Array<{ start: number; body: string }> {
  const results: Array<{ start: number; body: string }> = [];
  for (const match of source.matchAll(pattern)) {
    const matchIndex = match.index ?? 0;
    // Position of the opening `{` (last char of the regex match).
    const openBrace = matchIndex + match[0].length - 1;
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
      // Skip comments BEFORE checking for string quotes — apostrophes inside
      // comments (e.g. "didn't") would otherwise enter string mode and
      // unbalance the brace counter.
      if (ch === '/' && i + 1 < source.length) {
        const next = source[i + 1];
        if (next === '/') {
          // Line comment: skip to newline.
          const nl = source.indexOf('\n', i + 2);
          i = nl === -1 ? source.length - 1 : nl;
          continue;
        }
        if (next === '*') {
          // Block comment: skip to */.
          const end = source.indexOf('*/', i + 2);
          i = end === -1 ? source.length - 1 : end + 1;
          continue;
        }
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
      throw new Error(`Unterminated ${patternName} literal starting at offset ${matchIndex}`);
    }
    results.push({
      start: matchIndex,
      body: source.slice(openBrace, closeBrace + 1),
    });
  }
  return results;
}

// Extract every `openWithObject(...)` (or `openWithObjectRef.current(...)`)
// literal call site, where the first argument is an object literal.
function findOpenWithObjectLiterals(source: string): Array<{ start: number; body: string }> {
  // Match `openWithObject(` or `openWithObjectRef.current(` at any
  // position. Trailing whitespace and an opening `{` mark the literal.
  return findObjectLiteralsAfter(
    source,
    /openWithObject(?:Ref\.current)?\s*\(\s*\{/g,
    'openWithObject'
  );
}

// Extract every `<ObjectPanelLink ... objectRef={{...}}>` literal where the
// objectRef prop is an inline object literal. The opening `{{` distinguishes
// JSX-expression-containing-an-object-literal from `objectRef={someVar}`.
function findObjectPanelLinkLiterals(source: string): Array<{ start: number; body: string }> {
  return findObjectLiteralsAfter(source, /objectRef\s*=\s*\{\s*\{/g, 'objectRef={{...}}');
}

function lineNumberAtOffset(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') line++;
  }
  return line;
}

// Audits an object literal body for the group/version invariant. Returns
// true if any of:
//   - the body declares both `group:` and `version:` keys directly, OR
//   - the body invokes `resolveBuiltinGroupVersion(...)` (anywhere), OR
//   - the body invokes `parseApiVersion(...)` (anywhere).
//
// The helper-call check is loose on purpose: it accepts both direct spreads
// (`...resolveBuiltinGroupVersion(kind)`) and conditional spreads
// (`...(cond ? parseApiVersion(av) : resolveBuiltinGroupVersion(kind))`),
// and any future shape that funnels through one of the two canonical
// helpers. We strip comments first so a `// group: ...` comment doesn't
// accidentally pass.
function literalSatisfiesInvariant(body: string): boolean {
  const stripped = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const hasGroupKey = /(^|[\s,{])group\s*:/.test(stripped);
  const hasVersionKey = /(^|[\s,{])version\s*:/.test(stripped);
  const hasResolveBuiltinHelper = /resolveBuiltinGroupVersion\s*\(/.test(stripped);
  const hasParseApiVersionHelper = /parseApiVersion\s*\(/.test(stripped);
  return hasResolveBuiltinHelper || hasParseApiVersionHelper || (hasGroupKey && hasVersionKey);
}

interface AuditConfig {
  // Substring prefilter — files that don't include this string are skipped
  // before the (more expensive) literal walker runs.
  sourceMarker: string;
  // Walker that pulls every relevant object literal out of a source file.
  finder: (source: string) => Array<{ start: number; body: string }>;
}

function gatherViolations(config: AuditConfig): CallSite[] {
  const frontendSrc = path.resolve(__dirname, '../../..');
  const violations: CallSite[] = [];
  for (const file of walkSourceFiles(frontendSrc)) {
    const source = fs.readFileSync(file, 'utf8');
    if (!source.includes(config.sourceMarker)) continue;
    const literals = config.finder(source);
    if (literals.length === 0) continue;

    const relative = path.relative(path.resolve(frontendSrc, '..'), file);
    const allowed = ALLOWED_LEGACY_FILES.has(relative);

    for (const literal of literals) {
      if (literalSatisfiesInvariant(literal.body)) continue;
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

const OPEN_WITH_OBJECT_AUDIT: AuditConfig = {
  sourceMarker: 'openWithObject',
  finder: findOpenWithObjectLiterals,
};

const OBJECT_PANEL_LINK_AUDIT: AuditConfig = {
  sourceMarker: 'ObjectPanelLink',
  finder: findObjectPanelLinkLiterals,
};

function formatViolationError(callSiteName: string, violations: CallSite[]): string {
  const message = violations
    .map((v) => `  ${v.file}:${v.line}\n${v.text.replace(/^/gm, '    ')}`)
    .join('\n\n');
  return (
    `Found ${violations.length} ${callSiteName} site(s) missing group/version.\n\n` +
    message +
    '\n\nFix: add `group:` and `version:` keys to the literal, or spread ' +
    '`...resolveBuiltinGroupVersion(kind)` for a built-in (or ' +
    '`...parseApiVersion(apiVersion)` when the source carries a wire-form ' +
    'apiVersion).'
  );
}

describe('openWithObject audit (kind-only-objects guardrail)', () => {
  it('every openWithObject literal carries group + version (or spreads resolveBuiltinGroupVersion)', () => {
    const violations = gatherViolations(OPEN_WITH_OBJECT_AUDIT);
    if (violations.length > 0) {
      throw new Error(formatViolationError('openWithObject call', violations));
    }
    expect(violations).toEqual([]);
  });

  it('discovers at least one literal call site so the walker is wired up', () => {
    // Sanity check: helper-backed migrations intentionally removed the last
    // inline `openWithObject({ ... })` literal, so the walker may now see
    // zero literal sites. Still assert that production sources contain at
    // least one openWithObject entry point so this audit does not become
    // dead code after a broad refactor.
    const frontendSrc = path.resolve(__dirname, '../../..');
    let totalCalls = 0;
    for (const file of walkSourceFiles(frontendSrc)) {
      const source = fs.readFileSync(file, 'utf8');
      if (!source.includes('openWithObject')) continue;
      totalCalls += source.match(/openWithObject(?:Ref\.current)?\s*\(/g)?.length ?? 0;
    }
    expect(totalCalls).toBeGreaterThan(0);
  });
});

describe('ObjectPanelLink audit (kind-only-objects guardrail)', () => {
  it('every <ObjectPanelLink objectRef={{...}}> literal carries group + version', () => {
    const violations = gatherViolations(OBJECT_PANEL_LINK_AUDIT);
    if (violations.length > 0) {
      throw new Error(formatViolationError('<ObjectPanelLink objectRef={{...}}>', violations));
    }
    expect(violations).toEqual([]);
  });

  it('discovers at least one ObjectPanelLink literal so the walker is wired up', () => {
    // Sanity check: helper-backed migrations may remove all inline
    // `objectRef={{ ... }}` literals. Still assert that production sources
    // contain ObjectPanelLink entry points so this audit does not become
    // dead code after a broad refactor.
    const frontendSrc = path.resolve(__dirname, '../../..');
    let totalCalls = 0;
    for (const file of walkSourceFiles(frontendSrc)) {
      const source = fs.readFileSync(file, 'utf8');
      if (!source.includes('ObjectPanelLink')) continue;
      totalCalls += source.match(/ObjectPanelLink/g)?.length ?? 0;
    }
    expect(totalCalls).toBeGreaterThan(0);
  });
});
