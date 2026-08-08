package errorcapture

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"testing"

	"github.com/luxury-yacht/app/backend/internal/authstate"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
)

func TestIsExpectedClusterFailure(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{name: "nil", want: false},
		{
			name: "wrapped authentication failure",
			err: fmt.Errorf(
				"request failed: %w",
				&authstate.AuthInvalidError{Reason: "credentials rejected"},
			),
			want: true,
		},
		{
			name: "URL connectivity failure",
			err: &url.Error{
				Op:  "Get",
				URL: "https://cluster.example.test",
				Err: errors.New("connection refused"),
			},
			want: true,
		},
		{
			name: "API server unavailable",
			err:  apierrors.NewServiceUnavailable("cluster temporarily unavailable"),
			want: true,
		},
		{name: "cancellation", err: context.Canceled, want: true},
		{name: "application failure", err: errors.New("invariant violated"), want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := IsExpectedClusterFailure(tt.err); got != tt.want {
				t.Fatalf("IsExpectedClusterFailure() = %v, want %v", got, tt.want)
			}
		})
	}
}
