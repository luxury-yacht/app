import { describe, expect, it } from 'vitest';
import { requireReactElement } from './requireReactElement';

describe('requireReactElement', () => {
  it('returns a React element with narrowed props', () => {
    const Fixture = ({ label }: { label: string }) => <span>{label}</span>;
    const element = requireReactElement<{ label: string }>(
      <Fixture label="ready" />,
      'expected status element'
    );

    expect(element.props.label).toBe('ready');
  });

  it('throws the supplied message for a non-element node', () => {
    expect(() => requireReactElement('plain text', 'expected status element')).toThrow(
      'expected status element'
    );
  });
});
