/**
 * frontend/src/modules/object-map/objectMapG6Palette.ts
 *
 * Reads object-map CSS variables into the G6 palette consumed by custom
 * nodes, edges, tooltip layout, and viewport behavior.
 */

import type { ObjectMapG6Palette } from './objectMapG6Data';

export const objectMapCssVar = (styles: CSSStyleDeclaration, name: string): string =>
  styles.getPropertyValue(name).trim();

const objectMapCssColorVar = (
  element: HTMLElement,
  styles: CSSStyleDeclaration,
  name: string
): string => {
  const raw = objectMapCssVar(styles, name);
  if (!raw.includes('var(')) return raw;
  const probe = document.createElement('span');
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style.color = `var(${name})`;
  const probeRoot = element.parentElement ?? element;
  probeRoot.appendChild(probe);
  const resolved = window.getComputedStyle(probe).color.trim();
  probe.remove();
  return resolved || raw;
};

export const objectMapCssNumber = (styles: CSSStyleDeclaration, name: string): number => {
  const value = Number.parseFloat(objectMapCssVar(styles, name));
  return Number.isFinite(value) ? value : 0;
};

export const readObjectMapG6Palette = (element: HTMLElement): ObjectMapG6Palette => {
  const styles = window.getComputedStyle(element);
  return {
    accent: objectMapCssColorVar(element, styles, '--color-accent'),
    accentBg: objectMapCssColorVar(element, styles, '--color-accent-bg'),
    background: objectMapCssColorVar(element, styles, '--color-bg'),
    backgroundSecondary: objectMapCssColorVar(element, styles, '--color-bg-secondary'),
    border: objectMapCssColorVar(element, styles, '--color-border'),
    text: objectMapCssColorVar(element, styles, '--color-text'),
    textSecondary: objectMapCssColorVar(element, styles, '--color-text-secondary'),
    textTertiary: objectMapCssColorVar(element, styles, '--color-text-tertiary'),
    textInverse: objectMapCssColorVar(element, styles, '--color-text-inverse'),
    statusHealthy: objectMapCssColorVar(element, styles, '--status-healthy'),
    statusRefreshing: objectMapCssColorVar(element, styles, '--status-refreshing'),
    statusDegraded: objectMapCssColorVar(element, styles, '--status-degraded'),
    statusUnhealthy: objectMapCssColorVar(element, styles, '--status-unhealthy'),
    statusInactive: objectMapCssColorVar(element, styles, '--status-inactive'),
    edgeOwner: objectMapCssColorVar(element, styles, '--object-map-edge-owner'),
    edgeRoutes: objectMapCssColorVar(element, styles, '--object-map-edge-routes'),
    edgeSelector: objectMapCssColorVar(element, styles, '--object-map-edge-selector'),
    edgeEndpoint: objectMapCssColorVar(element, styles, '--object-map-edge-endpoint'),
    edgeVolumeBinding: objectMapCssColorVar(element, styles, '--object-map-edge-volume-binding'),
    edgeStorageClass: objectMapCssColorVar(element, styles, '--object-map-edge-storage-class'),
    edgeMounts: objectMapCssColorVar(element, styles, '--object-map-edge-mounts'),
    edgeSchedules: objectMapCssColorVar(element, styles, '--object-map-edge-schedules'),
    edgeScales: objectMapCssColorVar(element, styles, '--object-map-edge-scales'),
    edgeGrants: objectMapCssColorVar(element, styles, '--object-map-edge-grants'),
    edgeBinds: objectMapCssColorVar(element, styles, '--object-map-edge-binds'),
    edgeAggregates: objectMapCssColorVar(element, styles, '--object-map-edge-aggregates'),
    edgeFilteredPath: objectMapCssColorVar(element, styles, '--object-map-edge-filtered-path'),
    edgeUses: objectMapCssColorVar(element, styles, '--object-map-edge-uses'),
    edgeDefault: objectMapCssColorVar(element, styles, '--object-map-edge-default'),
    edgeLineWidth: objectMapCssNumber(styles, '--object-map-edge-line-width'),
    edgeHighlightedLineWidth: objectMapCssNumber(
      styles,
      '--object-map-edge-highlighted-line-width'
    ),
    edgeHoveredLineWidth: objectMapCssNumber(styles, '--object-map-edge-hovered-line-width'),
    edgeDimmedOpacity: objectMapCssNumber(styles, '--object-map-edge-dimmed-opacity'),
    edgeDash: [
      objectMapCssNumber(styles, '--object-map-edge-dash-length'),
      objectMapCssNumber(styles, '--object-map-edge-dash-gap'),
    ],
    nodeConnectedLineWidth: objectMapCssNumber(styles, '--object-map-node-connected-line-width'),
    nodeSelectedLineWidth: objectMapCssNumber(styles, '--object-map-node-selected-line-width'),
    nodeEdgeHoveredLineWidth: objectMapCssNumber(
      styles,
      '--object-map-node-edge-hovered-line-width'
    ),
    nodeDimmedBackgroundOpacity: objectMapCssNumber(
      styles,
      '--object-map-node-dimmed-background-opacity'
    ),
    nodeDimmedForegroundOpacity: objectMapCssNumber(
      styles,
      '--object-map-node-dimmed-foreground-opacity'
    ),
    tooltipMaxWidth: objectMapCssNumber(styles, '--object-map-tooltip-max-width'),
    tooltipHeight: objectMapCssNumber(styles, '--object-map-tooltip-height'),
    tooltipOffsetY: objectMapCssNumber(styles, '--object-map-tooltip-offset-y'),
    tooltipArrowWidth: objectMapCssNumber(styles, '--object-map-tooltip-arrow-width'),
    tooltipArrowHeight: objectMapCssNumber(styles, '--object-map-tooltip-arrow-height'),
    tooltipRadius: objectMapCssNumber(styles, '--object-map-tooltip-radius'),
    tooltipSourceY: objectMapCssNumber(styles, '--object-map-tooltip-source-y'),
    tooltipRelationshipY: objectMapCssNumber(styles, '--object-map-tooltip-relationship-y'),
    tooltipTargetY: objectMapCssNumber(styles, '--object-map-tooltip-target-y'),
    tooltipRelationshipBottomPadding: objectMapCssNumber(
      styles,
      '--object-map-tooltip-relationship-bottom-padding'
    ),
    tooltipHorizontalPadding: objectMapCssNumber(styles, '--object-map-tooltip-horizontal-padding'),
    tooltipBadgeGap: objectMapCssNumber(styles, '--object-map-tooltip-badge-gap'),
    tooltipBadgeMaxWidth: objectMapCssNumber(styles, '--object-map-tooltip-badge-max-width'),
    tooltipBadgeMaxFontSize: objectMapCssNumber(styles, '--object-map-tooltip-badge-max-font-size'),
    tooltipBadgePaddingX: objectMapCssNumber(styles, '--object-map-tooltip-badge-padding-x'),
    tooltipBadgePaddingY: objectMapCssNumber(styles, '--object-map-tooltip-badge-padding-y'),
    tooltipNameFontSize: objectMapCssNumber(styles, '--object-map-tooltip-name-font-size'),
    tooltipNameFontWeight: objectMapCssNumber(styles, '--object-map-tooltip-name-font-weight'),
    tooltipRelationshipFontSize: objectMapCssNumber(
      styles,
      '--object-map-tooltip-relationship-font-size'
    ),
    tooltipRelationshipFontWeight: objectMapCssNumber(
      styles,
      '--object-map-tooltip-relationship-font-weight'
    ),
    fitViewPadding: objectMapCssNumber(styles, '--object-map-fit-view-padding'),
    fullOpacity: objectMapCssNumber(styles, '--object-map-full-opacity'),
    fontFamily: styles.fontFamily,
  };
};

export const sameObjectMapG6Palette = (
  previous: ObjectMapG6Palette | null,
  next: ObjectMapG6Palette
): boolean => {
  if (!previous) return false;
  return (Object.keys(next) as Array<keyof ObjectMapG6Palette>).every((key) => {
    const previousValue = previous[key];
    const nextValue = next[key];
    if (Array.isArray(previousValue) && Array.isArray(nextValue)) {
      return (
        previousValue.length === nextValue.length &&
        previousValue.every((value, index) => value === nextValue[index])
      );
    }
    return previousValue === nextValue;
  });
};
