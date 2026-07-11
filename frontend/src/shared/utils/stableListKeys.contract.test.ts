import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const duplicateProneOverviewFiles = [
  'src/modules/object-panel/components/ObjectPanel/Details/DetailsTabContainers.tsx',
  'src/modules/object-panel/components/ObjectPanel/Details/Overview/descriptors/gateway.tsx',
  'src/modules/object-panel/components/ObjectPanel/Details/Overview/descriptors/helm.tsx',
  'src/modules/object-panel/components/ObjectPanel/Details/Overview/descriptors/ingress.tsx',
  'src/modules/object-panel/components/ObjectPanel/Details/Overview/descriptors/networkpolicy.tsx',
  'src/modules/object-panel/components/ObjectPanel/Details/Overview/descriptors/node.tsx',
  'src/modules/object-panel/components/ObjectPanel/Details/Overview/descriptors/pod.tsx',
  'src/modules/object-panel/components/ObjectPanel/Details/Overview/descriptors/policy.tsx',
  'src/modules/object-panel/components/ObjectPanel/Details/Overview/descriptors/rbac.tsx',
  'src/modules/object-panel/components/ObjectPanel/Details/Overview/descriptors/service.tsx',
  'src/modules/object-panel/components/ObjectPanel/Details/Overview/descriptors/storage.tsx',
  'src/modules/object-panel/components/ObjectPanel/Details/Overview/descriptors/workload.tsx',
];

describe('duplicate-prone overview list keys', () => {
  it.each(duplicateProneOverviewFiles)('%s disambiguates repeated content', (file) => {
    const source = readFileSync(resolve(process.cwd(), file), 'utf8');

    expect(source).not.toMatch(
      /key=\{(?:JSON\.stringify\(|c\.name\}|ep\}|entry\}|host\}|label\}|formatPolicy\(p\)|`\$\{p\.label\}:\$\{p\.tooltip\}`|`\$\{resource\.kind\}:)/
    );
  });
});
