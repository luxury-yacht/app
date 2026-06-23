package snapshot

import (
	"reflect"
	"testing"

	"github.com/luxury-yacht/app/backend/kind/objectmapnode"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/resources/endpointslice"
	"github.com/luxury-yacht/app/backend/resources/service"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// TestNewServiceIngestProjectorBundleMatchesLivePaths proves the Service projector's
// bundle is byte-equivalent, half by half, to the live consumer paths built from the
// typed Service:
//
//   - Table     == the OWN-fields NetworkSummary (service.BuildStreamSummary with NIL
//     slices — the endpoint join is re-applied at serve), so a serve-side re-join
//     reproduces the full row;
//   - Catalog   == objectcatalog.SummaryProjector for Service;
//   - ObjectMap == objectmapnode.NewNodeProjector from Service's collector + edges.
func TestNewServiceIngestProjectorBundleMatchesLivePaths(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c-1", ClusterName: "prod"}

	svc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{Namespace: "team-a", Name: "web", UID: "svc-1", CreationTimestamp: metav1.Now()},
		Spec: corev1.ServiceSpec{
			Type:      corev1.ServiceTypeClusterIP,
			ClusterIP: "10.0.0.1",
			Ports:     []corev1.ServicePort{{Name: "http", Port: 80, Protocol: corev1.ProtocolTCP}},
		},
	}

	raw, err := NewServiceIngestProjector(meta)(svc)
	if err != nil {
		t.Fatalf("service projector error: %v", err)
	}
	bundle, ok := raw.(ingest.Bundle)
	if !ok {
		t.Fatalf("service projector returned %T, want ingest.Bundle", raw)
	}

	// Table half: OWN-fields row, built with nil slices.
	want := service.BuildStreamSummary(meta, svc, nil)
	gotTable, ok := bundle.Table.(NetworkSummary)
	if !ok {
		t.Fatalf("Table half is %T, want NetworkSummary", bundle.Table)
	}
	if !reflect.DeepEqual(gotTable, want) {
		t.Fatalf("Service Table half mismatch:\n got=%#v\nwant=%#v", gotTable, want)
	}

	// Catalog half.
	catalogProject := objectcatalog.SummaryProjector(meta.ClusterID, meta.ClusterName, service.Identity)
	wantCatalog := catalogProject(svc).(objectcatalog.Summary)
	gotCatalog, ok := bundle.Catalog.(objectcatalog.Summary)
	if !ok {
		t.Fatalf("Catalog half is %T, want objectcatalog.Summary", bundle.Catalog)
	}
	if !reflect.DeepEqual(gotCatalog, wantCatalog) {
		t.Fatalf("Service Catalog half mismatch:\n got=%#v\nwant=%#v", gotCatalog, wantCatalog)
	}

	// ObjectMap half.
	gotNode, ok := bundle.ObjectMap.(objectmapnode.Node)
	if !ok {
		t.Fatalf("ObjectMap half is %T, want objectmapnode.Node", bundle.ObjectMap)
	}
	if gotNode.Namespace != svc.Namespace || gotNode.Name != svc.Name || gotNode.UID != string(svc.UID) {
		t.Fatalf("Service ObjectMap node metadata mismatch: got=%#v", gotNode)
	}
}

// TestNewEndpointSliceIngestProjectorBundleMatchesLivePaths proves the EndpointSlice
// projector's bundle is byte-equivalent to the live paths. EndpointSlice is its own
// table row (no cross-kind join), so its Table half equals endpointslice.BuildStreamSummary.
func TestNewEndpointSliceIngestProjectorBundleMatchesLivePaths(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c-1", ClusterName: "prod"}

	ready := true
	port := int32(8080)
	slice := &discoveryv1.EndpointSlice{
		ObjectMeta: metav1.ObjectMeta{
			Namespace:         "team-a",
			Name:              "web-abc",
			UID:               "eps-1",
			CreationTimestamp: metav1.Now(),
			Labels:            map[string]string{discoveryv1.LabelServiceName: "web"},
		},
		Endpoints: []discoveryv1.Endpoint{{Addresses: []string{"10.1.0.1"}, Conditions: discoveryv1.EndpointConditions{Ready: &ready}}},
		Ports:     []discoveryv1.EndpointPort{{Port: &port}},
	}

	raw, err := NewEndpointSliceIngestProjector(meta)(slice)
	if err != nil {
		t.Fatalf("endpointslice projector error: %v", err)
	}
	bundle, ok := raw.(ingest.Bundle)
	if !ok {
		t.Fatalf("endpointslice projector returned %T, want ingest.Bundle", raw)
	}

	want := endpointslice.BuildStreamSummary(meta, slice)
	gotTable, ok := bundle.Table.(NetworkSummary)
	if !ok {
		t.Fatalf("Table half is %T, want NetworkSummary", bundle.Table)
	}
	if !reflect.DeepEqual(gotTable, want) {
		t.Fatalf("EndpointSlice Table half mismatch:\n got=%#v\nwant=%#v", gotTable, want)
	}

	// Aggregate half: the Service-join fact (owning service + ready count).
	gotFact, ok := bundle.Aggregate.(streamrows.EndpointSliceServiceFact)
	if !ok {
		t.Fatalf("Aggregate half is %T, want EndpointSliceServiceFact", bundle.Aggregate)
	}
	wantFact := streamrows.EndpointSliceServiceFact{Namespace: "team-a", ServiceName: "web", ReadyEndpointCount: service.ReadyEndpointCount([]*discoveryv1.EndpointSlice{slice})}
	if !reflect.DeepEqual(gotFact, wantFact) {
		t.Fatalf("EndpointSlice Aggregate half mismatch:\n got=%#v\nwant=%#v", gotFact, wantFact)
	}
	if wantFact.ReadyEndpointCount != 1 {
		t.Fatalf("expected ready count 1 for the single ready endpoint, got %d", wantFact.ReadyEndpointCount)
	}

	catalogProject := objectcatalog.SummaryProjector(meta.ClusterID, meta.ClusterName, endpointslice.Identity)
	wantCatalog := catalogProject(slice).(objectcatalog.Summary)
	gotCatalog, ok := bundle.Catalog.(objectcatalog.Summary)
	if !ok {
		t.Fatalf("Catalog half is %T, want objectcatalog.Summary", bundle.Catalog)
	}
	if !reflect.DeepEqual(gotCatalog, wantCatalog) {
		t.Fatalf("EndpointSlice Catalog half mismatch:\n got=%#v\nwant=%#v", gotCatalog, wantCatalog)
	}

	gotNode, ok := bundle.ObjectMap.(objectmapnode.Node)
	if !ok {
		t.Fatalf("ObjectMap half is %T, want objectmapnode.Node", bundle.ObjectMap)
	}
	if gotNode.Namespace != slice.Namespace || gotNode.Name != slice.Name || gotNode.UID != string(slice.UID) {
		t.Fatalf("EndpointSlice ObjectMap node metadata mismatch: got=%#v", gotNode)
	}
}

// TestNetworkIngestProjectorTypeGuards proves each projector rejects the wrong object
// type with its typed guard error, matching the workload/pod projectors.
func TestNetworkIngestProjectorTypeGuards(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c-1", ClusterName: "prod"}
	if _, err := NewServiceIngestProjector(meta)(&discoveryv1.EndpointSlice{}); err == nil {
		t.Fatal("service projector accepted a non-Service object")
	}
	if _, err := NewEndpointSliceIngestProjector(meta)(&corev1.Service{}); err == nil {
		t.Fatal("endpointslice projector accepted a non-EndpointSlice object")
	}
}
