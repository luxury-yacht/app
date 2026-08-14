package appupdates

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestIntervalSchedulerRunsImmediatelyOnceAndStops(t *testing.T) {
	scheduler := newIntervalScheduler()
	runs := make(chan struct{}, 2)

	scheduler.Start(time.Hour, func(context.Context) { runs <- struct{}{} })
	scheduler.Start(time.Hour, func(context.Context) { t.Error("duplicate start replaced callback") })

	select {
	case <-runs:
	case <-time.After(time.Second):
		t.Fatal("scheduler did not run immediately")
	}
	scheduler.Stop()
	scheduler.Stop()
	require.Empty(t, runs)
}

func TestIntervalSchedulerRunsAtConfiguredIntervalUntilStopped(t *testing.T) {
	scheduler := newIntervalScheduler()
	runs := make(chan struct{}, 4)
	scheduler.Start(time.Millisecond, func(context.Context) {
		select {
		case runs <- struct{}{}:
		default:
		}
	})

	for range 2 {
		select {
		case <-runs:
		case <-time.After(time.Second):
			t.Fatal("scheduler did not run at its configured interval")
		}
	}
	scheduler.Stop()
}
