package metrichistory

import (
	"errors"
	"time"
)

const (
	// maxPoints caps each series so a chart stays readable and responses stay small.
	maxPoints = 300
	minStep   = 15 * time.Second
	// assumedScrapeInterval is the common Prometheus default. kube-prometheus-stack scrapes
	// cAdvisor every 10s and everything else every 30s, so 30s is the conservative choice.
	assumedScrapeInterval = 30 * time.Second
)

// ErrInvalidRange reports a time range that cannot produce a grid.
var ErrInvalidRange = errors.New("metric history: time range must be positive")

// GridEndingAt returns the grid for span ending at end. The step is the smallest multiple of
// 15s that keeps the grid within maxPoints steps, and the last point is end itself, so the
// newest value is current.
func GridEndingAt(end time.Time, span time.Duration) (Grid, error) {
	if span <= 0 {
		return Grid{}, ErrInvalidRange
	}
	end = end.Truncate(time.Second)
	step := ceilToMultiple((span+maxPoints-1)/maxPoints, minStep)
	steps := int(span / step)
	start := end.Add(-time.Duration(steps) * step)
	return Grid{StartMs: start.UnixMilli(), StepMs: step.Milliseconds(), Count: steps + 1}, nil
}

// RateWindow is the range-vector window for rate() at a given step: at least four scrapes, and
// at least one step plus a scrape so consecutive windows leave no sample uncounted.
func RateWindow(step time.Duration) time.Duration {
	return max(step+assumedScrapeInterval, 4*assumedScrapeInterval)
}

func ceilToMultiple(value, multiple time.Duration) time.Duration {
	if value <= multiple {
		return multiple
	}
	return ((value + multiple - 1) / multiple) * multiple
}
