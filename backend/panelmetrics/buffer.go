// Package panelmetrics keeps each open object panel's live metrics-server samples in process
// memory for as long as the panel is open in any window (docs/architecture/resource-metrics.md,
// "Object panel Metrics tab"). Nothing is written to disk.
//
// The store is compact: a sample holds only its time and the two usage values; requests, limits,
// capacity, and allocatable come from the object, rarely change, and are kept as change points.
package panelmetrics

import (
	"fmt"
	"math"
	"strings"
	"sync"
)

// DefaultMaxSamples is one hour at the default 5-second metrics poll. A shorter poll interval
// shortens the window instead of growing memory.
const DefaultMaxSamples = 720

// Values are one resource's numbers: CPU millicores or memory bytes. Nil means not reported.
type Values struct {
	Usage       *float64 `json:"usage,omitempty"`
	Request     *float64 `json:"request,omitempty"`
	Limit       *float64 `json:"limit,omitempty"`
	Capacity    *float64 `json:"capacity,omitempty"`
	Allocatable *float64 `json:"allocatable,omitempty"`
}

// Sample is one metrics-server collection for a panel's object.
type Sample struct {
	// T is when metrics-server collected the values, in unix milliseconds.
	T      int64  `json:"t"`
	CPU    Values `json:"cpu"`
	Memory Values `json:"memory"`
}

// Series is what a reader gets: the samples newer than its last one.
type Series struct {
	// FirstT is the oldest sample still kept, so a reader drops anything older that it holds.
	FirstT  int64    `json:"firstT"`
	Samples []Sample `json:"samples"`
}

// Key identifies a panel across windows.
type Key struct {
	ClusterID string
	PanelID   string
}

// NaN marks a value that was not reported.
type usage struct {
	t           int64
	cpu, memory float64
}

// request, limit, capacity, allocatable
type reservations struct {
	cpu, memory [4]float64
}

type change struct {
	t      int64
	values reservations
}

type series struct {
	samples []usage
	changes []change
}

type Buffer struct {
	mu         sync.Mutex
	maxSamples int
	series     map[Key]*series
}

func NewBuffer(maxSamples int) *Buffer {
	return &Buffer{maxSamples: max(maxSamples, 1), series: make(map[Key]*series)}
}

// Append records a sample when isOpen reports the panel open. The check and the write happen
// under one lock, so a panel removed concurrently cannot leave a series behind.
func (b *Buffer) Append(key Key, sample Sample, isOpen func() bool) error {
	if err := validate(key, sample); err != nil {
		return err
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if !isOpen() {
		return nil
	}
	current := b.series[key]
	if current == nil {
		current = &series{}
		b.series[key] = current
	}
	current.add(sample, b.maxSamples)
	return nil
}

// Since returns the samples newer than afterT, with reservations filled in.
func (b *Buffer) Since(key Key, afterT int64) Series {
	b.mu.Lock()
	defer b.mu.Unlock()
	current := b.series[key]
	if current == nil || len(current.samples) == 0 {
		return Series{Samples: []Sample{}}
	}
	out := Series{FirstT: current.samples[0].t, Samples: []Sample{}}
	next := 0
	for _, kept := range current.samples {
		for next < len(current.changes) && current.changes[next].t <= kept.t {
			next++
		}
		if kept.t > afterT {
			out.Samples = append(out.Samples, kept.expand(current.changes[next-1].values))
		}
	}
	return out
}

// Remove forgets closed panels.
func (b *Buffer) Remove(keys ...Key) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for _, key := range keys {
		delete(b.series, key)
	}
}

func (s *series) add(sample Sample, maxSamples int) {
	if n := len(s.samples); n > 0 && sample.T <= s.samples[n-1].t {
		return
	}
	s.samples = appendCapped(s.samples, usage{t: sample.T, cpu: valueOf(sample.CPU.Usage), memory: valueOf(sample.Memory.Usage)}, maxSamples)
	values := reservationsOf(sample)
	if n := len(s.changes); n == 0 || !sameReservations(s.changes[n-1].values, values) {
		s.changes = append(s.changes, change{t: sample.T, values: values})
	}
	// Keep the change in effect at the oldest sample and every later one.
	oldest := s.samples[0].t
	drop := 0
	for drop+1 < len(s.changes) && s.changes[drop+1].t <= oldest {
		drop++
	}
	s.changes = s.changes[drop:]
}

// appendCapped grows exactly up to maxSamples, then drops the oldest sample.
func appendCapped(samples []usage, next usage, maxSamples int) []usage {
	if len(samples) == maxSamples {
		copy(samples, samples[1:])
		samples[len(samples)-1] = next
		return samples
	}
	if len(samples) == cap(samples) {
		grown := make([]usage, len(samples), min(max(2*cap(samples), 16), maxSamples))
		copy(grown, samples)
		samples = grown
	}
	return append(samples, next)
}

func (kept usage) expand(values reservations) Sample {
	return Sample{
		T:      kept.t,
		CPU:    valuesOf(kept.cpu, values.cpu),
		Memory: valuesOf(kept.memory, values.memory),
	}
}

func valuesOf(used float64, reserved [4]float64) Values {
	return Values{
		Usage:       pointerOf(used),
		Request:     pointerOf(reserved[0]),
		Limit:       pointerOf(reserved[1]),
		Capacity:    pointerOf(reserved[2]),
		Allocatable: pointerOf(reserved[3]),
	}
}

func reservationsOf(sample Sample) reservations {
	return reservations{cpu: reservedOf(sample.CPU), memory: reservedOf(sample.Memory)}
}

func reservedOf(values Values) [4]float64 {
	return [4]float64{valueOf(values.Request), valueOf(values.Limit), valueOf(values.Capacity), valueOf(values.Allocatable)}
}

// sameReservations compares bit patterns so two "not reported" NaNs are equal.
func sameReservations(left, right reservations) bool {
	for index := range left.cpu {
		if math.Float64bits(left.cpu[index]) != math.Float64bits(right.cpu[index]) ||
			math.Float64bits(left.memory[index]) != math.Float64bits(right.memory[index]) {
			return false
		}
	}
	return true
}

func valueOf(value *float64) float64 {
	if value == nil {
		return math.NaN()
	}
	return *value
}

func pointerOf(value float64) *float64 {
	if math.IsNaN(value) {
		return nil
	}
	return &value
}

func validate(key Key, sample Sample) error {
	if strings.TrimSpace(key.ClusterID) == "" || strings.TrimSpace(key.PanelID) == "" {
		return fmt.Errorf("panel metrics require cluster and panel identity")
	}
	if sample.T <= 0 {
		return fmt.Errorf("panel metric sample requires a collection time")
	}
	for _, values := range []Values{sample.CPU, sample.Memory} {
		for _, value := range []*float64{values.Usage, values.Request, values.Limit, values.Capacity, values.Allocatable} {
			if value != nil && (math.IsNaN(*value) || math.IsInf(*value, 0) || *value < 0) {
				return fmt.Errorf("panel metric values must be finite and non-negative")
			}
		}
	}
	return nil
}
