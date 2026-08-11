package errorcapture

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/url"
	"testing"

	"github.com/luxury-yacht/app/backend/internal/authstate"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime/schema"
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
			name: "raw structured authentication failure",
			err:  apierrors.NewUnauthorized("credentials rejected"),
			want: true,
		},
		{
			name: "structured permission failure",
			err: apierrors.NewForbidden(
				schema.GroupResource{Resource: "pods"},
				"pod-a",
				errors.New("permission denied"),
			),
			want: false,
		},
		{
			name: "wrapped structured not found failure",
			err: fmt.Errorf(
				"resource fetch failed: %w",
				apierrors.NewNotFound(schema.GroupResource{Resource: "pods"}, "pod-a"),
			),
			want: true,
		},
		{
			name: "unstructured not found application failure",
			err:  errors.New("cache invariant failed after 404 not found"),
			want: false,
		},
		{
			name: "raw credential helper failure",
			err:  errors.New("getting credentials: exec: executable aws failed with exit code 255"),
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
			name: "URL network operation timeout",
			err: &url.Error{
				Op:  "Get",
				URL: "https://cluster.example.test",
				Err: &net.OpError{
					Op:  "dial",
					Net: "tcp",
					Err: syntheticNetworkTimeout{},
				},
			},
			want: true,
		},
		{
			name: "API server unavailable",
			err:  apierrors.NewServiceUnavailable("cluster temporarily unavailable"),
			want: true,
		},
		{name: "cancellation", err: context.Canceled, want: true},
		{name: "deadline exceeded", err: context.DeadlineExceeded, want: false},
		{
			name: "wrapped deadline exceeded",
			err:  fmt.Errorf("resource fetch failed: %w", context.DeadlineExceeded),
			want: false,
		},
		{
			name: "URL application failure",
			err: &url.Error{
				Op:  "Get",
				URL: "https://cluster.example.test",
				Err: errors.New("redirect policy rejected"),
			},
			want: false,
		},
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

type syntheticNetworkTimeout struct{}

func (syntheticNetworkTimeout) Error() string { return "synthetic network timeout" }

func (syntheticNetworkTimeout) Timeout() bool { return true }

func (syntheticNetworkTimeout) Is(target error) bool { return target == context.DeadlineExceeded }
