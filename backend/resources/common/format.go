/*
 * backend/resources/common/format.go
 *
 * Formatting helpers for resource fields.
 * - CPU, memory, and age formatting utilities.
 */

package common

import (
	"fmt"
	"time"

	"github.com/luxury-yacht/app/backend/internal/timeutil"
	"k8s.io/apimachinery/pkg/api/resource"
)

// FormatAge mirrors kubectl style age formatting.
func FormatAge(t time.Time) string {
	return timeutil.FormatAge(t)
}

// FormatCPU renders CPU quantities in millicores or cores.
func FormatCPU(q *resource.Quantity) string {
	if q == nil || q.IsZero() {
		return "-"
	}
	milliCores := q.MilliValue()
	if milliCores < 1000 {
		return fmt.Sprintf("%dm", milliCores)
	}
	return fmt.Sprintf("%.2f", float64(milliCores)/1000)
}

// FormatMemory renders memory quantities with binary suffixes.
func FormatMemory(q *resource.Quantity) string {
	if q == nil || q.IsZero() {
		return "-"
	}

	bytes := q.Value()

	const (
		ki = 1024
		mi = ki * 1024
		gi = mi * 1024
	)

	switch {
	case bytes >= gi:
		return fmt.Sprintf("%.2fGi", float64(bytes)/float64(gi))
	case bytes >= mi:
		return fmt.Sprintf("%.0fMi", float64(bytes)/float64(mi))
	case bytes >= ki:
		return fmt.Sprintf("%.0fKi", float64(bytes)/float64(ki))
	default:
		return fmt.Sprintf("%d", bytes)
	}
}
