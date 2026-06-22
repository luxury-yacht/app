// Package querypage defines the unified Query → Page contract for the v2 store.
//
// Its first piece is one value-keyed cursor that replaces the two existing codecs:
// the typed-table cursor in backend/refresh/snapshot/typed_table_query.go and the
// catalog cursor in backend/objectcatalog/query.go. Grounded: both are already
// value-keyed keysets — the typed cursor on (LastValue, LastKey); the catalog cursor
// on the object ref + Created — so a single cursor carrying the ordered sort-key
// components plus a UID tiebreak subsumes both.
//
// This package is ADDITIVE: it introduces the contract without touching either live
// query path. Wiring the two executors (and the frontend continueToken format) onto
// it is a separate, later step.
package querypage

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
)

// Direction is the page traversal direction over the sort order.
type Direction string

const (
	Ascending  Direction = "asc"
	Descending Direction = "desc"
)

// ErrCursorMismatch means a cursor was issued for a different query than the one
// now executing (different cluster, query shape, sort, direction, or page size).
// The caller must restart from the first page rather than risk silently mispaging.
var ErrCursorMismatch = errors.New("querypage: cursor does not match the current query")

// Cursor is the value-keyed keyset position for one page of a query. It is opaque
// to clients (encoded as base64(json)) and self-describing: it pins the query it
// belongs to so a stale cursor from a different query is rejected, not mispaged.
type Cursor struct {
	ClusterID string    `json:"c"`
	Signature string    `json:"q"` // hash of the query shape (filters, scope, …)
	Sort      string    `json:"s"`
	Direction Direction `json:"d"`
	Limit     int       `json:"l"`

	// Position holds the sort-key component value(s) of the boundary row this cursor
	// pins, in sort order. UID is the final, always-unique tiebreak. Together they are
	// the keyset seek position. Empty Position + empty UID = first page.
	Position []string `json:"p,omitempty"`
	UID      string   `json:"u,omitempty"`

	// Backward marks a prev-page cursor: the engine walks the sort order DOWNWARD from
	// Position (collecting the rows immediately before it) instead of upward. It is a
	// navigation property, not part of the query shape, so Validate ignores it.
	Backward bool `json:"b,omitempty"`

	// Revision is the store LSN the page was read at — a staleness/consistency guard
	// the executor may use to detect that the underlying data moved under the cursor.
	Revision string `json:"r,omitempty"`
}

// FirstPage builds the start cursor for a query (no position yet).
func FirstPage(clusterID, signature, sort string, direction Direction, limit int) Cursor {
	return Cursor{
		ClusterID: clusterID,
		Signature: signature,
		Sort:      sort,
		Direction: direction,
		Limit:     limit,
	}
}

// IsFirstPage reports whether the cursor is at the start position (no keyset yet).
func (c Cursor) IsFirstPage() bool {
	return len(c.Position) == 0 && c.UID == ""
}

// Encode renders the cursor as an opaque base64(json) token. An empty token is
// returned for a first-page cursor so callers can treat "" as "start".
func (c Cursor) Encode() string {
	if c.IsFirstPage() {
		return ""
	}
	raw, _ := json.Marshal(c) // Cursor holds only JSON-safe fields; Marshal cannot fail
	return base64.RawURLEncoding.EncodeToString(raw)
}

// Decode parses an opaque token back into a Cursor. An empty token decodes to the
// zero Cursor (first page).
func Decode(token string) (Cursor, error) {
	if token == "" {
		return Cursor{}, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		return Cursor{}, fmt.Errorf("querypage: bad cursor encoding: %w", err)
	}
	var c Cursor
	if err := json.Unmarshal(raw, &c); err != nil {
		return Cursor{}, fmt.Errorf("querypage: bad cursor payload: %w", err)
	}
	return c, nil
}

// Validate checks that the cursor belongs to the query identified by the given
// fields. A first-page (zero) cursor always validates; any mismatch on the pinned
// query identity returns ErrCursorMismatch.
func (c Cursor) Validate(clusterID, signature, sort string, direction Direction, limit int) error {
	if c.IsFirstPage() {
		return nil
	}
	if c.ClusterID != clusterID || c.Signature != signature || c.Sort != sort ||
		c.Direction != direction || c.Limit != limit {
		return ErrCursorMismatch
	}
	return nil
}
