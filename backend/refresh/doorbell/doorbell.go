// Package doorbell is the per-cluster change-signal contract between the
// stores refresh domains read and the resource stream that tells the frontend
// to refetch. A store rings its domain's doorbell after it has applied a
// change; ringing invalidates the domain's snapshot cache, then delivers
// (docs/architecture/data-freshness.md, "Signals and source clocks").
package doorbell

import (
	"strings"
	"sync"
	"time"

	"github.com/luxury-yacht/app/backend/refresh/streammux"
	"github.com/luxury-yacht/app/backend/resourcemodel"
)

// Bell is the doorbell a producer receives at construction. It belongs to
// one cluster generation.
type Bell interface {
	// Ring publishes one committed change. It never waits on Stop; after the
	// generation stops it does nothing.
	Ring(Change)
	// AfterFunc runs fn once after d as a generation callback: it never
	// starts after the generation stops, and stopping waits for it while it
	// runs. Producers schedule every timer through it.
	AfterFunc(d time.Duration, fn func()) Timer
}

// Timer cancels a pending AfterFunc callback.
type Timer interface {
	Stop() bool
}

// Source names the clock a change advances.
type Source = streammux.Source

const (
	SourceObject    = streammux.SourceObject
	SourceMetric    = streammux.SourceMetric
	SourceEvent     = streammux.SourceEvent
	SourceCatalog   = streammux.SourceCatalog
	SourceAttention = streammux.SourceAttention
)

// MessageType is the wire type a change is delivered with.
type MessageType = streammux.MessageType

const (
	MessageTypeAdded    = streammux.MessageTypeAdded
	MessageTypeModified = streammux.MessageTypeModified
	MessageTypeDeleted  = streammux.MessageTypeDeleted
	MessageTypeComplete = streammux.MessageTypeComplete
)

// Change is one committed change to a domain's served data.
type Change struct {
	Domain string
	Source Source
	Target Target
	// Version is the opaque clock value; empty means the per-scope sequence.
	Version string
	// Type defaults to MODIFIED.
	Type MessageType
	// Ref and ResourceVersion identify the changed object for diagnostics;
	// a Ref always carries complete identity.
	Ref             *resourcemodel.ResourceRef
	ResourceVersion string
	// Reason says what rang, for debug logs.
	Reason string
}

type targetKind uint8

const (
	targetScopes targetKind = iota + 1
	targetSubscribed
	targetMatching
)

// Target selects the scopes a change rings. Build it with Scopes,
// Subscribed, or Matching; the zero value selects nothing.
type Target struct {
	kind    targetKind
	scopes  []string
	matches func(scope string) bool
}

// Scopes rings exactly these scopes, deduplicated.
func Scopes(scopes ...string) Target {
	return Target{kind: targetScopes, scopes: uniqueScopes(scopes)}
}

// Subscribed rings every scope of the domain someone subscribed to.
func Subscribed() Target {
	return Target{kind: targetSubscribed}
}

// Matching rings the subscribed scopes the matcher selects.
func Matching(matches func(scope string) bool) Target {
	if matches == nil {
		return Target{}
	}
	return Target{kind: targetMatching, matches: matches}
}

// ExplicitScopes reports the scopes of a Scopes target.
func (t Target) ExplicitScopes() ([]string, bool) {
	return t.scopes, t.kind == targetScopes
}

// AllSubscribed reports whether the target is Subscribed.
func (t Target) AllSubscribed() bool {
	return t.kind == targetSubscribed
}

// Matcher reports the matcher of a Matching target.
func (t Target) Matcher() (func(scope string) bool, bool) {
	return t.matches, t.kind == targetMatching
}

func uniqueScopes(scopes []string) []string {
	seen := make(map[string]struct{}, len(scopes))
	out := make([]string, 0, len(scopes))
	for _, scope := range scopes {
		scope = strings.TrimSpace(scope)
		if _, ok := seen[scope]; ok {
			continue
		}
		seen[scope] = struct{}{}
		out = append(out, scope)
	}
	return out
}

// Generation owns one cluster generation's producer lifetime: rings and timer
// callbacks run only until Stop, and Stop returns only after every one already
// running has finished. The zero value is a running generation.
type Generation struct {
	mu      sync.Mutex
	idle    *sync.Cond
	active  int
	stopped bool
	timers  map[*generationTimer]struct{}
}

// Run runs fn as generation work: not at all after Stop, and joined by Stop
// while it runs. It reports whether fn ran.
func (g *Generation) Run(fn func()) bool {
	if !g.begin() {
		return false
	}
	defer g.end()
	fn()
	return true
}

// AfterFunc schedules fn as a generation callback.
func (g *Generation) AfterFunc(d time.Duration, fn func()) Timer {
	t := &generationTimer{generation: g}
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.stopped {
		return t
	}
	if g.timers == nil {
		g.timers = make(map[*generationTimer]struct{})
	}
	g.timers[t] = struct{}{}
	t.timer = time.AfterFunc(d, func() {
		g.forget(t)
		g.Run(fn)
	})
	return t
}

// Stop rejects new work, cancels pending timers, and waits for running work
// to finish. Generation work must never call Stop.
func (g *Generation) Stop() {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.stopped = true
	for t := range g.timers {
		t.timer.Stop()
	}
	g.timers = nil
	for g.active > 0 {
		g.idleLocked().Wait()
	}
}

func (g *Generation) begin() bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.stopped {
		return false
	}
	g.active++
	return true
}

func (g *Generation) end() {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.active--
	if g.active == 0 {
		g.idleLocked().Broadcast()
	}
}

func (g *Generation) idleLocked() *sync.Cond {
	if g.idle == nil {
		g.idle = sync.NewCond(&g.mu)
	}
	return g.idle
}

func (g *Generation) forget(t *generationTimer) {
	g.mu.Lock()
	delete(g.timers, t)
	g.mu.Unlock()
}

type generationTimer struct {
	generation *Generation
	timer      *time.Timer
}

func (t *generationTimer) Stop() bool {
	if t.timer == nil {
		return false
	}
	t.generation.forget(t)
	return t.timer.Stop()
}
