/**
 * frontend/src/modules/object-map/objectMapCardStyle.ts
 *
 * Shared card dimensions and text limits for object-map node rendering.
 * Keep these values centralized so layout, G6 node drawing, and truncation
 * rules do not drift apart.
 */

export const OBJECT_MAP_CARD_STYLE = {
  width: 220,
  height: 64,
  borderRadius: 6,
  paddingX: 7,
  kindBadgeTopY: 7,
  kindBadgeMaxWidth: 190,
  kindBadgeMinWidth: 28,
  badgeFontSize: 10,
  kindBadgePaddingVert: 3,
  kindBadgePaddingHoriz: 4,
  badgeNameGap: 18,
  nameNamespaceGap: 16,
  metadataColumnGap: 8,
  textFontSize: 11,
  nameFontWeight: 500,
  namespaceFontWeight: 400,
  collapseBadgeWidth: 29,
  collapseBadgeHeight: 15,
  collapseBadgeRadius: 3,
  collapseBadgeRightInset: 8,
  collapseBadgeTopInset: 8,
  statusDotSize: 8.5,
  statusDotRightInset: 6,
  statusDotCenterY: 10,
} as const;
