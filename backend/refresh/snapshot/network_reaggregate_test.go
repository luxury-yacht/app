package snapshot

import (
	"reflect"
	"testing"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/service"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// TestReaggregateServiceSummaryMatchesTypedJoin proves the serve-side Service re-join is
// byte-identical to service.BuildStreamSummary(meta, svc, slices) — the typed path — for
// the full range of endpoint states: no slices, ready endpoints, not-ready-only, and a
// mix. The own-row is the projector's Table half (built with nil slices); the re-join
// overlays the endpoint count from the slices, exactly as reaggregateWorkloadSummary
// overlays the pod join.
func TestReaggregateServiceSummaryMatchesTypedJoin(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c-1", ClusterName: "prod"}

	svc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{Namespace: "team-a", Name: "web", UID: "svc-1", CreationTimestamp: metav1.Now()},
		Spec: corev1.ServiceSpec{
			Type:      corev1.ServiceTypeClusterIP,
			ClusterIP: "10.0.0.1",
			Ports:     []corev1.ServicePort{{Name: "http", Port: 80, Protocol: corev1.ProtocolTCP}},
		},
	}

	ready := true
	notReady := false
	p := int32(8080)
	sliceReady := &discoveryv1.EndpointSlice{
		ObjectMeta: metav1.ObjectMeta{Namespace: "team-a", Name: "web-r", Labels: map[string]string{discoveryv1.LabelServiceName: "web"}},
		Endpoints:  []discoveryv1.Endpoint{{Addresses: []string{"10.1.0.1", "10.1.0.2"}, Conditions: discoveryv1.EndpointConditions{Ready: &ready}}},
		Ports:      []discoveryv1.EndpointPort{{Port: &p}},
	}
	sliceNotReady := &discoveryv1.EndpointSlice{
		ObjectMeta: metav1.ObjectMeta{Namespace: "team-a", Name: "web-n", Labels: map[string]string{discoveryv1.LabelServiceName: "web"}},
		Endpoints:  []discoveryv1.Endpoint{{Addresses: []string{"10.1.0.9"}, Conditions: discoveryv1.EndpointConditions{Ready: &notReady}}},
		Ports:      []discoveryv1.EndpointPort{{Port: &p}},
	}

	cases := []struct {
		name   string
		slices []*discoveryv1.EndpointSlice
	}{
		{"no slices", nil},
		{"empty slices", []*discoveryv1.EndpointSlice{}},
		{"ready endpoints", []*discoveryv1.EndpointSlice{sliceReady}},
		{"not-ready only", []*discoveryv1.EndpointSlice{sliceNotReady}},
		{"mixed", []*discoveryv1.EndpointSlice{sliceReady, sliceNotReady}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ownRow := service.BuildStreamSummary(meta, svc, nil)
			// The serve path accumulates the ready count per slice (the bundle Aggregate
			// half); summing per-slice counts must equal the typed full-slice count.
			summedReady := 0
			for _, s := range tc.slices {
				summedReady += service.ReadyEndpointCount([]*discoveryv1.EndpointSlice{s})
			}
			if summedReady != service.ReadyEndpointCount(tc.slices) {
				t.Fatalf("per-slice ready sum %d != full-slice count %d", summedReady, service.ReadyEndpointCount(tc.slices))
			}
			got := reaggregateServiceSummary(ownRow, summedReady)
			want := service.BuildStreamSummary(meta, svc, tc.slices)
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("re-join mismatch:\n got=%#v\nwant=%#v", got, want)
			}
		})
	}
}

// TestReaggregateServiceSummaryDoesNotMutateOwnRow proves the serve-time join never
// writes into the own-row's Details backing array. The own-row is served from the
// shared maintained store, so every Build receives the SAME slice; an in-place
// append (spare capacity) would let one request's join clobber another's row.
func TestReaggregateServiceSummaryDoesNotMutateOwnRow(t *testing.T) {
	details := make([]resourcemodel.DetailSegment, 0, 8) // spare capacity — in-place append would alias
	details = append(details,
		resourcemodel.DetailSegment{Label: "Type", Value: "ClusterIP"},
		resourcemodel.DetailSegment{Label: "ClusterIP", Value: "10.0.0.1"},
	)
	own := NetworkSummary{Details: details}

	first := reaggregateServiceSummary(own, 3)
	second := reaggregateServiceSummary(own, 5)

	if len(own.Details) != 2 {
		t.Fatalf("own row mutated: %#v", own.Details)
	}
	if got := first.Details[len(first.Details)-1].Value; got != "3" {
		t.Fatalf("first join clobbered: Addresses=%q, want 3", got)
	}
	if got := second.Details[len(second.Details)-1].Value; got != "5" {
		t.Fatalf("second join wrong: Addresses=%q, want 5", got)
	}
}
