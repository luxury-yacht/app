package objectcatalog

import (
	"context"
	"reflect"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/timeutil"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestListTargets(t *testing.T) {
	namespaced := listTargets(Descriptor{Namespaced: true}, []string{})
	if !reflect.DeepEqual(namespaced, []string{metav1.NamespaceAll}) {
		t.Fatalf("expected NamespaceAll target, got %v", namespaced)
	}

	cluster := listTargets(Descriptor{Namespaced: false}, []string{"ignored"})
	if !reflect.DeepEqual(cluster, []string{""}) {
		t.Fatalf("expected cluster target, got %v", cluster)
	}
}

func TestBuildSummaryCarriesObjectIdentity(t *testing.T) {
	svc := &Service{now: time.Now}
	desc := Descriptor{
		Kind:       "ConfigMap",
		Group:      "",
		Version:    "v1",
		Resource:   "configmaps",
		Scope:      ScopeNamespace,
		Namespaced: true,
	}
	creation := metav1.NewTime(time.Date(2024, 6, 1, 12, 0, 0, 0, time.UTC))
	summary := svc.buildSummary(desc, &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "cm",
			Namespace:         "ns",
			UID:               "uid-1",
			ResourceVersion:   "42",
			CreationTimestamp: creation,
			Labels:            map[string]string{"key": "val"},
		},
	})
	if summary.Ref.Name != "cm" || summary.Ref.Namespace != "ns" || summary.CreationTimestamp != creation.UTC().Format(time.RFC3339) || summary.LabelsDigest == "" {
		t.Fatalf("unexpected summary: %+v", summary)
	}
}

func TestFirstBatchLatencyAccessors(t *testing.T) {
	svc := &Service{}
	svc.setFirstBatchLatency(125 * time.Millisecond)
	if got := svc.FirstBatchLatency(); got != 125*time.Millisecond {
		t.Fatalf("expected latency 125ms, got %v", got)
	}
}

func TestSleepWithContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := timeutil.SleepWithContext(ctx, 10*time.Millisecond); err != context.Canceled {
		t.Fatalf("expected context cancellation, got %v", err)
	}

	if err := timeutil.SleepWithContext(context.Background(), 1*time.Millisecond); err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
}

func TestListRetryBackoff(t *testing.T) {
	if backoff := listRetryBackoff(0); backoff != config.ObjectCatalogListRetryInitialBackoff {
		t.Fatalf("expected initial backoff, got %v", backoff)
	}
	if backoff := listRetryBackoff(2); backoff != config.ObjectCatalogListRetryInitialBackoff*4 {
		t.Fatalf("unexpected backoff for attempt 2: %v", backoff)
	}
}

// Set up published query fixtures independently of the live item index. Sync
// lifecycle tests exercise catalogSync.publish instead.
func (s *Service) publishCatalogRowsForTest(rows []Summary, kinds map[string]bool, namespaces map[string]struct{}, descriptors []Descriptor, ready bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.catalogIndex.publishRows(rows, kinds, namespaces, descriptors, ready)
}
