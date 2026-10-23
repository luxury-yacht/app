package cronjob

import (
	"context"

	"github.com/luxury-yacht/app/backend/internal/containerlogs"
	"github.com/luxury-yacht/app/backend/kind/logspec"
	"k8s.io/client-go/kubernetes"
)

// LogsTarget reads the containers of the pods of the Jobs the CronJob owns, and
// follows the pods of its future Jobs through their Job's owner.
var LogsTarget = logspec.Target{Resolve: func(
	ctx context.Context, client kubernetes.Interface, namespace, name string, _ func(string) bool,
) (logspec.Resolution, error) {
	return containerlogs.ResolveCronJob(ctx, client, namespace, name)
}}
