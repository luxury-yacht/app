/*
 * backend/nodemaintenance/store_refusal_test.go
 *
 * A second drain of a node is refused. That is routine, not an application failure.
 */

package nodemaintenance

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/luxury-yacht/app/backend/internal/errorstatus"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
)

func TestSecondDrainOfANodeIsARoutineRefusal(t *testing.T) {
	store := NewStore(5)
	_, err := store.StartDrainForClusterIfIdle("node-1", restypes.DrainNodeOptions{}, "cluster-a", "A")
	require.NoError(t, err)

	_, err = store.StartDrainForClusterIfIdle("node-1", restypes.DrainNodeOptions{}, "cluster-a", "A")

	status := errorstatus.Classify(err)
	require.Equal(t, errorstatus.ReasonConflict, status.Reason)
	require.True(t, status.Expected, "a second drain being refused is not an application failure")
}
