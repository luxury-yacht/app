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

All paths from .content-body to the gridtable use a single `div.view-content` wrapper:

```
div.view-content → GridTable → div.gridtable-container
```

BrowseView no longer renders its own wrapper div. When used standalone (cluster browse),
AppLayout wraps it in `div.view-content`. When embedded (namespace/all-namespaces browse),
the parent view already provides `div.view-content`.

(Transparent wrappers like RouteErrorBoundary, ResourceLoadingBoundary, and context providers emit no wrapper divs.)

---

Resolved Issues

The following issues were found during investigation and have been fixed:

- ✅ `.all-namespaces-view` had no CSS → replaced with `div.view-content`
- ✅ `.browse-view` used a different sizing strategy than `.view-content` → BrowseView now uses `view-content` when standalone
- ✅ Dead CSS in Tabs.css (`.resource-container`, `.resource-section`, `.cluster-*-content`) → removed
- ✅ Unnecessary `.view-container` → `.view-content` nesting → collapsed to single `div.view-content`
