# TODO

## Object Map Tech Debt

1. ✅ ObjectMap.tsx is doing too much - It owns toolbar state, legend drag state, kind filtering, focus projection, search, context menus, and renderer wiring. The difficult-but-correct shape would split that into smaller hooks/pure helpers, especially for visible graph derivation.
2. ✅ Graph derivation is split between useObjectMapModel and ObjectMap.tsx - The model computes the base graph/layout, then ObjectMap.tsx applies kind filters, transitive edge contraction, focus mode, search visibility, and sometimes recomputes layout. That works, but the correct long-term shape is one pure “derive visible map state” pipeline with tests.
3. G6 renderer is still a large imperative integration surface - It owns G6 lifecycle, async render queues, palette refresh, tooltip positioning, viewport controls, drag/click events, hover state, and data patching. Some of that is unavoidable, but it is still a high-risk file.
   - ✅ Extracted the graph data/selection application queue into a tested helper.
   - ✅ Extracted tooltip layout/content calculation into a tested helper.
4. Real G6 interaction behavior is under-tested - The new gesture helper is tested, and ObjectMap behavior is tested with a mocked renderer, but we still do not have a real G6/browser-level test that proves the exact drag-then-click sequence. That is probably the biggest remaining confidence gap.
5. Legend drag is implemented directly in ObjectMap.tsx - It is not dead code, but it is another custom pointer state machine in the main component. The correct cleanup would extract and test it similarly to node gesture handling.
6. Tooltip rendering is custom and tightly coupled to renderer internals - It has to be canvas/G6-aware, but the sizing, badges, truncation, and positioning rules are still more fragile than a normal shared React tooltip.

## Feature Ideas

- In daemonset details, show a "NOT RUNNING ON" label that lists the nodes where the ds is missing

- Configurable backend thresholds
  - QPS (500) and Burst (1000)
  - SSRR concurrency cap (32)

- Gridtable improvements
- Allow column order change via drag
  - should reset button also reset to default column order?
    - probably not because that reset is for filters
- Pods view, change default column order to Name, Owner, Namespace

- Transfer files to/from pods
  - Select container
  - can we show a file dialog for the remote filesystem?

- More deployment options
  - Container scope:
    - set image
      - show a list of containers and their images, allow override
    - update resource requests/limits

- Metrics over time
  - Graphs instead of only point-in-time numbers
  - No persistence, just show metrics for the current view, drop them when the view changes

- Helm install/upgrade/delete
  - track deployments, offer rollbacks?

- Multi-select/batch operations
  - Allow batch operations, but could be dangerous

## Wails v3 (when ready)

- Multiple windows
  - Object Panel, logs, diagnostics in its own window

- Automatic app updates
