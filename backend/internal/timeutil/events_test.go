package timeutil

import (
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestLatestEventTimestampPrefersEventTime(t *testing.T) {
	ts := time.Now()
	evt := &corev1.Event{EventTime: metav1.NewMicroTime(ts)}
	if got := LatestEventTimestamp(evt); !got.Equal(ts) {
		t.Fatalf("expected %v, got %v", ts, got)
	}
}

func TestLatestEventTimestampFallbackOrder(t *testing.T) {
	now := time.Now()

	last := metav1.NewTime(now)
	evt := &corev1.Event{LastTimestamp: last}
	if got := LatestEventTimestamp(evt); !got.Equal(last.Time) {
		t.Fatalf("expected last timestamp %v, got %v", last.Time, got)
	}

	seriesTime := now.Add(10 * time.Second)
	evt = &corev1.Event{Series: &corev1.EventSeries{LastObservedTime: metav1.NewMicroTime(seriesTime)}}
	if got := LatestEventTimestamp(evt); !got.Equal(seriesTime) {
		t.Fatalf("expected series timestamp %v, got %v", seriesTime, got)
	}

	creation := now.Add(20 * time.Second)
	evt = &corev1.Event{ObjectMeta: metav1.ObjectMeta{CreationTimestamp: metav1.NewTime(creation)}}
	if got := LatestEventTimestamp(evt); !got.Equal(creation) {
		t.Fatalf("expected creation timestamp %v, got %v", creation, got)
	}

	first := now.Add(30 * time.Second)
	evt = &corev1.Event{FirstTimestamp: metav1.NewTime(first)}
	if got := LatestEventTimestamp(evt); !got.Equal(first) {
		t.Fatalf("expected first timestamp %v, got %v", first, got)
	}
}

func TestLatestEventTimestampNilEvent(t *testing.T) {
	if got := LatestEventTimestamp(nil); !got.IsZero() {
		t.Fatalf("expected zero time, got %v", got)
	}
}
