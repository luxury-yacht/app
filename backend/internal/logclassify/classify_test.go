package logclassify

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestClassifyKlogSeverity(t *testing.T) {
	tests := []struct {
		name string
		line string
		want string
	}{
		{name: "info", line: `I0102 19:05:24.494180 reflector.go:446] "Starting reflector"`, want: LevelInfo},
		{name: "cache populated noise", line: `I0102 19:05:24.494180 reflector.go:446] "Caches populated"`, want: LevelDebug},
		{name: "warn", line: `W1010 10:00:00 warning issued`, want: LevelWarn},
		{name: "error", line: `E1010 10:00:00 error occurred`, want: LevelError},
		{name: "fatal", line: `F1010 10:00:00 fatal error`, want: LevelError},
		{name: "debug", line: `D1010 10:00:00 debug detail`, want: LevelDebug},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.Equal(t, tt.want, Classify(tt.line))
		})
	}
}

func TestClassifyPlainText(t *testing.T) {
	tests := []struct {
		name string
		line string
		want string
	}{
		{name: "plain error", line: "error: failure", want: LevelError},
		{name: "plain failed", line: "request failed while listing pods", want: LevelError},
		{name: "plain warning", line: "warning: heads up", want: LevelWarn},
		{name: "plain warn", line: "warn: heads up", want: LevelWarn},
		{name: "metrics special case", line: "[refresh:metrics] poll failed", want: LevelError},
		{name: "plain info", line: "all good", want: LevelInfo},
		{name: "leading e is not klog error", line: "External secrets cache ready", want: LevelInfo},
		{name: "embedded source name is not error", line: "ErrorCapture initialized", want: LevelInfo},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.Equal(t, tt.want, Classify(tt.line))
		})
	}
}
