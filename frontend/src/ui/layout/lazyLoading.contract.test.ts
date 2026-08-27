import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const valueImportPattern = (modulePath: string) => {
  const escapedModulePath = modulePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^import\\s+(?!type\\b).*from\\s+['"]${escapedModulePath}['"];?$`, 'm');
};

describe('application code-splitting boundaries', () => {
  it('loads route and object-panel implementations on demand', () => {
    const source = [
      readSource('src/ui/layout/AppLayout.tsx'),
      readSource('src/modules/object-panel/objectPanelLazyModules.ts'),
    ].join('\n');

    const deferredModules = [
      '@modules/cluster/components/ClusterOverview',
      '@modules/cluster/components/ClusterResourcesManager',
      '@modules/global/components/GlobalViews',
      '@modules/namespace/components/AllNamespacesView',
      '@modules/namespace/components/NsResourcesViews',
      '@/modules/browse/components/BrowseView',
      '@modules/object-panel/components/ObjectPanel/ObjectPanel',
    ];

    for (const modulePath of deferredModules) {
      expect(source).not.toMatch(valueImportPattern(modulePath));
      expect(source).toContain(`import('${modulePath}')`);
    }
  });

  it('defers every object-panel tab implementation', () => {
    const source = [
      readSource('src/modules/object-panel/components/ObjectPanel/ObjectPanelContent.tsx'),
      readSource('src/modules/object-panel/objectPanelLazyModules.ts'),
      readSource('src/modules/object-panel/objectPanelDetailsLazyModule.ts'),
    ].join('\n');

    const deferredModules = [
      '@modules/object-panel/components/ObjectPanel/Details/DetailsTab',
      '@modules/object-panel/components/ObjectPanel/Events/EventsTab',
      '@modules/object-panel/components/ObjectPanel/Helm/ManifestTab',
      '@modules/object-panel/components/ObjectPanel/Helm/ValuesTab',
      '@modules/object-panel/components/ObjectPanel/Jobs/JobsTab',
      '@modules/object-panel/components/ObjectPanel/Logs/LogViewer',
      '@modules/object-panel/components/ObjectPanel/Map/MapTab',
      '@modules/object-panel/components/ObjectPanel/NodeLogs/NodeLogsTab',
      '@modules/object-panel/components/ObjectPanel/Pods/PodsTab',
      '@modules/object-panel/components/ObjectPanel/Shell/ShellTab',
      '@modules/object-panel/components/ObjectPanel/Yaml/YamlTab',
    ];

    for (const modulePath of deferredModules) {
      expect(source).not.toMatch(valueImportPattern(modulePath));
      expect(source).toContain(`import('${modulePath}')`);
    }
  });

  it('warms the object-panel shell and default tab together while the app is idle', () => {
    const source = readSource('src/ui/layout/AppLayout.tsx');

    expect(source).toContain('preloadObjectPanelModules');
    expect(source).toContain('requestIdleCallback');
  });

  it('keeps React renderers out of client-side table measurement', () => {
    const source = readSource('src/shared/components/tables/hooks/useGridTableColumnMeasurer.ts');

    expect(source).not.toContain("from 'react-dom/server'");
    expect(source).not.toContain("from 'react-dom/client'");
    expect(source).not.toContain('flushSync');
    expect(source).toContain('document.createDocumentFragment()');
  });
});
