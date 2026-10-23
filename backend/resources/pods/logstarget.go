package pods

import (
	"github.com/luxury-yacht/app/backend/internal/containerlogs"
	"github.com/luxury-yacht/app/backend/kind/logspec"
)

// LogsTarget reads one pod's containers: the pod itself, watched by name.
var LogsTarget = logspec.Target{SinglePod: true, Resolve: containerlogs.ResolvePod}
