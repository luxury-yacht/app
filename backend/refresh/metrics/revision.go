package metrics

import "strconv"

// Revision returns the source clock for the latest metrics collection attempt.
// Successful samples advance with their collection timestamp. Failed attempts
// also advance the clock so consumers can leave loading or display stale data.
func Revision(metadata Metadata) string {
	failed := metadata.ConsecutiveFailures > 0 || metadata.LastError != ""
	if metadata.CollectedAt.IsZero() {
		if !failed || metadata.FailureCount == 0 {
			return ""
		}
		return "failure:" + strconv.FormatUint(metadata.FailureCount, 10)
	}

	revision := strconv.FormatInt(metadata.CollectedAt.UnixNano(), 10)
	if !failed {
		return revision
	}
	return revision + ":failure:" + strconv.FormatUint(metadata.FailureCount, 10)
}
