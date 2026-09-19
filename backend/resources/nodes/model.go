/*
 * backend/resources/nodes/model.go
 *
 * Node resource model: canonical identity and metadata with readiness, deletion
 * and cordon evidence. Details and table projections read other fields directly.
 */

package nodes

import (
	"github.com/luxury-yacht/app/backend/resourcemodel"
	corev1 "k8s.io/api/core/v1"
)

// BuildResourceModel builds the Node identity, copied metadata and status.
func BuildResourceModel(clusterID string, node *corev1.Node) resourcemodel.ResourceModel {
	meta := node.ObjectMeta
	meta.Namespace = ""
	return resourcemodel.KubernetesResourceModel(clusterID, Identity, meta, buildStatus(node))
}

func buildStatus(node *corev1.Node) resourcemodel.ResourceStatusPresentation {
	lifecycle := resourcemodel.ObjectLifecycle(node.ObjectMeta)
	ready := findCondition(node, corev1.NodeReady)
	readyStatus := string(corev1.ConditionUnknown)
	signals := make([]resourcemodel.ResourceStatusSignal, 0, 2)
	if ready != nil {
		readyStatus = string(ready.Status)
		signals = append(signals, resourcemodel.ResourceStatusSignal{
			Type: resourcemodel.StatusSignalCondition,
			Name: string(corev1.NodeReady), Status: readyStatus,
			Reason: ready.Reason, Message: ready.Message,
		})
	}
	if status, ok := resourcemodel.DeletingObjectStatus(node.ObjectMeta, readyStatus, signals, lifecycle); ok {
		return status
	}
	cordon, cordoned := nodeCordonSignal(node)
	if cordoned {
		signals = append(signals, cordon)
	}
	status := resourcemodel.ObjectSourceStatus("Unknown", readyStatus, "", "", "unknown", signals, lifecycle)
	if ready == nil {
		return status
	}
	switch ready.Status {
	case corev1.ConditionTrue:
		status.Label = "Ready"
		status.Presentation = "ready"
		if cordoned {
			status.Label = "Ready (Cordoned)"
			status.Presentation = "cordoned"
			status.Reason = "Unschedulable"
			status.Badges = []resourcemodel.ResourceStatusBadge{{Text: "Cordoned", Status: cordon.Status}}
		}
	case corev1.ConditionUnknown:
		status.Reason = ready.Reason
	default:
		status.Label = "NotReady"
		status.Presentation = "not-ready"
		status.Reason = ready.Reason
	}
	return status
}

func nodeCordonSignal(node *corev1.Node) (resourcemodel.ResourceStatusSignal, bool) {
	if node.Spec.Unschedulable {
		return resourcemodel.ResourceStatusSignal{
			Type: resourcemodel.StatusSignalResourceState,
			Name: "spec.unschedulable", Status: "true", Reason: "Unschedulable",
		}, true
	}
	for _, taint := range node.Spec.Taints {
		if taint.Key == corev1.TaintNodeUnschedulable {
			return resourcemodel.ResourceStatusSignal{
				Type: resourcemodel.StatusSignalResourceState,
				Name: taint.Key, Status: string(taint.Effect), Reason: "UnschedulableTaint",
			}, true
		}
	}
	return resourcemodel.ResourceStatusSignal{}, false
}

func findCondition(node *corev1.Node, conditionType corev1.NodeConditionType) *corev1.NodeCondition {
	for index := range node.Status.Conditions {
		if node.Status.Conditions[index].Type == conditionType {
			return &node.Status.Conditions[index]
		}
	}
	return nil
}
