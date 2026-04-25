package logclassify

import (
	"regexp"
	"strings"
)

const (
	LevelDebug = "debug"
	LevelInfo  = "info"
	LevelWarn  = "warn"
	LevelError = "error"
)

var (
	errorPattern = regexp.MustCompile(`\b(errors?|failed|failure|fatal|panic)\b`)
	warnPattern  = regexp.MustCompile(`\b(warns?|warnings?)\b`)
)

// Classify returns the application log level for text emitted by indirect log sinks.
// It recognizes Kubernetes klog prefixes before falling back to plain-text matching.
func Classify(message string) string {
	msg := strings.TrimSpace(message)
	if msg == "" {
		return LevelInfo
	}

	if sev, ok := ParseKlogSeverity(msg); ok {
		// klog emits "I... Caches populated" for normal startup. These are technically
		// info-level but are noisy, so treat them as debug.
		if sev == 'I' && strings.Contains(msg, `"Caches populated"`) {
			return LevelDebug
		}
		switch sev {
		case 'E', 'F':
			return LevelError
		case 'W':
			return LevelWarn
		case 'D':
			return LevelDebug
		default:
			return LevelInfo
		}
	}

	lower := strings.ToLower(msg)
	if strings.Contains(lower, "[refresh:metrics] poll failed") || errorPattern.MatchString(lower) {
		return LevelError
	}
	if warnPattern.MatchString(lower) {
		return LevelWarn
	}
	return LevelInfo
}

// ParseKlogSeverity extracts klog severity for lines starting with the standard prefix.
func ParseKlogSeverity(line string) (byte, bool) {
	if len(line) < 2 {
		return 0, false
	}
	sev := line[0]
	switch sev {
	case 'I', 'W', 'E', 'F', 'D':
		if line[1] >= '0' && line[1] <= '9' {
			return sev, true
		}
	}
	return 0, false
}

// IsErrorSeverity reports whether a klog severity should be treated as an error.
func IsErrorSeverity(sev byte) bool {
	return sev == 'E' || sev == 'F'
}
