import { describe, expect, it } from 'vitest';
import { collectSuppressionErrors, readSourceFiles } from './check-biome-suppressions.mjs';

describe('Biome inline suppression policy', () => {
  it.each([
    'biome-ignore-all',
    'biome-ignore-start',
    'biome-ignore-end',
  ])('rejects broad %s directives', (directive) => {
    const errors = collectSuppressionErrors([
      {
        file: 'src/widget.tsx',
        content: `// ${directive} lint/a11y/noAutofocus: broad suppression`,
      },
    ]);

    expect(errors).toEqual([
      `src/widget.tsx:1 Biome suppression form ${directive} is prohibited; use an exact inline biome-ignore directive`,
    ]);
  });

  it('requires an exact rule instead of a rule category', () => {
    const errors = collectSuppressionErrors([
      {
        file: 'src/widget.tsx',
        content: '// biome-ignore lint/a11y: custom interaction contract',
      },
    ]);

    expect(errors).toEqual([
      'src/widget.tsx:1 Biome suppression must name an exact rule: lint/a11y',
    ]);
  });

  it('requires a rationale after the suppression rule', () => {
    const errors = collectSuppressionErrors([
      {
        file: 'src/widget.tsx',
        content: '// biome-ignore lint/a11y/noAutofocus',
      },
    ]);

    expect(errors).toEqual([
      'src/widget.tsx:1 Biome suppression requires a rationale: lint/a11y/noAutofocus',
    ]);
  });

  it('accepts exact rules with a rationale', () => {
    const errors = collectSuppressionErrors([
      {
        file: 'src/widget.tsx',
        content:
          '// biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: composite widget owns keyboard activation',
      },
    ]);

    expect(errors).toEqual([]);
  });
});

describe('Biome source inventory', () => {
  it('covers root and JSON files while excluding generated and dependency trees', () => {
    const files = readSourceFiles(process.cwd()).map(({ file }) => file);

    expect(files).toEqual(
      expect.arrayContaining(['index.html', 'vite.config.ts', 'vitest.setup.ts', 'biome.jsonc'])
    );
    expect(files).not.toContain('package-lock.json');
    expect(files).not.toContain('src/core/refresh/types.generated.ts');
    expect(files.some((file) => file.startsWith('node_modules/'))).toBe(false);
  });
});
