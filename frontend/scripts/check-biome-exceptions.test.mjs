import { describe, expect, it } from 'vitest';
import {
  collectDisabledOverrides,
  collectSuppressions,
  validateExceptionSnapshot,
} from './check-biome-exceptions.mjs';

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
});
