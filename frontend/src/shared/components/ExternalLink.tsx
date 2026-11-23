/**
 * frontend/src/shared/components/ExternalLink.tsx
 *
 * A link to a web page. Desktop links open in the user's browser, never in the
 * app window; a browser that fails to open is reported for `source`.
 */

import { openURL } from '@core/desktop-runtime';
import type React from 'react';
import { reportOperationalError } from '@/utils/errorHandler';

interface ExternalLinkProps {
  href: string;
  /** The surface reported when the browser cannot be opened. */
  source: string;
  className?: string;
  testId?: string;
  children: React.ReactNode;
}

export const ExternalLink: React.FC<ExternalLinkProps> = ({
  href,
  source,
  className,
  testId,
  children,
}) => (
  <a
    href={href}
    className={className}
    data-testid={testId}
    onClick={(event) => {
      event.preventDefault();
      void openURL(href).catch((error) =>
        reportOperationalError(error, { source, action: 'openExternalLink' })
      );
    }}
  >
    {children}
  </a>
);
