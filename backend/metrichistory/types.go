// Package metrichistory defines the provider-neutral contract of the object-panel Metrics tab:
// graphs of series sampled on one shared time grid, in the app's metric units.
// See docs/plans/metrics-history.md.
package metrichistory

import "time"

// Unit is the unit of every value in a graph. CPU is millicores and memory is bytes, matching
// the live metrics contract in docs/architecture/resource-metrics.md.
type Unit string

const (
	UnitMillicores Unit = "millicores"
	UnitBytes      Unit = "bytes"
)

// GraphID identifies a graph in the fixed graph catalog.
type GraphID string

const (
	GraphCPU    GraphID = "cpu"
	GraphMemory GraphID = "memory"
)

// SeriesRole tells the frontend how to draw a series: usage solid, reservations as reference lines.
type SeriesRole string

const (
	RoleUsage   SeriesRole = "usage"
	RoleRequest SeriesRole = "request"
	RoleLimit   SeriesRole = "limit"
)

// GraphStatus distinguishes a graph with samples from one whose source returned none, and both
// from a live-mode graph, which carries no source data because the frontend fills it from live
// metrics.
type GraphStatus string

const (
	GraphStatusOK     GraphStatus = "ok"
	GraphStatusNoData GraphStatus = "noData"
	GraphStatusLive   GraphStatus = "live"
)

// Grid is the evaluation timeline every series in a response is sampled on:
// Count points starting at StartMs, StepMs apart.
type Grid struct {
	StartMs int64 `json:"startMs"`
	StepMs  int64 `json:"stepMs"`
	Count   int   `json:"count"`
}

func (g Grid) Start() time.Time        { return time.UnixMilli(g.StartMs).UTC() }
func (g Grid) Step() time.Duration     { return time.Duration(g.StepMs) * time.Millisecond }
func (g Grid) End() time.Time          { return g.Start().Add(time.Duration(g.Count-1) * g.Step()) }
func (g Grid) contains(index int) bool { return index >= 0 && index < g.Count }

// Index returns the grid position of a sample time, or false when the time is outside the grid
// or between steps.
func (g Grid) Index(at time.Time) (int, bool) {
	offset := at.UnixMilli() - g.StartMs
	if g.StepMs <= 0 || offset%g.StepMs != 0 {
		return 0, false
	}
	index := int(offset / g.StepMs)
	return index, g.contains(index)
}

// Series is one line on a graph. Values align with the response grid; nil means no sample at
// that step (a gap), which is distinct from a real zero.
type Series struct {
	ID     string     `json:"id"`
	Role   SeriesRole `json:"role"`
	Values []*float64 `json:"values"`
}

// Graph is one chart of the Metrics tab.
type Graph struct {
	ID     GraphID     `json:"id"`
	Unit   Unit        `json:"unit"`
	Status GraphStatus `json:"status"`
	Series []Series    `json:"series"`
}
