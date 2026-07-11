/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/shared/ExternalHostLinks.tsx
 *
 * Renders a hostname as a plain label followed by small per-scheme links
 * (https/http) that open the resolved URL in the system browser. Callers pass
 * the schemes (and optional ports) that are valid for the host, so the scheme
 * is always visible on the affordance and each valid scheme is offered. A host
 * that can't be opened (empty or a wildcard) shows just the label.
 */

import { BrowserOpenURL } from '@wailsjs/runtime/runtime';
import type React from 'react';
import { buildHostUrl, type UrlScheme } from './hostLink';

export interface HostSchemeLink {
  scheme: UrlScheme;
  port?: number;
}

interface ExternalHostLinksProps {
  host: string;
  /** Schemes to offer for this host, in display order. */
  schemes: HostSchemeLink[];
}

export const ExternalHostLinks: React.FC<ExternalHostLinksProps> = ({ host, schemes }) => {
  const links = schemes
    .map(({ scheme, port }) => ({ scheme, url: buildHostUrl({ host, scheme, port }) }))
    .filter((link): link is { scheme: UrlScheme; url: string } => link.url !== null);

  return (
    <span className="overview-host-links">
      <span className="overview-host-name">{host}</span>
      {links.map(({ scheme, url }) => (
        <button
          key={scheme}
          type="button"
          className="overview-scheme-link"
          title={`Open ${url} in browser`}
          onClick={() => BrowserOpenURL(url)}
        >
          {scheme}
        </button>
      ))}
    </span>
  );
};
