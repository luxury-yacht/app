package gatewayapi

import (
	"testing"

	"github.com/luxury-yacht/app/backend/resources/common"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

func TestParentReferenceRefDefaultsToGatewayAPI(t *testing.T) {
	deps := common.Dependencies{ClusterID: "cluster-a"}
	ref := parentReferenceRef(deps, "team-a", gatewayv1.ParentReference{
		Name: gatewayv1.ObjectName("edge"),
	})

	if ref.Ref == nil {
		t.Fatalf("expected object ref, got %#v", ref)
	}
	if ref.Ref.ClusterID != "cluster-a" {
		t.Fatalf("cluster ID = %q, want cluster-a", ref.Ref.ClusterID)
	}
	if ref.Ref.Group != Group || ref.Ref.Version != "v1" || ref.Ref.Kind != "Gateway" {
		t.Fatalf("unexpected GVK: %#v", ref.Ref)
	}
	if ref.Ref.Namespace != "team-a" || ref.Ref.Name != "edge" {
		t.Fatalf("unexpected object identity: %#v", ref.Ref)
	}
}

func TestBackendObjectReferenceRefDefaultsToService(t *testing.T) {
	deps := common.Dependencies{ClusterID: "cluster-a"}
	ref := backendObjectReferenceRef(deps, "team-a", gatewayv1.BackendObjectReference{
		Name: gatewayv1.ObjectName("api"),
	})

	if ref.Ref == nil {
		t.Fatalf("expected object ref, got %#v", ref)
	}
	if ref.Ref.Group != "" || ref.Ref.Version != "v1" || ref.Ref.Kind != "Service" {
		t.Fatalf("unexpected GVK: %#v", ref.Ref)
	}
	if ref.Ref.Namespace != "team-a" || ref.Ref.Name != "api" {
		t.Fatalf("unexpected object identity: %#v", ref.Ref)
	}
}

func TestReferenceGrantToWithoutNameStaysDisplayOnly(t *testing.T) {
	deps := common.Dependencies{ClusterID: "cluster-a"}
	ref := referenceGrantToRef(deps, "team-a", gatewayv1.ReferenceGrantTo{
		Group: gatewayv1.Group("example.com"),
		Kind:  gatewayv1.Kind("Widget"),
	})

	if ref.Display == nil {
		t.Fatalf("expected display ref, got %#v", ref)
	}
	if ref.Display.ClusterID != "cluster-a" || ref.Display.Group != "example.com" || ref.Display.Kind != "Widget" {
		t.Fatalf("unexpected display ref: %#v", ref.Display)
	}
}
