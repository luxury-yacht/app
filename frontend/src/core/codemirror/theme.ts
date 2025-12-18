import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { tags as t } from '@lezer/highlight';
import '@styles/overrides/codemirror.css';

const monoFontStack =
  '"SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas, "Courier New", monospace';

const viewStyleSpec = {
  '&': {
    backgroundColor: 'var(--code-surface)',
    height: '100%',
    fontFamily: monoFontStack,
    fontSize: 'var(--font-size-mono)',
    color: 'var(--code-text-primary)',
    borderRadius: 'var(--border-radius-sm)',
    border: '1px solid var(--code-border)',
  },
  '&.cm-focused': {
    outline: '1px solid var(--code-focus-ring)',
    outlineOffset: '2px',
  },
  '.cm-content': {
    padding: '0.75rem 0',
    color: 'var(--code-text-primary)',
    caretColor: 'var(--code-caret)',
  },
  '.cm-line': {
    padding: '0 0.75rem',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--code-caret)',
  },
  '.cm-scroller': {
    fontFamily: monoFontStack,
    lineHeight: '1.5',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--code-surface)',
    color: 'var(--code-gutter-text)',
    borderRight: '1px solid var(--code-border)',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 0.5rem 0 0.75rem',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--code-active-gutter-bg)',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--code-active-line-bg)',
  },
  '.cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--code-selection-bg)',
  },
  // '.cm-selectionMatch': {
  //   backgroundColor: 'var(--code-selection-match-bg)',
  //   outline: '1px solid var(--code-selection-match-outline)',
  // },
  // '.cm-searchMatch': {
  //   backgroundColor: 'var(--code-selection-match-bg) !important',
  //   outline: '1px solid var(--code-selection-match-outline)',
  // },
  // '.cm-searchMatch.cm-searchMatch-selected': {
  //   backgroundColor: 'var(--code-selection-match-selected-bg) !important',
  //   outline: '1px solid var(--code-selection-match-outline)',
  // },
  // '.cm-activeLine .cm-searchMatch': {
  //   backgroundColor: 'var(--code-selection-match-bg) !important',
  //   outline: '1px solid var(--code-selection-match-outline)',
  //   boxShadow: '0 0 0 1px var(--code-selection-match-outline) inset',
  // },
  // '.cm-activeLine .cm-selectionMatch': {
  //   backgroundColor: 'var(--code-selection-match-bg)',
  //   outline: '1px solid var(--code-selection-match-outline)',
  //   boxShadow: '0 0 0 1px var(--code-selection-match-outline) inset',
  // },
  '.cm-matchingBracket, .cm-nonmatchingBracket': {
    backgroundColor: 'var(--code-matching-bracket-bg)',
    outline: '1px solid var(--code-matching-bracket-outline)',
    color: 'var(--code-text-primary)',
  },
  '.cm-panels, .cm-tooltip': {
    backgroundColor: 'var(--code-background)',
    color: 'var(--code-text-primary)',
    border: '1px solid var(--code-border)',
  },
  '.cm-panel.cm-search': {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.5rem 0.75rem',
    backgroundColor: 'var(--code-background)',
    borderBottom: '1px solid var(--code-border)',
  },
  '.cm-panel.cm-search .cm-textfield': {
    minWidth: '12rem',
    padding: '0.35rem 0.5rem',
    backgroundColor: 'var(--field-surface)',
    color: 'var(--code-text-primary)',
    border: '1px solid var(--code-border)',
    borderRadius: 'var(--border-radius-sm)',
  },
  '.cm-panel.cm-search .cm-textfield:focus': {
    outline: '1px solid var(--code-focus-ring)',
    outlineOffset: '1px',
  },
  '.cm-panel.cm-search .cm-search-primary': {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '0.5rem',
    width: '100%',
  },
  '.cm-panel.cm-search .cm-search-primary input[name="search"]': {
    flex: '1 1 16rem',
    minWidth: '12rem',
  },
  '.cm-panel.cm-search .cm-button': {
    border: '1px solid var(--code-border)',
    borderRadius: 'var(--border-radius-sm)',
    backgroundColor: 'var(--code-button-bg)',
    color: 'var(--code-text-primary)',
    padding: '0.3rem 0.75rem',
    fontSize: '0.85rem',
    cursor: 'pointer',
  },
  '.cm-panel.cm-search .cm-button:hover': {
    backgroundColor: 'var(--code-button-hover-bg)',
  },
  '.cm-panel.cm-search button[name="close"]': {
    marginLeft: 'auto',
    fontSize: '1.2rem',
    lineHeight: 1,
    padding: '0.15rem 0.45rem',
  },
  '.cm-panel.cm-search .cm-search-nav': {
    display: 'flex',
    alignItems: 'center',
    gap: '0.35rem',
  },
  '.cm-panel.cm-search .cm-search-replace, .cm-panel.cm-search .cm-search-advanced': {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '0.5rem',
    width: '100%',
  },
  '.cm-panel.cm-search .cm-search-replace': {
    marginTop: '0.25rem',
  },
  '.cm-panel.cm-search .cm-search-advanced': {
    marginTop: '0.25rem',
  },
  '.cm-panel.cm-search .cm-search-replace[hidden], .cm-panel.cm-search .cm-search-advanced[hidden]':
    {
      display: 'none',
    },
  '.cm-panel.cm-search label': {
    fontSize: '0.85rem',
    color: 'var(--code-text-muted)',
    display: 'flex',
    alignItems: 'center',
    gap: '0.25rem',
  },
  '.cm-tooltip-autocomplete ul': {
    fontFamily: monoFontStack,
  },
  '.cm-tooltip-autocomplete li[aria-selected]': {
    backgroundColor: 'var(--code-selection-bg)',
    color: 'var(--code-text-primary)',
  },
} as const;

const codeViewThemeLight = EditorView.theme(viewStyleSpec, { dark: false });
const codeViewThemeDark = EditorView.theme(viewStyleSpec, { dark: true });

const highlightSpecs = [
  {
    tag: [t.keyword, t.bool],
    color: 'var(--code-token-boolean)',
    fontWeight: '600',
  },
  {
    tag: [t.string, t.special(t.string)],
    color: 'var(--code-token-string)',
  },
  {
    tag: [t.number, t.float, t.integer],
    color: 'var(--code-token-number)',
  },
  {
    tag: [t.null, t.atom],
    color: 'var(--code-token-nullish)',
    fontStyle: 'italic',
  },
  {
    tag: [t.propertyName, t.attributeName, t.definition(t.propertyName)],
    color: 'var(--code-token-property)',
  },
  {
    tag: [t.tagName, t.typeName],
    color: 'var(--code-token-tag)',
  },
  {
    tag: [t.operator],
    color: 'var(--code-token-operator)',
  },
  {
    tag: t.punctuation,
    color: 'var(--code-token-punctuation)',
  },
  {
    tag: t.comment,
    color: 'var(--code-token-comment)',
    fontStyle: 'italic',
  },
  {
    tag: t.meta,
    color: 'var(--code-text-muted)',
  },
  {
    tag: t.invalid,
    color: 'var(--code-token-boolean)',
    textDecoration: 'wavy underline var(--code-token-invalid)',
  },
] as const;

const codeHighlightStyleLight = HighlightStyle.define(highlightSpecs, { themeType: 'light' });
const codeHighlightStyleDark = HighlightStyle.define(highlightSpecs, { themeType: 'dark' });

const codeHighlightLight = syntaxHighlighting(codeHighlightStyleLight);
const codeHighlightDark = syntaxHighlighting(codeHighlightStyleDark);

export interface CodeThemeSet {
  theme: Extension;
  highlight: Extension;
}

export const buildCodeTheme = (isDarkTheme: boolean): CodeThemeSet =>
  isDarkTheme
    ? { theme: codeViewThemeDark, highlight: codeHighlightDark }
    : { theme: codeViewThemeLight, highlight: codeHighlightLight };
