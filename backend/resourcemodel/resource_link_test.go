package resourcemodel

import (
	"testing"
)

func TestResourceLinkConstructorsProduceExclusiveLinks(t *testing.T) {
	openable := NewNamespacedResourceLink(ResourceRef{ClusterID: "cluster-a", Group: "apps", Version: "v1", Kind: "Deployment", Resource: "deployments", Namespace: "prod", Name: "api", UID: "uid-a"})
	if openable.Ref == nil {
		t.Fatal("openable link should carry ref")
	}
	if openable.Display != nil {
		t.Fatal("openable link must not also carry display")
	}
	if err := ValidateResourceLink(openable); err != nil {
		t.Fatalf("openable link should validate: %v", err)
	}

	displayOnly := NewDisplayResourceLink("cluster-a", "example.io", "", "DeletedThing", "", "prod", "gone")
	if displayOnly.Display == nil {
		t.Fatal("display-only link should carry display")
	}
	if displayOnly.Ref != nil {
		t.Fatal("display-only link must not also carry ref")
	}
	if err := ValidateResourceLink(displayOnly); err != nil {
		t.Fatalf("display-only link should validate: %v", err)
	}
}

func TestValidateResourceLinkRejectsAmbiguousAndIncompleteLinks(t *testing.T) {
	ref := NewResourceRef(ResourceRef{ClusterID: "cluster-a", Group: "", Version: "v1", Kind: "Pod", Resource: "pods", Namespace: "default", Name: "api", UID: ""})
	display := NewDisplayRef(DisplayRef{ClusterID: "cluster-a", Version: "v1", Kind: "Pod", Resource: "pods", Namespace: "default", Name: "api"})
	if err := ValidateResourceLink(ResourceLink{Ref: &ref, Display: &display}); err == nil {
		t.Fatal("expected ambiguous ref+display link to fail validation")
	}

	if err := ValidateResourceLink(NewNamespacedResourceLink(ResourceRef{ClusterID: "cluster-a", Group: "", Version: "", Kind: "Pod", Resource: "pods", Namespace: "default", Name: "api", UID: ""})); err == nil {
		t.Fatal("expected openable ref without version to fail validation")
	}

	if err := ValidateResourceLink(NewDisplayResourceLink("", "", "", "Pod", "", "default", "api")); err == nil {
		t.Fatal("expected display ref without clusterId to fail validation")
	}
}

func TestValidateResourceRefRejectsMissingGroupForNonCoreResource(t *testing.T) {
	if err := ValidateResourceRef(NewResourceRef(ResourceRef{ClusterID: "cluster-a", Group: "", Version: "v1", Kind: "Deployment", Resource: "deployments", Namespace: "default", Name: "api", UID: ""})); err == nil {
		t.Fatal("expected non-core ref without group to fail validation")
	}

	if err := ValidateResourceRef(NewResourceRef(ResourceRef{ClusterID: "cluster-a", Group: "", Version: "v1", Kind: "EndpointSlice", Resource: "endpointslices", Namespace: "default", Name: "api", UID: ""})); err == nil {
		t.Fatal("expected EndpointSlice without discovery group to fail validation")
	}
}
