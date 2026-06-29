import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(process.cwd(), '..');
const frontendSrc = path.join(repoRoot, 'frontend/src');

const readRepoFile = (relativePath: string): string =>
  readFileSync(path.join(repoRoot, relativePath), 'utf8');

const walkSourceFiles = (dir: string): string[] => {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...walkSourceFiles(fullPath));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry)) {
      files.push(fullPath);
    }
  }
  return files;
};

describe('resource metrics contracts', () => {
  it('keeps metric-bearing table usage cells on metric overlays and value adapters', () => {
    const overlayFiles = [
      'frontend/src/modules/cluster/components/ClusterViewNodes.tsx',
      'frontend/src/modules/namespace/components/NsViewPods.tsx',
      'frontend/src/modules/namespace/components/NsViewWorkloads.tsx',
      'frontend/src/modules/object-panel/components/ObjectPanel/Pods/PodsTab.tsx',
    ];
    const columnFiles = [
      {
        file: 'frontend/src/modules/cluster/components/ClusterViewNodes.tsx',
        helpers: ['nodeRowCpuValue', 'nodeRowMemoryValue'],
      },
      {
        file: 'frontend/src/modules/namespace/components/NsViewPods.tsx',
        helpers: ['podRowCpuValue', 'podRowMemoryValue'],
      },
      {
        file: 'frontend/src/modules/namespace/components/useWorkloadTableColumns.tsx',
        helpers: ['workloadRowCpuValue', 'workloadRowMemoryValue'],
      },
      {
        file: 'frontend/src/modules/object-panel/components/ObjectPanel/Pods/PodsTab.tsx',
        helpers: ['podRowCpuValue', 'podRowMemoryValue'],
      },
    ];

    const overlayViolations = overlayFiles
      .filter((file) => !readRepoFile(file).includes('metricOverlay'))
      .map((file) => `${file}: metricOverlay`);
    const columnViolations = columnFiles.flatMap(({ file, helpers }) => {
      const source = readRepoFile(file);
      const missing = helpers
        .map((helper) => (!source.includes(helper) ? `${file}: ${helper}` : null))
        .filter(Boolean);
      const directUsageGetter =
        /getUsage:\s*\([^)]*\)\s*=>\s*[^,\n]*\.(?:cpuUsage|memUsage|memoryUsage)\b/.test(source);
      return directUsageGetter ? [...missing, `${file}: direct usage getter`] : missing;
    });

    expect([...overlayViolations, ...columnViolations]).toEqual([]);
  });

  it('does not introduce a resource metrics cache outside core/resource-metrics', () => {
    const resourceMetricsDir = path.join(frontendSrc, 'core/resource-metrics');
    const offenders = walkSourceFiles(frontendSrc)
      .filter((file) => !file.startsWith(resourceMetricsDir))
      .filter((file) => !file.endsWith('.test.ts') && !file.endsWith('.test.tsx'))
      .filter((file) => existsSync(file))
      .filter((file) => {
        const source = readFileSync(file, 'utf8');
        return /\b(?:resourceMetricsCache|metricsUsageCache|metricUsageCache)\b/i.test(source);
      })
      .map((file) => path.relative(repoRoot, file));

    expect(offenders).toEqual([]);
  });
});
