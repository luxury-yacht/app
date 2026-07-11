/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/shared/ExternalHostLinks.test.tsx
 *
 * Test suite for ExternalHostLinks.
 */

import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The global setup mock omits BrowserOpenURL; supply it locally so clicks work.
const browserOpenURL = vi.fn();
vi.mock('@wailsjs/runtime/runtime', () => ({
  BrowserOpenURL: (url: string) => browserOpenURL(url),
}));

import { ExternalHostLinks } from './ExternalHostLinks';

describe('ExternalHostLinks', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    browserOpenURL.mockClear();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const render = async (element: React.ReactNode) => {
    await act(async () => {
      root.render(element);
      await Promise.resolve();
    });
  };

  const schemeLinks = () =>
    Array.from(container.querySelectorAll<HTMLButtonElement>('button.overview-scheme-link'));

  it('shows the host label and one link per scheme, each opening its URL', async () => {
    await render(
      <ExternalHostLinks host="example.com" schemes={[{ scheme: 'https' }, { scheme: 'http' }]} />
    );

    expect(container.textContent).toContain('example.com');

    const links = schemeLinks();
    expect(links.map((b) => b.textContent)).toEqual(['https', 'http']);
    expect(links[0].title).toContain('https://example.com');
    expect(links[1].title).toContain('http://example.com');

    act(() => {
      links[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(browserOpenURL).toHaveBeenCalledWith('https://example.com');
  });

  it('includes a non-default port in the scheme link URL', async () => {
    await render(
      <ExternalHostLinks host="example.com" schemes={[{ scheme: 'http', port: 8080 }]} />
    );

    const links = schemeLinks();
    expect(links).toHaveLength(1);
    act(() => {
      links[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(browserOpenURL).toHaveBeenCalledWith('http://example.com:8080');
  });

  it('renders only the host label (no links) for a non-browsable wildcard host', async () => {
    await render(
      <ExternalHostLinks host="*.example.com" schemes={[{ scheme: 'https' }, { scheme: 'http' }]} />
    );

    expect(container.textContent).toBe('*.example.com');
    expect(schemeLinks()).toHaveLength(0);
  });

  it('renders only the host label when no schemes are offered', async () => {
    await render(<ExternalHostLinks host="db.internal" schemes={[]} />);

    expect(container.textContent).toBe('db.internal');
    expect(schemeLinks()).toHaveLength(0);
  });
});
