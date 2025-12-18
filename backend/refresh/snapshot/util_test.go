package snapshot

import (
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestResourceVersionOrTimestamp_WithResourceVersion(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			ResourceVersion: "12345",
		},
	}

	if got := resourceVersionOrTimestamp(pod); got != 12345 {
		t.Fatalf("expected resource version 12345, got %d", got)
	}
}

func TestResourceVersionOrTimestamp_FallbackTimestamp(t *testing.T) {
	now := time.Now()
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			ResourceVersion: "not-a-number",
			CreationTimestamp: metav1.Time{
				Time: now,
			},
		},
	}

	if got := resourceVersionOrTimestamp(pod); got != uint64(now.UnixNano()) {
		t.Fatalf("expected timestamp fallback %d, got %d", now.UnixNano(), got)
	}
}

func TestResourceVersionOrTimestamp_NilObject(t *testing.T) {
	if got := resourceVersionOrTimestamp(nil); got != 0 {
		t.Fatalf("expected 0 for nil object, got %d", got)
	}
}
