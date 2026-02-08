Layout Investigation Report

Full Hierarchy

```
.app (height: 100vh, flex column)
└─ .app-container (CSS Grid: 38px auto 1fr / auto 1fr, overflow: hidden)
    ├─ AppHeader (row 1)
    ├─ ClusterTabs (row 2)
    └─ .app-main (row 3, flex row, overflow: hidden)
        ├─ .sidebar (min-w:200 max-w:300, position: relative)
        ├─ .sidebar-resizer (4px, flex-shrink: 0)
        └─ .content (flex: 1, flex column, overflow: hidden, min-height: 0)
            └─ .content-body (flex: 1, flex column, overflow: hidden, position: relative, min-height: 0)
```

From .content-body, there are three distinct paths to the gridtable:

```
┌───────────────────┬─────────────────────────────────────────────────────────────────────────────┐
│       Route       │                        DOM path below .content-body                         │
├───────────────────┼─────────────────────────────────────────────────────────────────────────────┤
│ BrowseView        │ div.browse-view → GridTable → div.gridtable-container                       │
├───────────────────┼─────────────────────────────────────────────────────────────────────────────┤
│ Cluster/Namespace │ div.view-container → div.view-content → GridTable → div.gridtable-container │
├───────────────────┼─────────────────────────────────────────────────────────────────────────────┤
│ All Namespaces    │ div.all-namespaces-view → GridTable → div.gridtable-container               │
└───────────────────┴─────────────────────────────────────────────────────────────────────────────┘
```

(Transparent wrappers like RouteErrorBoundary, ResourceLoadingBoundary, and context providers emit no wrapper divs.)

---

Issues Found

1. .all-namespaces-view has NO CSS at all (HIGH)

The AllNamespacesView component renders <div className="all-namespaces-view"> at line 300 of AllNamespacesView.tsx, but there are zero CSS rules for this class anywhere in the codebase.

In .content-body (a flex column container), a plain <div> without flex: 1 won't fill available space. The gridtable still works because .gridtable-container uses position: absolute; inset: 0, which escapes to .content-body (the nearest positioned ancestor with position: relative) rather than .all-namespaces-view. So it works accidentally — the wrapper is effectively an invisible zero-height element that the absolute-positioned gridtable ignores entirely.

Risk: If anything ever needs to be positioned relative to .all-namespaces-view, or if the gridtable switches to flex-based sizing, this will break.

2. .view-content missing display: flex and overflow: hidden (MEDIUM)

In Tabs.css:42-46:

```
  .view-content {
    flex: 1;
    position: relative;
    min-height: 0;
  }
```

Compare to .browse-view in BrowseView.css:1-7:

```
  .browse-view {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }
```

.view-content is missing display: flex; flex-direction: column; overflow: hidden. This is fine today because .gridtable-container uses absolute positioning to fill .view-content (which has position: relative). But it's a different sizing strategy than BrowseView, meaning the two paths to the gridtable work for different reasons.

3. Dead CSS in Tabs.css (LOW)

Lines 49-77 define styles for .resource-container, .resource-section, and nine .cluster-\*-content classes. None of these classes are used in any component. They appear to be remnants of a previous architecture.

4. Two sizing strategies coexist (INFO, not broken)

- BrowseView path: Every container uses display: flex; flex-direction: column; flex: 1; overflow: hidden to propagate sizing down. Then .gridtable-container also uses position: absolute; inset: 0 as a belt-and-suspenders approach.
- Cluster/Namespace path: .view-content uses flex: 1; position: relative but no flex display. The child relies entirely on absolute positioning to fill the parent.

Both work, but they achieve the same result through different mechanisms.

---

Summary

```
┌──────────┬──────────────────────────────────────────────────────────────┬──────────────────────────────────────────────────────────────────────┐
│ Priority │                            Issue                             │                                Impact                                │
├──────────┼──────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────┤
│ HIGH     │ .all-namespaces-view has no CSS styles                       │ Works by accident (absolute positioning escapes the unsized wrapper) │
├──────────┼──────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────┤
│ MEDIUM   │ .view-content inconsistent with .browse-view sizing strategy │ Not broken, but fragile if sizing approach changes                   │
├──────────┼──────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────┤
│ LOW      │ Dead CSS selectors in Tabs.css (lines 49-77)                 │ Code clutter, no runtime impact                                      │
└──────────┴──────────────────────────────────────────────────────────────┴──────────────────────────────────────────────────────────────────────┘
```

The overall layout structure is sound — the grid-at-top, flex-everywhere-else approach is correct. The overflow: hidden chain from .app-container down to the scroll container (.gridtable-wrapper) properly ensures only one scroll context exists. The main concern is the two inconsistencies: the completely unstyled .all-namespaces-view wrapper, and the divergent sizing patterns between BrowseView and the cluster/namespace view paths.
