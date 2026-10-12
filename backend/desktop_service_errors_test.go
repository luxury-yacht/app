package backend

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/luxury-yacht/app/backend/internal/errorstatus"
)

// bindingErrorProbe is a bound service whose methods fail in each way a real
// binding can.
type bindingErrorProbe struct{}

func (bindingErrorProbe) ReturnsNotFound() error {
	return fmt.Errorf("get deployment: %w", apierrors.NewNotFound(schema.GroupResource{Group: "apps", Resource: "deployments"}, "web"))
}

func (bindingErrorProbe) ReturnsPlainError() error { return errors.New("invariant violated") }

func (bindingErrorProbe) TakesCount(int) error { return nil }

func (bindingErrorProbe) Panics() error { panic("boom") }

func callProbe(t *testing.T, method string, args ...string) *application.CallError {
	t.Helper()
	application.New(application.Options{})
	bindings := application.NewBindings(nil, nil)
	require.NoError(t, bindings.Add(application.NewServiceWithOptions(
		&bindingErrorProbe{},
		application.ServiceOptions{MarshalError: MarshalBindingError},
	)))
	bound := bindings.Get(&application.CallOptions{MethodName: "github.com/luxury-yacht/app/backend.bindingErrorProbe." + method})
	require.NotNil(t, bound, "probe method %s must be bound", method)
	raw := make([]json.RawMessage, 0, len(args))
	for _, arg := range args {
		raw = append(raw, json.RawMessage(arg))
	}
	_, err := bound.Call(context.Background(), raw)
	var callErr *application.CallError
	require.ErrorAs(t, err, &callErr)
	return callErr
}

func causeStatus(t *testing.T, callErr *application.CallError) errorstatus.Status {
	t.Helper()
	cause, ok := callErr.Cause.(json.RawMessage)
	require.True(t, ok, "a returned error must carry a status cause, got %T", callErr.Cause)
	var status errorstatus.Status
	require.NoError(t, json.Unmarshal(cause, &status))
	return status
}

// Every error a bound method returns reaches the frontend as a typed status in
// the rejection's cause; Wails framework failures (panic, wrong arity) bypass
// the marshaler and carry no cause.
func TestBoundMethodErrorsCarryClassifiedStatus(t *testing.T) {
	t.Run("returned Kubernetes error", func(t *testing.T) {
		status := causeStatus(t, callProbe(t, "ReturnsNotFound"))
		require.Equal(t, errorstatus.ReasonNotFound, status.Reason)
		require.Equal(t, errorstatus.CategoryNotFound, status.Category)
		require.True(t, status.Expected)
	})

	t.Run("returned plain error", func(t *testing.T) {
		callErr := callProbe(t, "ReturnsPlainError")
		status := causeStatus(t, callErr)
		require.Equal(t, errorstatus.ReasonUnknown, status.Reason)
		require.False(t, status.Expected)
		require.Equal(t, "invariant violated", callErr.Message, "the message stays the error text")
	})

	t.Run("argument decode failure", func(t *testing.T) {
		status := causeStatus(t, callProbe(t, "TakesCount", `"not a number"`))
		require.Equal(t, errorstatus.ReasonBadRequest, status.Reason)
	})

	t.Run("panic", func(t *testing.T) {
		require.Nil(t, callProbe(t, "Panics").Cause)
	})

	t.Run("wrong argument count", func(t *testing.T) {
		require.Nil(t, callProbe(t, "TakesCount").Cause)
	})
}

func TestMarshalBindingErrorAlwaysReturnsStatusJSON(t *testing.T) {
	var status errorstatus.Status
	require.NoError(t, json.Unmarshal(MarshalBindingError(errors.New("boom")), &status))
	require.Equal(t, "Status", status.Kind)
	require.Equal(t, "boom", status.Message)
}
