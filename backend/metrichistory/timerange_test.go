package metrichistory

import (
	"errors"
	"testing"
	"time"
)

func TestGridEndingAtKeepsEveryPresetWithinThePointBudget(t *testing.T) {
	end := time.Date(2026, 10, 1, 18, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		span     time.Duration
		wantStep time.Duration
	}{
		{span: 15 * time.Minute, wantStep: 15 * time.Second},
		{span: time.Hour, wantStep: 15 * time.Second},
		{span: 6 * time.Hour, wantStep: 75 * time.Second},
		{span: 24 * time.Hour, wantStep: 300 * time.Second},
		{span: 7 * 24 * time.Hour, wantStep: 2025 * time.Second},
	} {
		grid, err := GridEndingAt(end, tc.span)
		if err != nil {
			t.Fatalf("span %s: %v", tc.span, err)
		}
		if grid.Step() != tc.wantStep {
			t.Errorf("span %s: step %s, want %s", tc.span, grid.Step(), tc.wantStep)
		}
		if grid.Count > maxPoints+1 {
			t.Errorf("span %s: %d points exceeds the budget", tc.span, grid.Count)
		}
		// The last point is the requested end, so headline values are current.
		if !grid.End().Equal(end) {
			t.Errorf("span %s: grid ends at %s, want %s", tc.span, grid.End(), end)
		}
		covered := grid.End().Sub(grid.Start())
		if covered > tc.span || covered <= tc.span-grid.Step() {
			t.Errorf("span %s: grid covers %s", tc.span, covered)
		}
	}
}

func TestGridEndingAtRejectsNonPositiveSpans(t *testing.T) {
	for _, span := range []time.Duration{0, -time.Minute} {
		if _, err := GridEndingAt(time.Now(), span); !errors.Is(err, ErrInvalidRange) {
			t.Errorf("span %s: err = %v, want ErrInvalidRange", span, err)
		}
	}
}

func TestRateWindowSpansAtLeastFourScrapesAndOneStep(t *testing.T) {
	for _, tc := range []struct {
		step time.Duration
		want time.Duration
	}{
		// Four assumed 30s scrapes dominate short steps.
		{step: 15 * time.Second, want: 2 * time.Minute},
		{step: 75 * time.Second, want: 2 * time.Minute},
		// Long steps need step + one scrape so no sample falls between windows.
		{step: 300 * time.Second, want: 330 * time.Second},
	} {
		if got := RateWindow(tc.step); got != tc.want {
			t.Errorf("RateWindow(%s) = %s, want %s", tc.step, got, tc.want)
		}
	}
}
