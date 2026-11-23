/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Explain/ExplainDescription.tsx
 *
 * A schema description reflowed to the panel: paragraphs, lists and examples
 * from explainDescription.ts, with `code` spans and links that open in the
 * browser.
 */

import { ExternalLink } from '@shared/components/ExternalLink';
import { Fragment } from 'react';
import {
  type DescriptionBlock,
  parseExplainDescription,
  splitInlineText,
} from './explainDescription';

export function ExplainInlineText({ text }: Readonly<{ text: string }>) {
  return (
    <>
      {splitInlineText(text).map((part) => {
        if (part.kind === 'code') {
          return <code key={part.key}>{part.text}</code>;
        }
        if (part.kind === 'link') {
          return (
            <ExternalLink
              key={part.key}
              href={part.text}
              source="ExplainTab"
              className="explain-link"
            >
              {part.text.replace(/^https?:\/\//, '')}
            </ExternalLink>
          );
        }
        return <Fragment key={part.key}>{part.text}</Fragment>;
      })}
    </>
  );
}

const renderBlock = (block: DescriptionBlock) => {
  switch (block.kind) {
    case 'list':
      return (
        <ul key={block.key} className="explain-list">
          {block.items.map((item) => (
            <li key={item.key}>
              <ExplainInlineText text={item.text} />
            </li>
          ))}
        </ul>
      );
    case 'preformatted':
      return (
        <pre key={block.key} className="explain-example">
          {block.text}
        </pre>
      );
    default:
      return (
        <p key={block.key} className="explain-paragraph">
          <ExplainInlineText text={block.text} />
        </p>
      );
  }
};

export default function ExplainDescription({ text }: Readonly<{ text: string }>) {
  const blocks = parseExplainDescription(text);
  if (blocks.length === 0) {
    return <p className="explain-empty">No description.</p>;
  }
  return <>{blocks.map(renderBlock)}</>;
}
