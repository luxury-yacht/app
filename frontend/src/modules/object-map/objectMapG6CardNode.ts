import { Rect as GRect, Text as GText } from '@antv/g';
import type { DisplayObjectConfig, Group, RectStyleProps, TextStyleProps } from '@antv/g';
import { BaseNode, ExtensionCategory, register } from '@antv/g6';
import type { BaseNodeStyleProps } from '@antv/g6';
import { OBJECT_MAP_G6_CARD_NODE } from './objectMapG6Constants';

const NODE_PADDING_X = 10;
const NODE_KIND_BASELINE_Y = 18;
const NODE_NAME_BASELINE_Y = 38;
const NODE_NAMESPACE_BASELINE_Y = 56;
const NODE_CORNER_RADIUS = 6;

interface ObjectMapG6CardNodeStyleProps extends BaseNodeStyleProps {
  cardKindText?: string;
  cardNameText?: string;
  cardNamespaceText?: string;
  cardFontFamily?: string;
  cardKindFill?: string;
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
      radius: NODE_CORNER_RADIUS,
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
      x: -width / 2 + NODE_PADDING_X,
      y: -height / 2 + baselineY,
      text,
      fill,
      fontSize: 11,
      fontWeight,
      fontFamily: attributes.cardFontFamily,
      letterSpacing,
      textBaseline: 'alphabetic',
      maxLines: 1,
      wordWrap: false,
      textOverflow: '...',
    };
  }

  private drawCardText(
    attributes: Required<ObjectMapG6CardNodeStyleProps>,
    container: Group
  ): void {
    this.upsert(
      'card-kind',
      GText,
      this.getTextStyle(
        attributes,
        attributes.cardKindText,
        NODE_KIND_BASELINE_Y,
        attributes.cardKindFill,
        600,
        0.5
      ),
      container
    );
    this.upsert(
      'card-name',
      GText,
      this.getTextStyle(
        attributes,
        attributes.cardNameText,
        NODE_NAME_BASELINE_Y,
        attributes.cardNameFill,
        600
      ),
      container
    );
    this.upsert(
      'card-namespace',
      GText,
      this.getTextStyle(
        attributes,
        attributes.cardNamespaceText,
        NODE_NAMESPACE_BASELINE_Y,
        attributes.cardNamespaceFill,
        400
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
