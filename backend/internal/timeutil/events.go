package timeutil

import (
	"context"
	"time"

	corev1 "k8s.io/api/core/v1"
)

// LatestEventTimestamp extracts the freshest timestamp available for a Kubernetes event.
func LatestEventTimestamp(evt *corev1.Event) time.Time {
	if evt == nil {
		return time.Time{}
	}

	if !evt.EventTime.IsZero() {
		return evt.EventTime.Time
	}

	if !evt.LastTimestamp.IsZero() {
		return evt.LastTimestamp.Time
	}

	if evt.Series != nil && !evt.Series.LastObservedTime.IsZero() {
		return evt.Series.LastObservedTime.Time
	}

	if !evt.CreationTimestamp.IsZero() {
		return evt.CreationTimestamp.Time
	}

	if !evt.FirstTimestamp.IsZero() {
		return evt.FirstTimestamp.Time
	}

	return time.Time{}
}

// SleepWithContext pauses for the given duration or until the context is cancelled.
func SleepWithContext(ctx context.Context, d time.Duration) error {
	if ctx == nil {
		time.Sleep(d)
		return nil
	}
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
