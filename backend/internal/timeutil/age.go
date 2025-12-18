package timeutil

import (
	"fmt"
	"time"
)

// FormatAge returns a human-readable duration similar to kubectl output.
func FormatAge(t time.Time) string {
	if t.IsZero() {
		return "0s"
	}

	duration := time.Since(t)
	if duration < 0 {
		duration = 0
	}

	seconds := int(duration.Seconds())
	if seconds < 120 {
		return fmt.Sprintf("%ds", seconds)
	}

	minutes := seconds / 60
	if minutes < 60 {
		return fmt.Sprintf("%dm", minutes)
	}

	hours := minutes / 60
	if hours < 24 {
		return fmt.Sprintf("%dh", hours)
	}

	days := hours / 24
	hours = hours % 24
	if days < 7 {
		return fmt.Sprintf("%dd%dhr", days, hours)
	}
	if days < 30 {
		return fmt.Sprintf("%dd", days)
	}

	months := days / 30
	if months < 12 {
		return fmt.Sprintf("%dmo", months)
	}

	years := months / 12
	months = months % 12
	if months == 0 {
		return fmt.Sprintf("%dyr", years)
	}
	return fmt.Sprintf("%dyr%dmo", years, months)
}
