/**
 * frontend/src/shared/constants/builtinGroupVersions.test.ts
 */

import { describe, expect, it } from 'vitest';

import { parseApiVersion } from './builtinGroupVersions';

describe('parseApiVersion', () => {
  it('returns an empty object for null/undefined/empty input', () => {
    expect(parseApiVersion(null)).toEqual({});
    expect(parseApiVersion(undefined)).toEqual({});
    expect(parseApiVersion('')).toEqual({});
    expect(parseApiVersion('   ')).toEqual({});
  });

  it('treats version-only strings as core/v1 (empty group)', () => {
    expect(parseApiVersion('v1')).toEqual({ group: '', version: 'v1' });
    expect(parseApiVersion('v1beta1')).toEqual({ group: '', version: 'v1beta1' });
  });

  it('splits group/version on the first slash', () => {
    expect(parseApiVersion('apps/v1')).toEqual({ group: 'apps', version: 'v1' });
    expect(parseApiVersion('rbac.authorization.k8s.io/v1')).toEqual({
      group: 'rbac.authorization.k8s.io',
      version: 'v1',
    });
  });

  it('handles CRD group/version strings without losing dotted groups', () => {
    expect(parseApiVersion('documentdb.services.k8s.aws/v1alpha1')).toEqual({
      group: 'documentdb.services.k8s.aws',
      version: 'v1alpha1',
    });
    expect(parseApiVersion('rds.services.k8s.aws/v1alpha1')).toEqual({
      group: 'rds.services.k8s.aws',
      version: 'v1alpha1',
    });
  });

  it('trims surrounding whitespace before parsing', () => {
    expect(parseApiVersion('  apps/v1  ')).toEqual({ group: 'apps', version: 'v1' });
  });
});
