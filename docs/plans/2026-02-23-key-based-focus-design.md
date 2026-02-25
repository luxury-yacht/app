# Key-Based Focus Tracking + Stable ARIA Row IDs — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix GridTable focus tracking so focus follows the logical row (by key) across data reorders, and fix the lossy ARIA row ID sanitizer to prevent duplicate DOM IDs.

**Architecture:** Store `focusedRowKey` as primary state, derive `focusedRowIndex` via `useMemo`. Add a `getStableRowId` utility that hex-encodes special characters for collision-free DOM IDs. Update all consumers to use key-based API.

**Tech Stack:** React 18 hooks, TypeScript, Vitest

---

### Task 1: Add `getStableRowId` utility and tests

**Files:**
- Modify: `frontend/src/shared/components/tables/GridTable.utils.ts:91` (after `buildClusterScopedKey`)
- Modify: `frontend/src/shared/components/tables/GridTable.utils.test.tsx` (add new describe block)

**Step 1: Write the failing tests**

Add to `GridTable.utils.test.tsx`:

```typescript
import {
  // ... existing imports ...
  getStableRowId,
} from '@shared/components/tables/GridTable.utils';

// ... at the end of the file, inside the outer describe block:

describe('getStableRowId', () => {
  it('returns a prefixed id for simple keys', () => {
    expect(getStableRowId('row-a')).toBe('gridtable-row-row-a');
  });

  it('hex-encodes special characters to preserve uniqueness', () => {
    const idSlash = getStableRowId('a/b');
    const idColon = getStableRowId('a:b');
    const idPipe = getStableRowId('a|b');

    // All three must be different
    expect(idSlash).not.toBe(idColon);
    expect(idSlash).not.toBe(idPipe);
    expect(idColon).not.toBe(idPipe);
  });

  it('handles cluster-scoped keys with pipe separator', () => {
    const id = getStableRowId('cluster-1|pod:default/nginx');
    expect(id).toMatch(/^gridtable-row-/);
    // Should not contain raw special chars that would break DOM id usage
    expect(id).toMatch(/^[a-zA-Z][a-zA-Z0-9_-]*$/);
  });

  it('produces identical output for identical input', () => {
    const key = 'cluster-1|pod:ns/name';
    expect(getStableRowId(key)).toBe(getStableRowId(key));
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx vitest run src/shared/components/tables/GridTable.utils.test.tsx`
Expected: FAIL — `getStableRowId` is not exported

**Step 3: Implement `getStableRowId`**

Add to `GridTable.utils.ts` after `buildClusterScopedKey` (after line 91):

```typescript
// Deterministic, collision-free DOM id from a row key.
// Hex-encodes characters outside [a-zA-Z0-9_-] so distinct keys always
// produce distinct IDs — unlike the old lossy replace-with-underscore approach.
export const getStableRowId = (rowKey: string): string => {
  const safe = rowKey.replace(
    /[^a-zA-Z0-9_-]/g,
    (ch) => '_x' + ch.charCodeAt(0).toString(16) + '_'
  );
  return `gridtable-row-${safe}`;
};
```

**Step 4: Run tests to verify they pass**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx vitest run src/shared/components/tables/GridTable.utils.test.tsx`
Expected: PASS

---

### Task 2: Wire `getStableRowId` into row renderer and body

**Files:**
- Modify: `frontend/src/shared/components/tables/hooks/useGridTableRowRenderer.tsx:100`
- Modify: `frontend/src/shared/components/tables/GridTableBody.tsx:173-174`

**Step 1: Update `useGridTableRowRenderer.tsx`**

At the top of the file, add import:
```typescript
import { getStableRowId } from '@shared/components/tables/GridTable.utils';
```

Replace line 100:
```typescript
// Before:
const rowId = `gridtable-row-${rowKey.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
// After:
const rowId = getStableRowId(rowKey);
```

**Step 2: Update `GridTableBody.tsx`**

At the top of the file, add import:
```typescript
import { getStableRowId } from '@shared/components/tables/GridTable.utils';
```

Replace lines 173-174:
```typescript
// Before:
aria-activedescendant={
  focusedRowKey ? `gridtable-row-${focusedRowKey.replace(/[^a-zA-Z0-9_-]/g, '_')}` : undefined
}
// After:
aria-activedescendant={focusedRowKey ? getStableRowId(focusedRowKey) : undefined}
```

**Step 3: Run existing tests to verify no regressions**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx vitest run src/shared/components/tables/`
Expected: All existing tests PASS

---

### Task 3: Rewrite `useGridTableFocusNavigation` to key-based tracking

**Files:**
- Modify: `frontend/src/shared/components/tables/hooks/useGridTableFocusNavigation.ts`

**Step 1: Update the result type**

Replace `FocusNavigationResult<T>`:

```typescript
type FocusNavigationResult<T> = {
  focusedRowIndex: number | null;
  focusedRowKey: string | null;
  setFocusedRowKey: React.Dispatch<React.SetStateAction<string | null>>;
  focusByIndex: (index: number) => void;
  isWrapperFocused: boolean;
  isShortcutsSuppressed: boolean;
  shortcutsActive: boolean;
  pendingPointerFocusRef: RefObject<boolean>;
  lastNavigationMethodRef: RefObject<'pointer' | 'keyboard'>;
  handleWrapperFocus: (event: React.FocusEvent<HTMLDivElement>) => void;
  handleWrapperBlur: (event: React.FocusEvent<HTMLDivElement>) => void;
  handleRowActivation: (item: T, index: number, source: 'pointer' | 'keyboard') => void;
  handleRowClick: (item: T, index: number, event: React.MouseEvent) => void;
  getRowClassNameWithFocus: (item: T, index: number) => string;
};
```

Removed: `setFocusedRowIndex`, `clampRowIndex`.
Added: `setFocusedRowKey`, `focusByIndex`.

**Step 2: Replace state and derivation**

Replace lines 58 and 62-77 with:

```typescript
const [focusedRowKey, setFocusedRowKey] = useState<string | null>(null);

// Derive index from key — the key is the source of truth.
// When data reorders, the derived index automatically follows the key.
// When the key disappears (deleted/filtered), index resolves to null.
const focusedRowIndex = useMemo(() => {
  if (focusedRowKey == null) return null;
  const idx = tableData.findIndex((item, i) => keyExtractor(item, i) === focusedRowKey);
  return idx === -1 ? null : idx;
}, [focusedRowKey, keyExtractor, tableData]);

// Helper to set focus by index — resolves to key immediately.
const focusByIndex = useCallback(
  (index: number) => {
    if (index < 0 || index >= tableData.length) {
      setFocusedRowKey(null);
      return;
    }
    setFocusedRowKey(keyExtractor(tableData[index], index));
  },
  [keyExtractor, tableData]
);
```

Remove the `clampRowIndex` callback entirely.

**Step 3: Update `handleWrapperFocus`**

Replace the callback body:

```typescript
const handleWrapperFocus = useCallback(
  (event: React.FocusEvent<HTMLDivElement>) => {
    const shouldSuppress = isShortcutOptOutTarget(event.target);
    setIsWrapperFocused(true);
    setIsShortcutsSuppressed(shouldSuppress);

    if (shouldSuppress) {
      setFocusedRowKey(null);
      return;
    }

    if (pendingPointerFocusRef.current) {
      pendingPointerFocusRef.current = false;
      return;
    }

    if (tableData.length > 0) {
      lastNavigationMethodRef.current = 'keyboard';
      setFocusedRowKey((prev) => {
        if (prev != null) {
          // Verify the key still exists in data
          const stillExists = tableData.some((item, i) => keyExtractor(item, i) === prev);
          if (stillExists) return prev;
        }
        // Default to first row
        return keyExtractor(tableData[0], 0);
      });
    }
  },
  [isShortcutOptOutTarget, keyExtractor, tableData]
);
```

**Step 4: Update `handleRowActivation`**

```typescript
const handleRowActivation = useCallback(
  (item: T, index: number, source: 'pointer' | 'keyboard') => {
    wrapperRef.current?.focus();
    lastNavigationMethodRef.current = source;
    const key = keyExtractor(item, index);
    setFocusedRowKey(key);

    if (source === 'keyboard') {
      onRowClick?.(item);
    }
  },
  [keyExtractor, onRowClick, wrapperRef]
);
```

**Step 5: Replace the data-change clamping effect (lines 173-197)**

Replace with a hover-sync effect that fires when the derived index changes:

```typescript
useEffect(() => {
  if (focusedRowIndex == null || focusedRowKey == null) {
    return;
  }
  const escapedKey =
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(focusedRowKey)
      : focusedRowKey;
  const currentRow = wrapperRef.current?.querySelector<HTMLElement>(
    `.gridtable-row[data-row-key="${escapedKey}"]`
  );
  if (currentRow && currentRow instanceof HTMLDivElement) {
    updateHoverForElement(currentRow);
  }
}, [focusedRowIndex, focusedRowKey, updateHoverForElement, wrapperRef]);
```

**Step 6: Update the return object**

```typescript
return {
  focusedRowIndex,
  focusedRowKey,
  setFocusedRowKey,
  focusByIndex,
  isWrapperFocused,
  isShortcutsSuppressed,
  shortcutsActive,
  pendingPointerFocusRef,
  lastNavigationMethodRef,
  handleWrapperFocus,
  handleWrapperBlur,
  handleRowActivation,
  handleRowClick,
  getRowClassNameWithFocus,
};
```

**Step 7: Verify the file compiles**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx tsc --noEmit --pretty 2>&1 | head -50`
Expected: TypeScript errors in `GridTable.tsx`, `GridTableKeys.ts`, and
`useGridTableContextMenuWiring.tsx` — those are expected and fixed in the next tasks.

---

### Task 4: Update `GridTable.tsx` consumers

**Files:**
- Modify: `frontend/src/shared/components/tables/GridTable.tsx`

**Step 1: Update the destructured result from `useGridTableFocusNavigation`**

Replace (lines 239-261):
```typescript
const {
  focusedRowIndex,
  focusedRowKey,
  setFocusedRowKey,
  focusByIndex,
  isWrapperFocused,
  shortcutsActive,
  lastNavigationMethodRef,
  handleWrapperFocus,
  handleWrapperBlur,
  handleRowActivation,
  handleRowClick,
  getRowClassNameWithFocus,
} = useGridTableFocusNavigation<T>({
  tableData,
  keyExtractor,
  onRowClick,
  isShortcutOptOutTarget,
  wrapperRef,
  updateHoverForElement,
  getRowClassName,
  shouldIgnoreRowClick,
});
```

**Step 2: Update `handleRowMouseEnterWithReset`**

Replace `setFocusedRowIndex(null)` with `setFocusedRowKey(null)` (line 289).
Update the dependency array: replace `setFocusedRowIndex` with `setFocusedRowKey`.

**Step 3: Update `moveSelectionByDelta`**

```typescript
const moveSelectionByDelta = useCallback(
  (delta: number) => {
    if (tableData.length === 0) {
      return false;
    }
    lastNavigationMethodRef.current = 'keyboard';
    // Resolve current position from derived index, apply delta, store new key.
    const base = focusedRowIndex == null ? (delta > 0 ? -1 : tableData.length) : focusedRowIndex;
    const next = Math.min(Math.max(base + delta, 0), tableData.length - 1);
    focusByIndex(next);
    return true;
  },
  [focusByIndex, focusedRowIndex, tableData.length, lastNavigationMethodRef]
);
```

**Step 4: Update `jumpToIndex`**

```typescript
const jumpToIndex = useCallback(
  (index: number) => {
    if (tableData.length === 0) {
      return false;
    }
    const clamped = Math.min(Math.max(index, 0), tableData.length - 1);
    lastNavigationMethodRef.current = 'keyboard';
    focusByIndex(clamped);
    return true;
  },
  [focusByIndex, tableData.length, lastNavigationMethodRef]
);
```

**Step 5: Update `useGridTableKeyboardScopes` call**

Replace `focusedRowIndex` with `focusedRowKey` in the props passed to the hook
(line 354).

**Step 6: Update `activateFocusedRow`**

No logic change needed — it already uses `focusedRowIndex` (now derived) to look up
the item. Just verify the dependency array is correct:

```typescript
const activateFocusedRow = useCallback(() => {
  if (focusedRowIndex == null || focusedRowIndex < 0 || focusedRowIndex >= tableData.length) {
    return false;
  }
  const item = tableData[focusedRowIndex];
  onRowClick?.(item);
  return true;
}, [focusedRowIndex, onRowClick, tableData]);
```

**Step 7: Update context menu wiring props**

In the `useGridTableContextMenuWiring` call (lines 269-282), the props already pass
both `focusedRowIndex` and `focusedRowKey` — no change needed here. The type update
happens in Task 5.

---

### Task 5: Update `useGridTableContextMenuWiring.tsx`

**Files:**
- Modify: `frontend/src/shared/components/tables/hooks/useGridTableContextMenuWiring.tsx`

**Step 1: Update `openFocusedRowContextMenu` guard**

Replace lines 138-144:
```typescript
const openFocusedRowContextMenu = useCallback(() => {
  if (
    !enableContextMenu ||
    focusedRowKey == null ||
    focusedRowIndex == null ||
    focusedRowIndex >= tableData.length
  ) {
    return false;
  }
```

The rest of the function stays the same — it uses `tableData[focusedRowIndex]` (line
146) which is correct since the derived index is now accurate.

---

### Task 6: Update `GridTableKeys.ts`

**Files:**
- Modify: `frontend/src/shared/components/tables/GridTableKeys.ts:148`

**Step 1: Update the focus check and prop type**

Replace the `focusedRowIndex` usage in `tableTabEnterHandler` (line 148):
```typescript
// Before:
if (focusedRowIndex === null && tableDataLength > 0) {
// After:
if (focusedRowKey === null && tableDataLength > 0) {
```

Update the hook's options type and the destructured prop name to accept `focusedRowKey`
instead of `focusedRowIndex`. Update the dependency array accordingly.

**Step 2: Verify TypeScript compiles cleanly**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx tsc --noEmit --pretty`
Expected: No errors

---

### Task 7: Update test harnesses and add new tests

**Files:**
- Modify: `frontend/src/shared/components/tables/hooks/useGridTableFocusNavigation.test.tsx`

**Step 1: Update harness handle types**

Replace `HarnessHandle`:
```typescript
interface HarnessHandle {
  setFocusedRowKey: React.Dispatch<React.SetStateAction<string | null>>;
  focusByIndex: (index: number) => void;
  focusedRowIndex: number | null;
  focusedRowKey: string | null;
}
```

Replace `ExtendedHandle`:
```typescript
interface ExtendedHandle extends HarnessHandle {
  shortcutsActive: boolean;
  isShortcutsSuppressed: boolean;
  isWrapperFocused: boolean;
  handleWrapperFocus: (event: React.FocusEvent<HTMLDivElement>) => void;
  handleWrapperBlur: (event: React.FocusEvent<HTMLDivElement>) => void;
  handleRowActivation: (item: Row, index: number, source: 'pointer' | 'keyboard') => void;
  handleRowClick: (item: Row, index: number, event: React.MouseEvent) => void;
  lastNavigationMethodRef: React.RefObject<'pointer' | 'keyboard'>;
}
```

**Step 2: Update harness `useImperativeHandle` calls**

In `Harness`, replace:
```typescript
useImperativeHandle(ref, () => ({
  setFocusedRowKey: result.setFocusedRowKey,
  focusByIndex: result.focusByIndex,
  focusedRowIndex: result.focusedRowIndex,
  focusedRowKey: result.focusedRowKey,
}));
```

In `ExtendedHarness`, replace:
```typescript
useImperativeHandle(ref, () => ({
  setFocusedRowKey: result.setFocusedRowKey,
  focusByIndex: result.focusByIndex,
  focusedRowIndex: result.focusedRowIndex,
  focusedRowKey: result.focusedRowKey,
  shortcutsActive: result.shortcutsActive,
  isShortcutsSuppressed: result.isShortcutsSuppressed,
  isWrapperFocused: result.isWrapperFocused,
  handleWrapperFocus: result.handleWrapperFocus,
  handleWrapperBlur: result.handleWrapperBlur,
  handleRowActivation: result.handleRowActivation,
  handleRowClick: result.handleRowClick,
  lastNavigationMethodRef: result.lastNavigationMethodRef,
}));
```

**Step 3: Update existing tests to use key-based API**

In the first test (`calls updateHoverForElement...`), replace:
```typescript
// Before:
ref.current!.setFocusedRowIndex(1);
// After:
ref.current!.setFocusedRowKey('row-b');
```

In the CSS.escape test, replace:
```typescript
// Before:
ref.current!.setFocusedRowIndex(0);
// After:
ref.current!.setFocusedRowKey('ns/pod:container');
```

In the pointer/keyboard activation test, replace assertions:
```typescript
// Before:
expect(ref.current!.focusedRowIndex).toBe(0);
// After (keep both — index is now derived):
expect(ref.current!.focusedRowIndex).toBe(0);
expect(ref.current!.focusedRowKey).toBe('a');
```

In the shortcut suppression tests, replace:
```typescript
// Before:
expect(ref.current!.focusedRowIndex).toBeNull();
// After:
expect(ref.current!.focusedRowKey).toBeNull();
expect(ref.current!.focusedRowIndex).toBeNull();
```

In the data-shrink clamping test, replace:
```typescript
// Before:
ref.current!.setFocusedRowIndex(4);
// After:
ref.current!.setFocusedRowKey('e');
```

And update the expectation after shrink — with key-based tracking, when data shrinks
to `[a, b]` and the focused key is `'e'` which no longer exists, focus clears to null:
```typescript
// Before:
expect(ref.current!.focusedRowIndex).toBe(1);
// After — 'e' is gone, focus should be null:
expect(ref.current!.focusedRowKey).toBeNull();
expect(ref.current!.focusedRowIndex).toBeNull();
```

In the empty-data test, replace:
```typescript
// Before:
ref.current!.setFocusedRowIndex(1);
expect(ref.current!.focusedRowIndex).toBe(1);
// After:
ref.current!.setFocusedRowKey('b');
expect(ref.current!.focusedRowKey).toBe('b');
expect(ref.current!.focusedRowIndex).toBe(1);
```

After empty:
```typescript
expect(ref.current!.focusedRowKey).toBe('b'); // key is still set in state...
expect(ref.current!.focusedRowIndex).toBeNull(); // ...but index resolves to null
```

**Step 4: Add new test — focus follows key across data reorder**

```typescript
describe('useGridTableFocusNavigation – key-based focus stability', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('focus follows the same logical row when data is reordered', async () => {
    const updateHover = vi.fn();
    const original: Row[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const ref = React.createRef<ExtendedHandle>();

    await act(async () => {
      root.render(
        <ExtendedHarness ref={ref} tableData={original} updateHoverForElement={updateHover} />
      );
    });

    // Focus row 'b' at index 1.
    await act(async () => {
      ref.current!.setFocusedRowKey('b');
    });
    expect(ref.current!.focusedRowKey).toBe('b');
    expect(ref.current!.focusedRowIndex).toBe(1);

    // Reorder data: 'b' moves to index 2.
    const reordered: Row[] = [{ id: 'a' }, { id: 'c' }, { id: 'b' }];
    await act(async () => {
      root.render(
        <ExtendedHarness ref={ref} tableData={reordered} updateHoverForElement={updateHover} />
      );
    });

    // Focus should still be on 'b', now at index 2.
    expect(ref.current!.focusedRowKey).toBe('b');
    expect(ref.current!.focusedRowIndex).toBe(2);
  });

  it('clears focus when the focused row is removed from data', async () => {
    const updateHover = vi.fn();
    const original: Row[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const ref = React.createRef<ExtendedHandle>();

    await act(async () => {
      root.render(
        <ExtendedHarness ref={ref} tableData={original} updateHoverForElement={updateHover} />
      );
    });

    await act(async () => {
      ref.current!.setFocusedRowKey('b');
    });
    expect(ref.current!.focusedRowIndex).toBe(1);

    // Remove 'b' from data.
    const without: Row[] = [{ id: 'a' }, { id: 'c' }];
    await act(async () => {
      root.render(
        <ExtendedHarness ref={ref} tableData={without} updateHoverForElement={updateHover} />
      );
    });

    // Key is still set but index resolves to null since 'b' is gone.
    expect(ref.current!.focusedRowIndex).toBeNull();
  });

  it('focus follows key when new rows are inserted before the focused row', async () => {
    const updateHover = vi.fn();
    const original: Row[] = [{ id: 'a' }, { id: 'b' }];
    const ref = React.createRef<ExtendedHandle>();

    await act(async () => {
      root.render(
        <ExtendedHarness ref={ref} tableData={original} updateHoverForElement={updateHover} />
      );
    });

    await act(async () => {
      ref.current!.setFocusedRowKey('b');
    });
    expect(ref.current!.focusedRowIndex).toBe(1);

    // Insert two rows before 'b'.
    const expanded: Row[] = [{ id: 'x' }, { id: 'y' }, { id: 'a' }, { id: 'b' }];
    await act(async () => {
      root.render(
        <ExtendedHarness ref={ref} tableData={expanded} updateHoverForElement={updateHover} />
      );
    });

    // 'b' is now at index 3.
    expect(ref.current!.focusedRowKey).toBe('b');
    expect(ref.current!.focusedRowIndex).toBe(3);
  });
});
```

**Step 5: Run all tests**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx vitest run src/shared/components/tables/hooks/useGridTableFocusNavigation.test.tsx`
Expected: All PASS

---

### Task 8: Run full test suite, lint, and TypeScript checks

**Files:** None (verification only)

**Step 1: Run TypeScript check**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx tsc --noEmit --pretty`
Expected: No errors

**Step 2: Run full GridTable test suite**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx vitest run src/shared/components/tables/`
Expected: All PASS

**Step 3: Run linter**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx eslint src/shared/components/tables/ --ext .ts,.tsx`
Expected: No errors

**Step 4: Run full frontend test suite**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx vitest run`
Expected: All PASS
