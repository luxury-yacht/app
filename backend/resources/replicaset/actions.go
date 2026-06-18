package replicaset

import (
	"context"

	"github.com/luxury-yacht/app/backend/kind/kindspec"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

// workloadScale and workloadCurrentReplicas are this kind's mutating workload
// actions — ReplicaSets are scalable but not rollout-restartable — registered on
// its Descriptor.Workload.
func workloadScale(ctx context.Context, client kubernetes.Interface, namespace, name string, replicas int32) error {
	_, err := client.AppsV1().ReplicaSets(namespace).UpdateScale(ctx, name, kindspec.ScaleObject(namespace, name, replicas), metav1.UpdateOptions{})
	return err
}

func workloadCurrentReplicas(ctx context.Context, client kubernetes.Interface, namespace, name string) (int32, error) {
	obj, err := client.AppsV1().ReplicaSets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return 0, err
	}
	if obj.Spec.Replicas == nil {
		return 1, nil
	}
	return *obj.Spec.Replicas, nil
}
