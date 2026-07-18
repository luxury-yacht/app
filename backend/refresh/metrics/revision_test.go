package metrics

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestRevisionTracksActiveFailureWithoutChangingSuccessfulSampleClock(t *testing.T) {
	collectedAt := time.Unix(1700000000, 42)
	require.Equal(t, "1700000000000000042", Revision(Metadata{
		CollectedAt:  collectedAt,
		SuccessCount: 2,
		FailureCount: 1,
	}))
	require.Equal(t, "1700000000000000042:failure:2", Revision(Metadata{
		CollectedAt:         collectedAt,
		SuccessCount:        2,
		FailureCount:        2,
		ConsecutiveFailures: 1,
		LastError:           "metrics request failed",
	}))
	require.Equal(t, "failure:1", Revision(Metadata{
		FailureCount:        1,
		ConsecutiveFailures: 1,
		LastError:           "metrics request failed",
	}))
}
