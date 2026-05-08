package types

import (
	"testing"

	"github.com/luxury-yacht/app/backend/resourcemodel"
)

func TestRefOrDisplayFromResourceLinkProjectsOpenableRefs(t *testing.T) {
	link := resourcemodel.NewNamespacedResourceLink("cluster-a", "apps", "v1", "Deployment", "deployments", "prod", "api", "uid-a")

	projected := RefOrDisplayFromResourceLink(link)
	if projected.Ref == nil {
		t.Fatal("expected openable ref projection")
	}
	if projected.Display != nil {
		t.Fatal("openable projection must not also contain display")
	}
	if projected.Ref.ClusterID != "cluster-a" || projected.Ref.Group != "apps" || projected.Ref.Version != "v1" || projected.Ref.Kind != "Deployment" || projected.Ref.Namespace != "prod" || projected.Ref.Name != "api" {
		t.Fatalf("unexpected ref projection: %#v", projected.Ref)
	}
}

func TestRefOrDisplayFromResourceLinkProjectsDisplayOnlyRefs(t *testing.T) {
	link := resourcemodel.NewDisplayResourceLink("cluster-a", "example.io", "", "DeletedThing", "", "prod", "gone")

	projected := RefOrDisplayFromResourceLink(link)
	if projected.Display == nil {
		t.Fatal("expected display-only projection")
	}
	if projected.Ref != nil {
		t.Fatal("display-only projection must not also contain ref")
	}
	if projected.Display.ClusterID != "cluster-a" || projected.Display.Group != "example.io" || projected.Display.Kind != "DeletedThing" || projected.Display.Namespace != "prod" || projected.Display.Name != "gone" {
		t.Fatalf("unexpected display projection: %#v", projected.Display)
	}
}
