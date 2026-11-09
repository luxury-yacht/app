package errorstatus

import (
	"errors"
	"fmt"
	"testing"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// Callers treat a confirmed absence as the object being gone for good, so every
// 404 that is not the API saying exactly that must stay unconfirmed.
func TestConfirmsObjectAbsentOnlyForTheExactObject(t *testing.T) {
	pods := schema.GroupResource{Resource: "pods"}
	cases := []struct {
		name      string
		err       error
		confirmed bool
	}{
		{"the API reports this object missing", apierrors.NewNotFound(pods, "web"), true},
		{"the same report behind wrapping", fmt.Errorf("get: %w", apierrors.NewNotFound(pods, "web")), true},
		{"a different object of the same resource", apierrors.NewNotFound(pods, "other"), false},
		{"another resource with the same name", apierrors.NewNotFound(schema.GroupResource{Resource: "configmaps"}, "web"), false},
		{"the same resource name in another group", apierrors.NewNotFound(schema.GroupResource{Group: "example.com", Resource: "pods"}, "web"), false},
		{"a plain 404, which client-go still labels with the request", apierrors.NewGenericServerResponse(404, "GET", pods, "web", "404 page not found", 0, true), false},
		{"the API server's 404 for a route with no handler", apierrors.NewGenericServerResponse(404, "", schema.GroupResource{}, "", "not found", 0, false), false},
		{"a conflict about this object", apierrors.NewConflict(pods, "web", errors.New("changed")), false},
		{"no error", nil, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := ConfirmsObjectAbsent(tc.err, pods, "web"); got != tc.confirmed {
				t.Fatalf("got %v, want %v for %v", got, tc.confirmed, tc.err)
			}
		})
	}
}
