import { Rect as GRect, Text as GText } from '@antv/g';
import type { DisplayObjectConfig, Group, RectStyleProps, TextStyleProps } from '@antv/g';
import { BaseNode, ExtensionCategory, register } from '@antv/g6';
import type { BaseNodeStyleProps } from '@antv/g6';
import { OBJECT_MAP_CARD_STYLE } from './objectMapCardStyle';
import { OBJECT_MAP_G6_CARD_NODE } from './objectMapG6Constants';

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
  cardNameText?: string;
  cardNamespaceText?: string;
  cardFontFamily?: string;
  cardNameFill?: string;
  cardNamespaceFill?: string;
}

class ObjectMapG6CardNode extends BaseNode<ObjectMapG6CardNodeStyleProps> {
  constructor(options: DisplayObjectConfig<ObjectMapG6CardNodeStyleProps>) {
    super(options);
  }

  protected getKeyStyle(attributes: Required<ObjectMapG6CardNodeStyleProps>): RectStyleProps {
    const [width, height] = this.getSize(attributes);
    return {
      ...super.getKeyStyle(attributes),
      width,
      height,
      x: -width / 2,
      y: -height / 2,
      radius: OBJECT_MAP_CARD_STYLE.borderRadius,
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
    letterSpacing = 0
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
      wordWrapWidth: width - OBJECT_MAP_CARD_STYLE.paddingX * 2,
      textOverflow: '...',
    };
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
      },
      container
    );
  }

  private drawCardText(
    attributes: Required<ObjectMapG6CardNodeStyleProps>,
    container: Group
  ): void {
    const baselines = this.getCardTextBaselines(attributes);
    this.drawKindBadge(attributes, container);
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
    this.upsert(
      'card-namespace',
      GText,
      this.getTextStyle(
        attributes,
        attributes.cardNamespaceText,
        baselines.namespaceBaselineY,
        attributes.cardNamespaceFill,
        OBJECT_MAP_CARD_STYLE.namespaceFontWeight
      ),
      container
    );
  }

  render(attributes = this.parsedAttributes, container = this): void {
    super.render(attributes, container);
    this.drawCardText(attributes, container);
  }
}

let isRegistered = false;

export const ensureObjectMapG6CardNodeRegistered = (): void => {
  if (isRegistered) return;
  register(ExtensionCategory.NODE, OBJECT_MAP_G6_CARD_NODE, ObjectMapG6CardNode);
  isRegistered = true;
};
