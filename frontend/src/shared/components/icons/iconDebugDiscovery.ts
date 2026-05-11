import type React from 'react';

type IconModule = Record<string, unknown>;

const iconModules = import.meta.glob('./*Icons.tsx', { eager: true }) as Record<string, IconModule>;
const cursorUrls = import.meta.glob('./cursors/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;
const cursorSources = import.meta.glob('./cursors/*.svg', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

const componentPreviewProps: Record<string, Record<string, unknown>> = {
  ObjectMapLegendSwatchIcon: { edgeClassName: 'icon-debug__legend-edge' },
  ShortcutArrowIcon: { direction: 'right' },
  TabOverflowIcon: { direction: 'right' },
};

export type IconDebugEntry =
  | {
      kind: 'component';
      name: string;
      file: string;
      Component: React.ElementType;
      previewProps?: Record<string, unknown>;
    }
  | {
      kind: 'asset';
      name: string;
      file: string;
      src: string;
      gridSize: string;
      defaultSize: string;
    };

const isIconComponentExport = (name: string, value: unknown): value is React.ElementType =>
  name.endsWith('Icon') && typeof value === 'function';

const formatPath = (path: string) => path.replace(/^\.\//, '');

const getCursorName = (path: string) => path.match(/\/([^/]+)\.svg$/)?.[1] ?? path;

const parseSvgSize = (source: string): { gridSize: string; defaultSize: string } => {
  const viewBox = source.match(/\bviewBox=["']([^"']+)["']/)?.[1]?.trim();
  const viewBoxParts = viewBox?.split(/\s+/).map(Number);
  const width = source.match(/\bwidth=["']([^"']+)["']/)?.[1];
  const height = source.match(/\bheight=["']([^"']+)["']/)?.[1];
  const gridSize =
    viewBoxParts && viewBoxParts.length === 4
      ? `${viewBoxParts[2]}x${viewBoxParts[3]}`
      : width && height
        ? `${width}x${height}`
        : 'unknown';

  return {
    gridSize,
    defaultSize: width && height ? `${width}x${height}` : gridSize,
  };
};

const componentEntries = Object.entries(iconModules)
  .flatMap(([path, module]) => {
    const entries: IconDebugEntry[] = [];

    Object.entries(module).forEach(([name, value]) => {
      if (!isIconComponentExport(name, value)) {
        return;
      }

      entries.push({
        kind: 'component',
        name,
        file: formatPath(path),
        Component: value,
        previewProps: componentPreviewProps[name],
      });
    });

    return entries;
  })
  .sort(
    (left, right) => left.file.localeCompare(right.file) || left.name.localeCompare(right.name)
  );

const cursorEntries = Object.entries(cursorUrls)
  .map(([path, src]) => {
    const { gridSize, defaultSize } = parseSvgSize(cursorSources[path] ?? '');
    return {
      kind: 'asset' as const,
      name: getCursorName(path),
      file: formatPath(path),
      src,
      gridSize,
      defaultSize,
    };
  })
  .sort((left, right) => left.file.localeCompare(right.file));

export const iconDebugEntries: IconDebugEntry[] = [...componentEntries, ...cursorEntries];
