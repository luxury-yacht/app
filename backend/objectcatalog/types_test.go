package objectcatalog

import (
	"errors"
	"strings"
	"testing"
)

func TestDescriptorGVR(t *testing.T) {
	desc := Descriptor{Group: "apps", Version: "v1", Resource: "deployments"}
	gvr := desc.GVR()

	if gvr.Group != "apps" || gvr.Version != "v1" || gvr.Resource != "deployments" {
		t.Fatalf("unexpected GVR: %+v", gvr)
	}
}

func TestPartialSyncErrorHelpers(t *testing.T) {
	var empty *PartialSyncError
	if empty.Error() != "" || empty.Unwrap() != nil || empty.FailedCount() != 0 {
		t.Fatalf("unexpected nil behavior: %+v", empty)
	}

	err := &PartialSyncError{
		FailedDescriptors: []string{"pods", "deployments"},
		Err:               errors.New("boom"),
	}

	if !strings.Contains(err.Error(), "pods, deployments") {
		t.Fatalf("error string missing descriptors: %s", err.Error())
	}
	if !errors.Is(err, err.Err) {
		t.Fatalf("expected underlying error to unwrap")
	}
	if err.FailedCount() != 2 {
		t.Fatalf("expected failed count 2, got %d", err.FailedCount())
	}
}
