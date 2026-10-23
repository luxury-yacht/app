package replicaset

import (
	"context"
	"strings"

	"github.com/luxury-yacht/app/backend/internal/containerlogs"
	"github.com/luxury-yacht/app/backend/kind/logspec"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

// LogsTarget reads the containers of the pods its spec selector matches.
var LogsTarget = logspec.Target{Resolve: func(
	ctx context.Context, client kubernetes.Interface, namespace, name string, _ func(string) bool,
) (logspec.Resolution, error) {
	return containerlogs.ResolveWorkload(ctx, client, namespace, name, strings.ToLower(Identity.Kind),
		func(ctx context.Context) (*metav1.LabelSelector, error) {
			object, err := client.AppsV1().ReplicaSets(namespace).Get(ctx, name, metav1.GetOptions{})
			if err != nil {
				return nil, err
			}
			return object.Spec.Selector, nil
		})
}}
