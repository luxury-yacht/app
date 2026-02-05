# SearchInput Component Design

A reusable text input for search/filter use cases with optional right-side icon toggle buttons for features like case-sensitivity, regex mode, etc. Works as a plain search input when no actions are provided.

## Files

- `frontend/src/shared/components/inputs/SearchInput.tsx`
- `frontend/styles/components/search-input.css` (imported from `frontend/styles/index.css`)

## Props

```tsx
interface SearchInputAction {
  id: string;              // Unique key for React rendering
  icon: React.ReactNode;   // The icon element to render
  active: boolean;         // Whether the toggle is currently on
  onToggle: () => void;    // Called when the button is clicked
  tooltip?: string;        // Optional tooltip text
}

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  actions?: SearchInputAction[];
  className?: string;      // Additional class on the wrapper
  id?: string;             // Passed to the inner input
  name?: string;           // Passed to the inner input
  autoFocus?: boolean;
  disabled?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;  // Expose inner input for focus management
}
```

### Design Decisions

- `onChange` takes a `string` (not the event) for clean consumer usage.
- `inputRef` is exposed so consumers can integrate with focus management (e.g. `useSearchShortcutTarget`).
- `type="search"` is hardcoded on the inner input. Autocomplete, spellcheck, and autocapitalize are disabled by default.
- The component does not set its own width; the consumer controls sizing via `className` or parent layout.

## Visual Structure

```
┌─────────────────────────────────────┐
│ [placeholder text...]    [Aa] [.*]  │
└─────────────────────────────────────┘
```

- Outer wrapper: `display: flex; align-items: center`. Owns the border, background, and focus ring.
- Inner input: `flex: 1`, unstyled (no border, no background). Transparent against the wrapper.
- Action buttons: small, borderless icon buttons in a right-side container. Only rendered when `actions` is provided.

## Styling

Reuses existing design tokens to match the app's input appearance:

- Border: `1px solid var(--color-border)`
- Border radius: `var(--border-radius-sm)`
- Background: `var(--color-bg)`
- Focus state (applied to wrapper): `border-color: var(--color-accent)`, `box-shadow: var(--dropdown-trigger-focus-shadow)`
- Font: `0.8rem`, `var(--color-text)`

### Action Button States

- **Inactive**: low opacity (`0.5`), `color: var(--color-text-secondary)`
- **Active**: full opacity, `color: var(--color-accent)`
- **Hover**: slight opacity increase for discoverability
- **Disabled**: inherits disabled state from the parent component

## Implementation Checklist

- [x] Create `frontend/styles/components/search-input.css` with wrapper, input, and action button styles ✅
- [x] Import `search-input.css` from `frontend/styles/index.css` ✅
- [x] Create `frontend/src/shared/components/inputs/SearchInput.tsx` with the component ✅
- [ ] Verify it renders correctly with and without actions
