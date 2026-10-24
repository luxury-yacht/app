package job

import (
	"context"

	"github.com/luxury-yacht/app/backend/internal/containerlogs"
	"github.com/luxury-yacht/app/backend/kind/logspec"
	"k8s.io/client-go/kubernetes"
)

// LogsTarget reads the containers of the pods the Job controller created.
var LogsTarget = logspec.Target{Resolve: func(
	ctx context.Context, client kubernetes.Interface, namespace, name string, _ func(string) bool,
) (logspec.Resolution, error) {
	return containerlogs.ResolveBySelector(ctx, client, namespace, containerlogs.JobPodsSelector(name))
}}
