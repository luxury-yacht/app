import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(
  resolve(process.cwd(), 'src/modules/object-panel/components/ObjectPanel/Logs/LogViewer.css'),
  'utf8'
);

const ruleBody = (selector: string): string | undefined =>
  styles.match(new RegExp(`${selector.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`))?.[1];

describe('LogViewer styles', () => {
  it('presents the resume-scrolling overlay as a neutral control', () => {
    const baseRule = ruleBody('.logs-viewer-resume-scrolling');
    const hoverRule = ruleBody('.logs-viewer-resume-scrolling:hover');

    expect(baseRule, 'Missing resume-scrolling base rule').toBeDefined();
    expect(hoverRule, 'Missing resume-scrolling hover rule').toBeDefined();
    expect(baseRule).toContain('var(--button-generic-bg)');
    expect(baseRule).toContain('var(--button-generic-text)');
    expect(hoverRule).toContain('var(--button-generic-hover)');
    expect(`${baseRule}${hoverRule}`).not.toMatch(/button-(?:action|warning)-/);
  });
});
