package refresh

import "testing"

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
	if IsPermissionDenied(nil) {
		t.Fatalf("expected nil not to be permission denied")
	}
}
