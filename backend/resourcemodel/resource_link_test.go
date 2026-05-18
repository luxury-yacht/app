package resourcemodel

import (
	"testing"
)

func TestResourceLinkConstructorsProduceExclusiveLinks(t *testing.T) {
	openable := NewNamespacedResourceLink("cluster-a", "apps", "v1", "Deployment", "deployments", "prod", "api", "uid-a")
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
	ref := NewResourceRef("cluster-a", "", "v1", "Pod", "pods", "default", "api", "")
	display := NewDisplayRef("cluster-a", "", "v1", "Pod", "pods", "default", "api", "")
	if err := ValidateResourceLink(ResourceLink{Ref: &ref, Display: &display}); err == nil {
		t.Fatal("expected ambiguous ref+display link to fail validation")
	}

	if err := ValidateResourceLink(NewNamespacedResourceLink("cluster-a", "", "", "Pod", "pods", "default", "api", "")); err == nil {
		t.Fatal("expected openable ref without version to fail validation")
	}

	if err := ValidateResourceLink(NewDisplayResourceLink("", "", "", "Pod", "", "default", "api")); err == nil {
		t.Fatal("expected display ref without clusterId to fail validation")
	}
}

func TestValidateResourceRefRejectsMissingGroupForNonCoreResource(t *testing.T) {
	if err := ValidateResourceRef(NewResourceRef("cluster-a", "", "v1", "Deployment", "deployments", "default", "api", "")); err == nil {
		t.Fatal("expected non-core ref without group to fail validation")
	}

	if err := ValidateResourceRef(NewResourceRef("cluster-a", "", "v1", "EndpointSlice", "endpointslices", "default", "api", "")); err == nil {
		t.Fatal("expected EndpointSlice without discovery group to fail validation")
	}
}
