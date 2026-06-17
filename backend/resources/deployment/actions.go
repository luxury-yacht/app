package deployment

import (
	"context"
	"fmt"
	"sort"
	"strconv"

	corev1 "k8s.io/api/core/v1"

	"github.com/luxury-yacht/app/backend/refresh/kindspec"
	"github.com/luxury-yacht/app/backend/resources/common"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes"
)

// workloadRestart, workloadScale and workloadCurrentReplicas are this kind's
// mutating actions, registered on its Descriptor.Workload so the action handlers
// dispatch by kind from the registry instead of switching on it.
func workloadRestart(ctx context.Context, client kubernetes.Interface, namespace, name string, patch []byte) error {
	_, err := client.AppsV1().Deployments(namespace).Patch(ctx, name, types.StrategicMergePatchType, patch, metav1.PatchOptions{})
	return err
}

func workloadScale(ctx context.Context, client kubernetes.Interface, namespace, name string, replicas int32) error {
	_, err := client.AppsV1().Deployments(namespace).UpdateScale(ctx, name, kindspec.ScaleObject(namespace, name, replicas), metav1.UpdateOptions{})
	return err
}

func workloadCurrentReplicas(ctx context.Context, client kubernetes.Interface, namespace, name string) (int32, error) {
	obj, err := client.AppsV1().Deployments(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return 0, err
	}
	if obj.Spec.Replicas == nil {
		return 1, nil
	}
	return *obj.Spec.Replicas, nil
}

func revisionHistory(ctx context.Context, client kubernetes.Interface, namespace, name string) ([]common.WorkloadRevision, error) {
	deploy, err := client.AppsV1().Deployments(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get deployment %s/%s: %w", namespace, name, err)
	}
	currentRevision, _ := strconv.ParseInt(deploy.Annotations[common.RevisionAnnotation], 10, 64)
	rsList, err := client.AppsV1().ReplicaSets(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to list replicasets in %s: %w", namespace, err)
	}
	var entries []common.WorkloadRevision
	for i := range rsList.Items {
		rs := &rsList.Items[i]
		if !common.IsOwnedBy(rs.OwnerReferences, deploy.UID) {
			continue
		}
		revStr, ok := rs.Annotations[common.RevisionAnnotation]
		if !ok {
			continue
		}
		rev, err := strconv.ParseInt(revStr, 10, 64)
		if err != nil {
			continue
		}
		podTemplateYAML, err := common.MarshalPodTemplate(&rs.Spec.Template)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal pod template for replicaset %s: %w", rs.Name, err)
		}
		entries = append(entries, common.WorkloadRevision{
			Revision:    rev,
			CreatedAt:   rs.CreationTimestamp.UTC().Format("2006-01-02T15:04:05Z"),
			ChangeCause: rs.Annotations[common.ChangeCauseAnnotation],
			Current:     rev == currentRevision,
			PodTemplate: podTemplateYAML,
		})
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Revision > entries[j].Revision })
	return entries, nil
}

func applyPodTemplate(ctx context.Context, client kubernetes.Interface, namespace, name string, template corev1.PodTemplateSpec) error {
	deploy, err := client.AppsV1().Deployments(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("failed to get deployment %s/%s: %w", namespace, name, err)
	}
	deploy.Spec.Template = template
	if _, err := client.AppsV1().Deployments(namespace).Update(ctx, deploy, metav1.UpdateOptions{}); err != nil {
		return fmt.Errorf("failed to update deployment %s/%s: %w", namespace, name, err)
	}
	return nil
}
