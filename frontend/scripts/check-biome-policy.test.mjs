import { describe, expect, it } from 'vitest';
import {
  collectConfigPolicyErrors,
  collectDisabledOverrides,
  collectSuppressions,
  policyFileName,
  readSourceFiles,
  validateExceptionSnapshot,
} from './check-biome-policy.mjs';

it('loads the Biome policy from its policy-named manifest', () => {
  expect(policyFileName).toBe('biome-policy.json');
});

describe('Biome exception snapshot', () => {
  it('rejects an override that is not in the approved manifest', () => {
    const errors = validateExceptionSnapshot({
      actualOverrides: [
        {
          includes: ['src/new-widget.tsx'],
          rules: ['a11y.noAutofocus'],
        },
      ],
      approvedOverrides: [],
      actualSuppressions: [],
      approvedSuppressions: [],
    });

    expect(errors).toEqual([
      'Unapproved Biome override: [src/new-widget.tsx] disables a11y.noAutofocus',
    ]);
  });

  it('requires a rationale for each approved override', () => {
    const override = {
      includes: ['src/widget.tsx'],
      rules: ['a11y.noAutofocus'],
    };
    const errors = validateExceptionSnapshot({
      actualOverrides: [override],
      approvedOverrides: [override],
      actualSuppressions: [],
      approvedSuppressions: [],
    });

    expect(errors).toEqual([
      'Approved Biome override requires a rationale: [src/widget.tsx] disables a11y.noAutofocus',
    ]);
  });

  it('rejects a stale approved override after the config exception is removed', () => {
    const errors = validateExceptionSnapshot({
      actualOverrides: [],
      approvedOverrides: [
        {
          includes: ['src/widget.tsx'],
          rules: ['a11y.noAutofocus'],
          reason: 'Legacy widget contract.',
        },
      ],
      actualSuppressions: [],
      approvedSuppressions: [],
    });

    expect(errors).toEqual([
      'Stale approved Biome override: [src/widget.tsx] disables a11y.noAutofocus',
    ]);
  });

  it('rejects an inline suppression that is not in the approved manifest', () => {
    const errors = validateExceptionSnapshot({
      actualOverrides: [],
      approvedOverrides: [],
      actualSuppressions: [
        {
          file: 'src/new-widget.tsx',
          rule: 'lint/a11y/noAutofocus',
          count: 1,
        },
      ],
      approvedSuppressions: [],
    });

    expect(errors).toEqual([
      'Unapproved Biome suppression: src/new-widget.tsx disables lint/a11y/noAutofocus (1 occurrence)',
    ]);
  });

  it('rejects a stale approved suppression after the inline exception is removed', () => {
    const errors = validateExceptionSnapshot({
      actualOverrides: [],
      approvedOverrides: [],
      actualSuppressions: [],
      approvedSuppressions: [
        {
          file: 'src/widget.tsx',
          rule: 'lint/a11y/noAutofocus',
          count: 1,
        },
      ],
    });

    expect(errors).toEqual([
      'Stale approved Biome suppression: src/widget.tsx disables lint/a11y/noAutofocus (1 occurrence)',
    ]);
  });
});

describe('Biome inline suppression policy', () => {
  it.each([
    'biome-ignore-all',
    'biome-ignore-start',
    'biome-ignore-end',
  ])('rejects broad %s directives', (directive) => {
    const result = collectSuppressions([
      {
        file: 'src/widget.tsx',
        content: `// ${directive} lint/a11y/noAutofocus: broad suppression`,
      },
    ]);

    expect(result).toEqual({
      errors: [
        `src/widget.tsx:1 Biome suppression form ${directive} is prohibited; use an exact inline biome-ignore directive`,
      ],
      suppressions: [],
    });
  });

  it('requires an exact rule instead of a rule category', () => {
    const result = collectSuppressions([
      {
        file: 'src/widget.tsx',
        content: '// biome-ignore lint/a11y: custom interaction contract',
      },
    ]);

    expect(result.errors).toEqual([
      'src/widget.tsx:1 Biome suppression must name an exact rule: lint/a11y',
    ]);
  });

  it('requires a rationale after the suppression rule', () => {
    const result = collectSuppressions([
      {
        file: 'src/widget.tsx',
        content: '// biome-ignore lint/a11y/noAutofocus',
      },
    ]);

    expect(result.errors).toEqual([
      'src/widget.tsx:1 Biome suppression requires a rationale: lint/a11y/noAutofocus',
    ]);
  });

  it('collects multiple exact rules from one suppression comment', () => {
    const result = collectSuppressions([
      {
        file: 'src/widget.tsx',
        content:
          '// biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: composite widget owns keyboard activation',
      },
    ]);

    expect(result).toEqual({
      errors: [],
      suppressions: [
        {
          file: 'src/widget.tsx',
          rule: 'lint/a11y/noStaticElementInteractions',
          count: 1,
        },
        {
          file: 'src/widget.tsx',
          rule: 'lint/a11y/useKeyWithClickEvents',
          count: 1,
        },
      ],
    });
  });
});

describe('Biome config exception collection', () => {
  it('collects disabled rules with their exact include scope', () => {
    const overrides = collectDisabledOverrides({
      overrides: [
        {
          includes: ['src/widget.tsx'],
          linter: {
            rules: {
              a11y: {
                noAutofocus: 'off',
                useValidAnchor: 'error',
              },
            },
          },
        },
      ],
    });

    expect(overrides).toEqual([
      {
        includes: ['src/widget.tsx'],
        rules: ['a11y.noAutofocus'],
      },
    ]);
  });

  it('rejects configuration-level lint disabling', () => {
    const errors = collectConfigPolicyErrors(
      {
        formatter: { enabled: false },
        assist: { enabled: false },
        linter: {
          enabled: false,
          rules: {
            preset: 'none',
            suspicious: { noExplicitAny: 'off' },
          },
        },
        overrides: [
          {
            includes: ['src/**'],
            linter: { enabled: false, rules: { preset: 'none' } },
          },
        ],
      },
      {
        rulePreset: 'recommended',
        requiredRules: ['suspicious.noExplicitAny'],
        requiredHooks: [],
      }
    );

    expect(errors).toEqual(
      expect.arrayContaining([
        'Biome formatter must remain enabled.',
        'Biome assist must remain enabled.',
        'Biome linter must remain enabled.',
        'Biome rule preset must remain recommended.',
        'Biome global rule disabling is prohibited: suspicious.noExplicitAny',
        'Biome override may not disable the linter: [src/**]',
        'Biome override may not set the rule preset to none: [src/**]',
      ])
    );
  });

  it('requires configured strict rules and custom hooks', () => {
    const errors = collectConfigPolicyErrors(
      {
        formatter: { enabled: true },
        assist: { enabled: true },
        linter: {
          enabled: true,
          rules: {
            preset: 'recommended',
            suspicious: { noExplicitAny: 'warn' },
            correctness: {
              useExhaustiveDependencies: {
                level: 'error',
                options: { reportUnnecessaryDependencies: false, hooks: [] },
              },
            },
          },
        },
      },
      {
        rulePreset: 'recommended',
        requiredRules: ['suspicious.noExplicitAny'],
        requiredHooks: ['useEffectWithInvalidation'],
      }
    );

    expect(errors).toEqual(
      expect.arrayContaining([
        'Biome strict rule must remain at error: suspicious.noExplicitAny',
        'Biome unnecessary hook dependency reporting must remain enabled.',
        'Biome exhaustive-dependency hook is missing: useEffectWithInvalidation',
      ])
    );
  });

  it('rejects weakened options for a required strict rule', () => {
    const errors = collectConfigPolicyErrors(
      {
        formatter: { enabled: true },
        assist: { enabled: true },
        linter: {
          enabled: true,
          rules: {
            preset: 'recommended',
            complexity: {
              useMaxParams: { level: 'error', options: { max: 8 } },
            },
            correctness: {
              useExhaustiveDependencies: {
                level: 'error',
                options: { reportUnnecessaryDependencies: true, hooks: [] },
              },
            },
          },
        },
      },
      {
        rulePreset: 'recommended',
        requiredRules: ['complexity.useMaxParams'],
        requiredRuleOptions: {
          'complexity.useMaxParams': { max: 7 },
        },
        requiredHooks: [],
      }
    );

    expect(errors).toContain(
      'Biome strict rule options must remain exact: complexity.useMaxParams'
    );
  });

  it('requires exact scopes for scoped strict rules', () => {
    const errors = collectConfigPolicyErrors(
      {
        formatter: { enabled: true },
        assist: { enabled: true },
        linter: {
          enabled: true,
          rules: {
            preset: 'recommended',
            correctness: {
              useExhaustiveDependencies: {
                level: 'error',
                options: { reportUnnecessaryDependencies: true, hooks: [] },
              },
            },
          },
        },
        overrides: [
          {
            includes: ['src/**'],
            linter: { rules: { correctness: { noNodejsModules: 'error' } } },
          },
        ],
      },
      {
        rulePreset: 'recommended',
        requiredRules: [],
        requiredHooks: [],
        requiredScopedRules: [
          {
            rule: 'correctness.noNodejsModules',
            includes: ['src/**', '!src/**/*.test.*', '!src/**/*.stories.*'],
          },
        ],
      }
    );

    expect(errors).toContain(
      'Biome scoped strict rule must remain exact: correctness.noNodejsModules'
    );
  });

  it('requires project file extensions and exact plugin scopes', () => {
    const errors = collectConfigPolicyErrors(
      {
        files: { includes: ['**/*.{js,ts,mjs-disabled,cjs.map}'] },
        formatter: { enabled: true },
        assist: { enabled: true },
        linter: {
          enabled: true,
          rules: {
            preset: 'recommended',
            correctness: {
              useExhaustiveDependencies: {
                level: 'error',
                options: { reportUnnecessaryDependencies: true, hooks: [] },
              },
            },
          },
        },
        plugins: [{ path: './boundary.grit', includes: ['src/**/*.ts'] }],
      },
      {
        rulePreset: 'recommended',
        requiredRules: [],
        requiredHooks: [],
        requiredFileExtensions: ['mjs', 'cjs'],
        requiredPlugins: [
          { path: './boundary.grit', includes: ['**/src/**/*.ts', '!**/src/allowed/**'] },
        ],
      }
    );

    expect(errors).toEqual(
      expect.arrayContaining([
        'Biome files.includes must cover .mjs files.',
        'Biome files.includes must cover .cjs files.',
        'Biome boundary plugin scope must remain exact: ./boundary.grit',
      ])
    );
  });
});

describe('Biome source inventory', () => {
  it('covers root and JSON files while excluding generated and dependency trees', () => {
    const files = readSourceFiles(process.cwd()).map(({ file }) => file);

    expect(files).toEqual(
      expect.arrayContaining(['index.html', 'vite.config.ts', 'vitest.setup.ts', 'biome.json'])
    );
    expect(files).not.toContain('package-lock.json');
    expect(files).not.toContain('src/core/refresh/types.generated.ts');
    expect(files.some((file) => file.startsWith('node_modules/'))).toBe(false);
  });
});
