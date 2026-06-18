package daemonset

import (
	"context"
	"encoding/json"
	"fmt"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"

	"github.com/luxury-yacht/app/backend/resources/common"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes"
)

// workloadRestart is this kind's only mutating workload action — DaemonSets are not
// scalable — registered on its Descriptor.Workload.
func workloadRestart(ctx context.Context, client kubernetes.Interface, namespace, name string, patch []byte) error {
	_, err := client.AppsV1().DaemonSets(namespace).Patch(ctx, name, types.StrategicMergePatchType, patch, metav1.PatchOptions{})
	return err
}

func revisionHistory(ctx context.Context, client kubernetes.Interface, namespace, name string) ([]common.WorkloadRevision, error) {
	ds, err := client.AppsV1().DaemonSets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get daemonset %s/%s: %w", namespace, name, err)
	}
	return common.ControllerRevisionEntries(ctx, client, namespace, ds.UID, "", extractPodTemplate)
}

func extractPodTemplate(cr *appsv1.ControllerRevision) (string, error) {
	if cr.Data.Raw == nil {
		return "", nil
	}
	var obj appsv1.DaemonSet
	if err := json.Unmarshal(cr.Data.Raw, &obj); err != nil {
		return "", fmt.Errorf("failed to unmarshal daemonset data: %w", err)
	}
	return common.MarshalPodTemplate(&obj.Spec.Template)
}

func applyPodTemplate(ctx context.Context, client kubernetes.Interface, namespace, name string, template corev1.PodTemplateSpec) error {
	obj, err := client.AppsV1().DaemonSets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("failed to get daemonset %s/%s: %w", namespace, name, err)
	}
	obj.Spec.Template = template
	if _, err := client.AppsV1().DaemonSets(namespace).Update(ctx, obj, metav1.UpdateOptions{}); err != nil {
		return fmt.Errorf("failed to update daemonset %s/%s: %w", namespace, name, err)
	}
	return nil
}

// ForwardPodName finds a ready pod for the named DaemonSet (via its label selector).
func ForwardPodName(ctx context.Context, client kubernetes.Interface, namespace, name string) (string, error) {
	obj, err := client.AppsV1().DaemonSets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return "", fmt.Errorf("failed to get daemonset: %w", err)
	}
	pods, err := common.ListPodsForSelector(ctx, client, namespace, obj.Spec.Selector)
	if err != nil {
		return "", err
	}
	return common.PickReadyPodName(common.FilterPodsByControllerOwner(pods, "DaemonSet", obj.Name), "DaemonSet", name)
}
