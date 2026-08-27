import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { escapeRegExp } from './logSearch';

const styles = readFileSync(
  resolve(process.cwd(), 'src/modules/object-panel/components/ObjectPanel/Logs/LogViewer.css'),
  'utf8'
);

const ruleBody = (selector: string, stylesheet = styles): string | undefined =>
  stylesheet.match(new RegExp(`${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`))?.[1];

describe('LogViewer styles', () => {
  it('covers LogViewer styles scenarios', async () => {
    {
      // Scenario: treats regular-expression metacharacters in selectors as literal characters
      const selector = String.raw`.logs\viewer[0]`;

      expect(ruleBody(selector, `${selector} { color: red; }`)).toContain('color: red;');
    }

    {
      // Scenario: presents the resume-scrolling overlay as a neutral control
      const baseRule = ruleBody('.logs-viewer-resume-scrolling');
      const hoverRule = ruleBody('.logs-viewer-resume-scrolling:hover');

      expect(baseRule, 'Missing resume-scrolling base rule').toBeDefined();
      expect(hoverRule, 'Missing resume-scrolling hover rule').toBeDefined();
      expect(baseRule).toContain('var(--button-generic-bg)');
      expect(baseRule).toContain('var(--button-generic-text)');
      expect(hoverRule).toContain('var(--button-generic-hover)');
      expect(`${baseRule}${hoverRule}`).not.toMatch(/button-(?:action|warning)-/);
    }
  });
});
