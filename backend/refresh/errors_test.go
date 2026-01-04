package refresh

import (
	"fmt"
	"net/http"
	"testing"
)

func TestPermissionDeniedErrorMessage(t *testing.T) {
	err := PermissionDeniedError{Domain: "catalog", Resource: "pods"}
	if err.Error() != "permission denied for domain catalog (pods)" {
		t.Fatalf("unexpected message: %s", err.Error())
	}

	err = PermissionDeniedError{Domain: "catalog"}
	if err.Error() != "permission denied for domain catalog" {
		t.Fatalf("unexpected message without resource: %s", err.Error())
	}
}

func TestIsPermissionDenied(t *testing.T) {
	err := NewPermissionDeniedError("catalog", "")
	if !IsPermissionDenied(err) {
		t.Fatalf("expected permission denied error")
	}
	wrapped := fmt.Errorf("wrapper: %w", err)
	if !IsPermissionDenied(wrapped) {
		t.Fatalf("expected wrapped permission denied error")
	}
	if IsPermissionDenied(nil) {
		t.Fatalf("expected nil not to be permission denied")
	}
}

func TestPermissionDeniedStatusFromError(t *testing.T) {
	err := NewPermissionDeniedError("catalog", "pods")
	status, ok := PermissionDeniedStatusFromError(err)
	if !ok {
		t.Fatalf("expected permission denied status")
	}
	if status.Kind != "Status" {
		t.Fatalf("expected kind Status got %s", status.Kind)
	}
	if status.APIVersion != "v1" {
		t.Fatalf("expected apiVersion v1 got %s", status.APIVersion)
	}
	if status.Code != http.StatusForbidden {
		t.Fatalf("expected code %d got %d", http.StatusForbidden, status.Code)
	}
	if status.Reason != "Forbidden" {
		t.Fatalf("expected reason Forbidden got %s", status.Reason)
	}
	if status.Details.Domain != "catalog" || status.Details.Resource != "pods" {
		t.Fatalf("unexpected details %+v", status.Details)
	}
}

func TestWrapPermissionDeniedPreservesMessage(t *testing.T) {
	original := fmt.Errorf("forbidden from upstream")
	err := WrapPermissionDenied(original, "nodes", "core/nodes")
	status, ok := PermissionDeniedStatusFromError(err)
	if !ok {
		t.Fatalf("expected wrapped permission denied status")
	}
	if status.Message != "forbidden from upstream" {
		t.Fatalf("expected wrapped message, got %s", status.Message)
	}
	if status.Details.Domain != "nodes" || status.Details.Resource != "core/nodes" {
		t.Fatalf("unexpected details %+v", status.Details)
	}
}
