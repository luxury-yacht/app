package backend

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestResolveWindowRestoreAgainstCurrentWorkAreas(t *testing.T) {
	tests := []struct {
		name     string
		saved    WindowSettings
		areas    []WindowWorkArea
		want     WindowGeometry
		position bool
	}{
		{
			name:     "one monitor preserves visible geometry",
			saved:    WindowSettings{X: 100, Y: 80, Width: 1200, Height: 800},
			areas:    []WindowWorkArea{{X: 0, Y: 0, Width: 1920, Height: 1040, Primary: true}},
			want:     WindowGeometry{X: 100, Y: 80, Width: 1200, Height: 800},
			position: true,
		},
		{
			name:  "negative coordinates remain valid on a left monitor",
			saved: WindowSettings{X: -1800, Y: 100, Width: 1200, Height: 800},
			areas: []WindowWorkArea{
				{X: -1920, Y: 0, Width: 1920, Height: 1040},
				{X: 0, Y: 0, Width: 1920, Height: 1040, Primary: true},
			},
			want:     WindowGeometry{X: -1800, Y: 100, Width: 1200, Height: 800},
			position: true,
		},
		{
			name:     "removed monitor centers on the primary work area",
			saved:    WindowSettings{X: 2200, Y: 100, Width: 1200, Height: 800},
			areas:    []WindowWorkArea{{X: 0, Y: 0, Width: 1920, Height: 1040, Primary: true}},
			want:     WindowGeometry{X: 360, Y: 120, Width: 1200, Height: 800},
			position: true,
		},
		{
			name:     "reachable partially visible window is preserved",
			saved:    WindowSettings{X: -32, Y: 100, Width: 1200, Height: 800},
			areas:    []WindowWorkArea{{X: 0, Y: 0, Width: 1920, Height: 1040, Primary: true}},
			want:     WindowGeometry{X: -32, Y: 100, Width: 1200, Height: 800},
			position: true,
		},
		{
			name:     "inaccessible title bar is clamped into the work area",
			saved:    WindowSettings{X: 100, Y: -780, Width: 1200, Height: 800},
			areas:    []WindowWorkArea{{X: 0, Y: 0, Width: 1920, Height: 1040, Primary: true}},
			want:     WindowGeometry{X: 100, Y: 0, Width: 1200, Height: 800},
			position: true,
		},
		{
			name:     "oversized window is fitted to the current work area",
			saved:    WindowSettings{X: 50, Y: 50, Width: 2400, Height: 1400},
			areas:    []WindowWorkArea{{X: 0, Y: 0, Width: 1920, Height: 1040, Primary: true}},
			want:     WindowGeometry{X: 0, Y: 0, Width: 1920, Height: 1040},
			position: true,
		},
		{
			name:     "logical work areas need no physical DPI conversion",
			saved:    WindowSettings{X: 1280, Y: 80, Width: 1100, Height: 700},
			areas:    []WindowWorkArea{{X: 1280, Y: 0, Width: 1707, Height: 960, Primary: true}},
			want:     WindowGeometry{X: 1280, Y: 80, Width: 1100, Height: 700},
			position: true,
		},
		{
			name:     "unavailable screen information does not guess a position",
			saved:    WindowSettings{X: -1800, Y: 100, Width: 1200, Height: 800},
			want:     WindowGeometry{X: -1800, Y: 100, Width: 1200, Height: 800},
			position: false,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, position := resolveWindowRestore(test.saved, test.areas)
			require.Equal(t, test.want, got)
			require.Equal(t, test.position, position)
		})
	}
}
