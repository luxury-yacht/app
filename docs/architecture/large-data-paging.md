# Large Data Page Addressing

Use for cursor navigation, anchor jumps, page ranks, or export continuity. Apply
[shared large-data rules](large-data.md); query envelopes and liveness are in
[the query contract](large-data-query.md).

## Page Addressing Contract (anchor / startRank / continue)

A query-backed request addresses its page exactly one way — the three are
mutually exclusive (validated server-side):

- **`continue`** — an opaque backend-minted keyset cursor. Every engine-served
  response carries `previous` (backend prev cursor; the client keeps no token
  stack) and `continue`.
- **`anchor.*`** — a full object reference (`clusterId` must equal the request
  cluster; version/kind/name required); the response is the PAGE-ALIGNED
  window containing the object, with `anchor: {found, rank, reason}` (a
  missing anchor serves the first page plus `reason: "filtered" |
  "not-found"` — one round trip, visible truth). The catalog cross-checks
  `anchor.uid` against its rows (mismatch = recreated object = not-found);
  typed rows carry no UID.
- **`startRank`** — a 0-based offset (numbered page jumps); the engine clamps
  past-the-end starts to the last aligned page. The UI offers numbered jumps
  only while `totalIsExact`.

Counted serves (anchor/startRank landings) also return `pageStartRank` (the
exact serve-time rank of the page's first row — a POINTER/optional field so
rank 0 survives omission semantics) and `self` (a cursor addressing the landing
page itself, adopted by the client so live refetches stay page-stable instead
of re-anchoring). Plain cursor pages carry neither: computing rank there costs
an O(rank) walk per serve, which failed the position-honesty benchmark gate
(the [QueryAround measurement](large-data-measurements.md#current-browse-budget),
~2× the worst page-serve budget at 250k) — footer positions on cursor pages remain
client-derived between jumps.

Export walks guard cross-page consistency by comparing the RAW
`sourceVersions["object"]` clock per page (never the folded `sourceVersion`
token, which embeds the scope string and differs per page by construction):
first drift restarts the walk once; a second drift DELIVERS the export with a
user-visible "data changed during export" notification. Failed/blocked/empty
pages still reject outright.

Anchor identity resolves to an engine row key in the **serve layer**, never the
engine (engine row keys are adapter-owned and name-shaped, not Kubernetes UIDs):
typed tables map `(kind, namespace, name)` through the adapter's `AnchorKey`,
built from the same helpers as the adapter's row `Key` — **a new typed kind must
supply an `AnchorKey` or its rows cannot be anchor-jumped to**; the catalog looks
the `Summary` up by `(gvr, namespace, name)` and cross-checks the object UID
(mismatch = recreated object = `not-found`). Frontend anchor intent is
navigation state, never persisted table state (favorites must not replay jumps):
a held jump re-fires (it does **not** bounce to page 1) on a sort/filter/page-size
change, is cleared by manual pagination, and is retried with the anchor — not
reset to page 1 — when a cursor is rejected mid-jump.
