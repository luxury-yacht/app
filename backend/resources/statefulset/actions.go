package statefulset

import (
	"context"
	"encoding/json"
	"fmt"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"

	"github.com/luxury-yacht/app/backend/kind/kindspec"
	"github.com/luxury-yacht/app/backend/resources/common"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes"
)

func workloadRestart(ctx context.Context, client kubernetes.Interface, namespace, name string, patch []byte) error {
	_, err := client.AppsV1().StatefulSets(namespace).Patch(ctx, name, types.StrategicMergePatchType, patch, metav1.PatchOptions{})
	return err
}

func workloadScale(ctx context.Context, client kubernetes.Interface, namespace, name string, replicas int32) error {
	_, err := client.AppsV1().StatefulSets(namespace).UpdateScale(ctx, name, kindspec.ScaleObject(namespace, name, replicas), metav1.UpdateOptions{})
	return err
}

func workloadCurrentReplicas(ctx context.Context, client kubernetes.Interface, namespace, name string) (int32, error) {
	obj, err := client.AppsV1().StatefulSets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return 0, err
	}
	if obj.Spec.Replicas == nil {
		return 1, nil
	}
	return *obj.Spec.Replicas, nil
}

func revisionHistory(ctx context.Context, client kubernetes.Interface, namespace, name string) ([]common.WorkloadRevision, error) {
	sts, err := client.AppsV1().StatefulSets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get statefulset %s/%s: %w", namespace, name, err)
	}
	return common.ControllerRevisionEntries(ctx, client, namespace, sts.UID, sts.Status.CurrentRevision, extractPodTemplate)
}

func extractPodTemplate(cr *appsv1.ControllerRevision) (string, error) {
	if cr.Data.Raw == nil {
		return "", nil
	}
	var obj appsv1.StatefulSet
	if err := json.Unmarshal(cr.Data.Raw, &obj); err != nil {
		return "", fmt.Errorf("failed to unmarshal statefulset data: %w", err)
	}
	return common.MarshalPodTemplate(&obj.Spec.Template)
}

func applyPodTemplate(ctx context.Context, client kubernetes.Interface, namespace, name string, template corev1.PodTemplateSpec) error {
	obj, err := client.AppsV1().StatefulSets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("failed to get statefulset %s/%s: %w", namespace, name, err)
	}
	obj.Spec.Template = template
	if _, err := client.AppsV1().StatefulSets(namespace).Update(ctx, obj, metav1.UpdateOptions{}); err != nil {
		return fmt.Errorf("failed to update statefulset %s/%s: %w", namespace, name, err)
	}
	return nil
}

// ForwardPodName finds a ready pod for the named StatefulSet (via its label selector).
func ForwardPodName(ctx context.Context, client kubernetes.Interface, namespace, name string) (string, error) {
	obj, err := client.AppsV1().StatefulSets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return "", fmt.Errorf("failed to get statefulset: %w", err)
	}
	pods, err := common.ListPodsForSelector(ctx, client, namespace, obj.Spec.Selector)
	if err != nil {
		return "", err
	}
	return common.PickReadyPodName(common.FilterPodsByControllerOwner(pods, "StatefulSet", obj.Name), "StatefulSet", name)
}
