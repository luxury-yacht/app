/**
 * frontend/src/modules/object-map/objectMapG6CardNode.ts
 *
 * Custom G6 node implementation for object-map cards, including kind badges,
 * object names, namespaces, and collapse/expand badges.
 */

import type { CircleStyleProps, Group, RectStyleProps, TextStyleProps } from '@antv/g';
import { Circle as GCircle, Rect as GRect, Text as GText } from '@antv/g';
import type { BaseNodeStyleProps } from '@antv/g6';
import { BaseNode, ExtensionCategory, register } from '@antv/g6';
import { OBJECT_MAP_CARD_STYLE } from './objectMapCardStyle';
import { OBJECT_MAP_G6_CARD_NODE, type ObjectMapG6CardDetailLevel } from './objectMapG6Constants';

let measureContext: CanvasRenderingContext2D | null = null;

const measureTextWidth = (
  text: string,
  fontFamily: string,
  fontSize: number,
  fontWeight: TextStyleProps['fontWeight'],
  letterSpacing: number
): number => {
  if (typeof document === 'undefined') {
    return text.length * fontSize * 0.62 + Math.max(0, text.length - 1) * letterSpacing;
  }
  if (!measureContext) {
    measureContext = document.createElement('canvas').getContext('2d');
  }
  if (!measureContext) {
    return text.length * fontSize * 0.62 + Math.max(0, text.length - 1) * letterSpacing;
  }
  measureContext.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  return measureContext.measureText(text).width + Math.max(0, text.length - 1) * letterSpacing;
};

interface ObjectMapG6CardNodeStyleProps extends BaseNodeStyleProps {
  cardDetailLevel?: ObjectMapG6CardDetailLevel;
  cardKindBadgeText?: string;
  cardKindBadgeFill?: string;
  cardKindBadgeTextFill?: string;
  cardKindBadgeStroke?: string;
  cardKindBadgeBorderWidth?: number;
  cardKindBadgeRadius?: number;
  cardKindBadgeFontSize?: number;
  cardKindBadgeFontWeight?: TextStyleProps['fontWeight'];
  cardKindBadgeLetterSpacing?: number;
  cardKindBadgePaddingX?: number;
  cardKindBadgePaddingY?: number;
  cardBackgroundOpacity?: number;
  cardForegroundOpacity?: number;
  cardCollapseBadgeText?: string;
  cardCollapseBadgeFill?: string;
  cardCollapseBadgeTextFill?: string;
  cardCollapseBadgeStroke?: string;
  cardNameText?: string;
  cardNamespaceText?: string;
  cardAgeText?: string;
  cardStatusText?: string;
  cardStatusReason?: string;
  cardStatusFill?: string;
  cardStatusStroke?: string;
  cardFontFamily?: string;
  cardNameFill?: string;
  cardNamespaceFill?: string;
  cardAgeFill?: string;
}

class ObjectMapG6CardNode extends BaseNode<ObjectMapG6CardNodeStyleProps> {
  private getBackgroundOpacity(attributes: Required<ObjectMapG6CardNodeStyleProps>): number {
    return attributes.cardBackgroundOpacity ?? 1;
  }

  private getForegroundOpacity(attributes: Required<ObjectMapG6CardNodeStyleProps>): number {
    return attributes.cardForegroundOpacity ?? 1;
  }

  protected getKeyStyle(attributes: Required<ObjectMapG6CardNodeStyleProps>): RectStyleProps {
    const [width, height] = this.getSize(attributes);
    const isDot = attributes.cardDetailLevel === 'dot';
    const dotSize = OBJECT_MAP_CARD_STYLE.statusDotSize * 1.5;
    return {
      ...super.getKeyStyle(attributes),
      width: isDot ? dotSize : width,
      height: isDot ? dotSize : height,
      x: isDot ? -dotSize / 2 : -width / 2,
      y: isDot ? -dotSize / 2 : -height / 2,
      radius: isDot ? dotSize / 2 : OBJECT_MAP_CARD_STYLE.borderRadius,
      fill: isDot ? attributes.cardKindBadgeFill : attributes.fill,
      fillOpacity: isDot
        ? this.getForegroundOpacity(attributes)
        : this.getBackgroundOpacity(attributes),
      strokeOpacity: this.getForegroundOpacity(attributes),
    };
  }

  protected drawKeyShape(
    attributes: Required<ObjectMapG6CardNodeStyleProps>,
    container: Group
  ): GRect | undefined {
    return this.upsert('key', GRect, this.getKeyStyle(attributes), container);
  }

  private getTextStyle(
    attributes: Required<ObjectMapG6CardNodeStyleProps>,
    text: string,
    baselineY: number,
    fill: string,
    fontWeight: TextStyleProps['fontWeight'],
    letterSpacing = 0,
    wordWrapWidth?: number
  ): TextStyleProps {
    const [width, height] = this.getSize(attributes);
    return {
      x: -width / 2 + OBJECT_MAP_CARD_STYLE.paddingX,
      y: -height / 2 + baselineY,
      text,
      fill,
      fontSize: OBJECT_MAP_CARD_STYLE.textFontSize,
      fontWeight,
      fontFamily: attributes.cardFontFamily,
      letterSpacing,
      textBaseline: 'alphabetic',
      maxLines: 1,
      wordWrap: true,
      wordWrapWidth: wordWrapWidth ?? width - OBJECT_MAP_CARD_STYLE.paddingX * 2,
      textOverflow: '...',
      opacity: this.getForegroundOpacity(attributes),
    };
  }

  private getAgeTextStyle(
    attributes: Required<ObjectMapG6CardNodeStyleProps>,
    baselineY: number
  ): TextStyleProps {
    const [width, height] = this.getSize(attributes);
    return {
      x: width / 2 - OBJECT_MAP_CARD_STYLE.paddingX,
      y: -height / 2 + baselineY,
      text: attributes.cardAgeText,
      fill: attributes.cardAgeFill,
      fontSize: OBJECT_MAP_CARD_STYLE.textFontSize,
      fontWeight: OBJECT_MAP_CARD_STYLE.namespaceFontWeight,
      fontFamily: attributes.cardFontFamily,
      textAlign: 'right',
      textBaseline: 'alphabetic',
      maxLines: 1,
      opacity: this.getForegroundOpacity(attributes),
    };
  }

  private getNamespaceTextWidth(attributes: Required<ObjectMapG6CardNodeStyleProps>): number {
    const [width] = this.getSize(attributes);
    const fullWidth = width - OBJECT_MAP_CARD_STYLE.paddingX * 2;
    if (!attributes.cardAgeText) {
      return fullWidth;
    }
    const ageWidth = measureTextWidth(
      attributes.cardAgeText,
      attributes.cardFontFamily,
      OBJECT_MAP_CARD_STYLE.textFontSize,
      OBJECT_MAP_CARD_STYLE.namespaceFontWeight,
      0
    );
    return Math.max(1, fullWidth - ageWidth - OBJECT_MAP_CARD_STYLE.metadataColumnGap);
  }

  private getBadgeMetrics(attributes: Required<ObjectMapG6CardNodeStyleProps>) {
    const [cardWidth, cardHeight] = this.getSize(attributes);
    const borderWidth = attributes.cardKindBadgeBorderWidth;
    const paddingX = OBJECT_MAP_CARD_STYLE.kindBadgePaddingHoriz;
    const paddingY = OBJECT_MAP_CARD_STYLE.kindBadgePaddingVert;
    const fontSize = OBJECT_MAP_CARD_STYLE.badgeFontSize;
    const textWidth = measureTextWidth(
      attributes.cardKindBadgeText,
      attributes.cardFontFamily,
      fontSize,
      attributes.cardKindBadgeFontWeight,
      attributes.cardKindBadgeLetterSpacing
    );
    const maxWidth = Math.min(
      OBJECT_MAP_CARD_STYLE.kindBadgeMaxWidth,
      cardWidth - OBJECT_MAP_CARD_STYLE.paddingX * 2
    );
    const maxTextWidth = Math.max(1, maxWidth - paddingX * 2 - borderWidth * 2);
    const width = Math.max(
      OBJECT_MAP_CARD_STYLE.kindBadgeMinWidth,
      Math.min(maxWidth, Math.ceil(textWidth + paddingX * 2 + borderWidth * 2))
    );
    const height = Math.ceil(fontSize + paddingY * 2 + borderWidth * 2);
    return {
      x: -cardWidth / 2 + OBJECT_MAP_CARD_STYLE.paddingX,
      y: -cardHeight / 2 + OBJECT_MAP_CARD_STYLE.kindBadgeTopY,
      width,
      height,
      textX: -cardWidth / 2 + OBJECT_MAP_CARD_STYLE.paddingX + paddingX + borderWidth,
      textY: -cardHeight / 2 + OBJECT_MAP_CARD_STYLE.kindBadgeTopY + height / 2,
      textWidth: maxTextWidth,
    };
  }

  private getCardTextBaselines(attributes: Required<ObjectMapG6CardNodeStyleProps>) {
    const [, cardHeight] = this.getSize(attributes);
    const badge = this.getBadgeMetrics(attributes);
    const nameBaselineY =
      badge.y + badge.height + OBJECT_MAP_CARD_STYLE.badgeNameGap - -cardHeight / 2;
    return {
      nameBaselineY,
      namespaceBaselineY: nameBaselineY + OBJECT_MAP_CARD_STYLE.nameNamespaceGap,
    };
  }

  private drawKindBadge(
    attributes: Required<ObjectMapG6CardNodeStyleProps>,
    container: Group
  ): void {
    const metrics = this.getBadgeMetrics(attributes);
    const backgroundOpacity = this.getBackgroundOpacity(attributes);
    const foregroundOpacity = this.getForegroundOpacity(attributes);
    this.upsert(
      'card-kind-badge-bg',
      GRect,
      {
        x: metrics.x,
        y: metrics.y,
        width: metrics.width,
        height: metrics.height,
        radius: attributes.cardKindBadgeRadius,
        fill: attributes.cardKindBadgeFill,
        stroke: attributes.cardKindBadgeStroke,
        lineWidth: attributes.cardKindBadgeBorderWidth,
        fillOpacity: backgroundOpacity,
        strokeOpacity: foregroundOpacity,
      },
      container
    );
    this.upsert(
      'card-kind-badge-text',
      GText,
      {
        x: metrics.textX,
        y: metrics.textY,
        text: attributes.cardKindBadgeText,
        fill: attributes.cardKindBadgeTextFill,
        fontSize: OBJECT_MAP_CARD_STYLE.badgeFontSize,
        fontWeight: attributes.cardKindBadgeFontWeight,
        fontFamily: attributes.cardFontFamily,
        letterSpacing: attributes.cardKindBadgeLetterSpacing,
        textBaseline: 'middle',
        maxLines: 1,
        wordWrap: true,
        wordWrapWidth: metrics.textWidth,
        textOverflow: '...',
        opacity: foregroundOpacity,
      },
      container
    );
  }

  private getCollapseBadgeMetrics(attributes: Required<ObjectMapG6CardNodeStyleProps>) {
    const [cardWidth, cardHeight] = this.getSize(attributes);
    const width = OBJECT_MAP_CARD_STYLE.collapseBadgeWidth;
    const height = OBJECT_MAP_CARD_STYLE.collapseBadgeHeight;
    const x = cardWidth / 2 - OBJECT_MAP_CARD_STYLE.collapseBadgeRightInset - width;
    const y = -cardHeight / 2 + OBJECT_MAP_CARD_STYLE.collapseBadgeTopInset;
    return {
      x,
      y,
      width,
      height,
      textX: x + width / 2,
      textY: y + height / 2,
    };
  }

  private getStatusDotStyle(
    attributes: Required<ObjectMapG6CardNodeStyleProps>
  ): CircleStyleProps | false {
    if (!attributes.cardStatusFill) {
      return false;
    }
    const [cardWidth, cardHeight] = this.getSize(attributes);
    const radius = OBJECT_MAP_CARD_STYLE.statusDotSize / 2;
    const x = cardWidth / 2 - OBJECT_MAP_CARD_STYLE.statusDotRightInset - radius;
    const y = -cardHeight / 2 + OBJECT_MAP_CARD_STYLE.statusDotCenterY;
    return {
      cx: x,
      cy: y,
      r: radius,
      fill: attributes.cardStatusFill,
      stroke: attributes.cardStatusStroke,
      lineWidth: 1.5,
      fillOpacity: this.getForegroundOpacity(attributes),
      strokeOpacity: this.getBackgroundOpacity(attributes),
    };
  }

  private drawStatusDot(
    attributes: Required<ObjectMapG6CardNodeStyleProps>,
    container: Group
  ): void {
    this.upsert('card-status-dot', GCircle, this.getStatusDotStyle(attributes), container);
  }

  private drawCollapseBadge(
    attributes: Required<ObjectMapG6CardNodeStyleProps>,
    container: Group
  ): void {
    if (!attributes.cardCollapseBadgeText) {
      this.upsert('badge-expand-bg', GRect, false, container);
      this.upsert('badge-expand-label', GText, false, container);
      return;
    }

    const metrics = this.getCollapseBadgeMetrics(attributes);
    const backgroundOpacity = this.getBackgroundOpacity(attributes);
    const foregroundOpacity = this.getForegroundOpacity(attributes);
    this.upsert(
      'badge-expand-bg',
      GRect,
      {
        x: metrics.x,
        y: metrics.y,
        width: metrics.width,
        height: metrics.height,
        radius: OBJECT_MAP_CARD_STYLE.collapseBadgeRadius,
        fill: attributes.cardCollapseBadgeFill,
        stroke: attributes.cardCollapseBadgeStroke,
        fillOpacity: backgroundOpacity,
        strokeOpacity: foregroundOpacity,
      },
      container
    );
    this.upsert(
      'badge-expand-label',
      GText,
      {
        x: metrics.textX,
        y: metrics.textY,
        text: attributes.cardCollapseBadgeText,
        fill: attributes.cardCollapseBadgeTextFill,
        fontSize: OBJECT_MAP_CARD_STYLE.textFontSize,
        fontWeight: 700,
        fontFamily: attributes.cardFontFamily,
        textAlign: 'center',
        textBaseline: 'middle',
        maxLines: 1,
        opacity: foregroundOpacity,
      },
      container
    );
  }

  private drawCardText(
    attributes: Required<ObjectMapG6CardNodeStyleProps>,
    container: Group
  ): void {
    const detailLevel = attributes.cardDetailLevel;
    if (detailLevel === 'dot') {
      this.upsert('card-kind-badge-bg', GRect, false, container);
      this.upsert('card-kind-badge-text', GText, false, container);
      this.upsert('badge-expand-bg', GRect, false, container);
      this.upsert('badge-expand-label', GText, false, container);
      this.upsert('card-status-dot', GCircle, false, container);
      this.upsert('card-name', GText, false, container);
      this.upsert('card-namespace', GText, false, container);
      this.upsert('card-age', GText, false, container);
      return;
    }

    const baselines = this.getCardTextBaselines(attributes);
    if (detailLevel === 'minimal') {
      const [cardWidth, cardHeight] = this.getSize(attributes);
      this.upsert(
        'card-kind-badge-bg',
        GRect,
        {
          x: -cardWidth / 2 + OBJECT_MAP_CARD_STYLE.paddingX,
          y: -cardHeight / 2 + OBJECT_MAP_CARD_STYLE.kindBadgeTopY,
          width: cardWidth - OBJECT_MAP_CARD_STYLE.paddingX * 2,
          height: OBJECT_MAP_CARD_STYLE.badgeFontSize,
          radius: attributes.cardKindBadgeRadius,
          fill: attributes.cardKindBadgeFill,
          stroke: attributes.cardKindBadgeStroke,
          lineWidth: attributes.cardKindBadgeBorderWidth,
          fillOpacity: this.getBackgroundOpacity(attributes),
          strokeOpacity: this.getForegroundOpacity(attributes),
        },
        container
      );
      this.upsert('card-kind-badge-text', GText, false, container);
    } else {
      this.drawKindBadge(attributes, container);
    }
    this.drawCollapseBadge(attributes, container);
    this.drawStatusDot(attributes, container);
    if (detailLevel !== 'minimal') {
      this.upsert(
        'card-name',
        GText,
        this.getTextStyle(
          attributes,
          attributes.cardNameText,
          baselines.nameBaselineY,
          attributes.cardNameFill,
          OBJECT_MAP_CARD_STYLE.nameFontWeight
        ),
        container
      );
    } else {
      this.upsert('card-name', GText, false, container);
    }
    if (detailLevel === 'full') {
      this.upsert(
        'card-namespace',
        GText,
        this.getTextStyle(
          attributes,
          attributes.cardNamespaceText,
          baselines.namespaceBaselineY,
          attributes.cardNamespaceFill,
          OBJECT_MAP_CARD_STYLE.namespaceFontWeight,
          0,
          this.getNamespaceTextWidth(attributes)
        ),
        container
      );
      if (attributes.cardAgeText) {
        this.upsert(
          'card-age',
          GText,
          this.getAgeTextStyle(attributes, baselines.namespaceBaselineY),
          container
        );
      } else {
        this.upsert('card-age', GText, false, container);
      }
    } else {
      this.upsert('card-namespace', GText, false, container);
      this.upsert('card-age', GText, false, container);
    }
  }

  render(attributes = this.parsedAttributes, container = this): void {
    super.render(attributes, container);
    this.drawCardText(attributes, container);
  }
}

let isRegistered = false;

export const ensureObjectMapG6CardNodeRegistered = (): void => {
  if (isRegistered) {
    return;
  }
  register(ExtensionCategory.NODE, OBJECT_MAP_G6_CARD_NODE, ObjectMapG6CardNode);
  isRegistered = true;
};
