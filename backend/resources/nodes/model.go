/*
 * backend/resources/nodes/model.go
 *
 * Node resource model: the single definition of a Node's intrinsic fields + status
 * presentation. Nodes build their ResourceModel directly (cluster-scoped, with a
 * cordoned status badge) rather than via the network base. Shared primitives
 * (ResourceModel/ConditionFacts/CopyStringMap) come from resourcemodel.
 */

package nodes

import (
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	corev1 "k8s.io/api/core/v1"
)

// BuildResourceModel builds the Node resource model. Facts are owned by this
// package (nodes.Facts); callers needing facts use BuildFacts.
func BuildResourceModel(clusterID string, node *corev1.Node) resourcemodel.ResourceModel {
	facts := BuildFacts(node)
	status := buildStatus(node, facts)

	return resourcemodel.ResourceModel{
		Ref: resourcemodel.ResourceRef{
			ClusterID: clusterID,
			Group:     "",
			Version:   "v1",
			Kind:      "Node",
			Resource:  "nodes",
			Name:      node.Name,
			UID:       string(node.UID),
		},
		Source: resourcemodel.ResourceSourceKubernetes,
		Scope:  resourcemodel.ResourceScopeCluster,
		Metadata: resourcemodel.ResourceMetadata{
			Labels:            resourcemodel.CopyStringMap(node.Labels),
			Annotations:       resourcemodel.CopyStringMap(node.Annotations),
			CreationTimestamp: node.CreationTimestamp,
			ResourceVersion:   node.ResourceVersion,
			Finalizers:        append([]string(nil), node.Finalizers...),
		},
		Status: status,
		Facts:  resourcemodel.ResourceFacts{},
	}
}

// BuildFacts extracts the Node facts from the raw object.
func BuildFacts(node *corev1.Node) Facts {
	conditions := make([]resourcemodel.ConditionFacts, 0, len(node.Status.Conditions))
	for _, condition := range node.Status.Conditions {
		conditions = append(conditions, resourcemodel.ConditionFacts{
			Type:               string(condition.Type),
			Status:             string(condition.Status),
			Reason:             condition.Reason,
			Message:            condition.Message,
			LastTransitionTime: condition.LastTransitionTime,
		})
	}

	taints := make([]TaintFacts, 0, len(node.Spec.Taints))
	cordonedByTaint := false
	for _, taint := range node.Spec.Taints {
		if taint.Key == corev1.TaintNodeUnschedulable {
			cordonedByTaint = true
		}
		taints = append(taints, TaintFacts{
			Key:    taint.Key,
			Value:  taint.Value,
			Effect: string(taint.Effect),
		})
	}

	return Facts{
		Roles:         roles(node),
		Unschedulable: node.Spec.Unschedulable,
		Cordoned:      node.Spec.Unschedulable || cordonedByTaint,
		Conditions:    conditions,
		Taints:        taints,
	}
}

func buildStatus(node *corev1.Node, facts Facts) resourcemodel.ResourceStatusPresentation {
	lifecycle := resourcemodel.ResourceLifecycle{
		Deleting:         node.DeletionTimestamp != nil,
		FinalizerBlocked: node.DeletionTimestamp != nil && len(node.Finalizers) > 0,
	}

	ready := findCondition(node, corev1.NodeReady)
	readyStatus := string(corev1.ConditionUnknown)
	signals := make([]resourcemodel.ResourceStatusSignal, 0, 2)
	if ready != nil {
		readyStatus = string(ready.Status)
		signals = append(signals, resourcemodel.ResourceStatusSignal{
			Type:    resourcemodel.StatusSignalCondition,
			Name:    string(corev1.NodeReady),
			Status:  string(ready.Status),
			Reason:  ready.Reason,
			Message: ready.Message,
		})
	}
	if lifecycle.Deleting {
		deletionTimestamp := node.DeletionTimestamp.Time.Format(time.RFC3339)
		signals = append(signals, resourcemodel.ResourceStatusSignal{
			Type:   resourcemodel.StatusSignalDeletion,
			Name:   "metadata.deletionTimestamp",
			Status: deletionTimestamp,
		})
		return resourcemodel.ResourceStatusPresentation{
			Label:        "Terminating",
			State:        readyStatus,
			Presentation: "terminating",
			Reason:       "DeletionTimestamp",
			Signals:      signals,
			Lifecycle:    lifecycle,
		}
	}
	if facts.Cordoned {
		signals = append(signals, cordonedSignal(facts))
	}

	if ready == nil {
		return resourcemodel.ResourceStatusPresentation{
			Label:        "Unknown",
			State:        readyStatus,
			Presentation: "unknown",
			Signals:      signals,
			Lifecycle:    lifecycle,
		}
	}

	switch ready.Status {
	case corev1.ConditionTrue:
		if facts.Cordoned {
			return resourcemodel.ResourceStatusPresentation{
				Label:        "Ready (Cordoned)",
				State:        readyStatus,
				Presentation: "cordoned",
				Reason:       "Unschedulable",
				Signals:      signals,
				Badges:       []resourcemodel.ResourceStatusBadge{{Text: "Cordoned", Status: cordonedStatus(facts)}},
				Lifecycle:    lifecycle,
			}
		}
		return resourcemodel.ResourceStatusPresentation{
			Label:        "Ready",
			State:        readyStatus,
			Presentation: "ready",
			Signals:      signals,
			Lifecycle:    lifecycle,
		}
	case corev1.ConditionUnknown:
		return resourcemodel.ResourceStatusPresentation{
			Label:        "Unknown",
			State:        readyStatus,
			Presentation: "unknown",
			Reason:       ready.Reason,
			Signals:      signals,
			Lifecycle:    lifecycle,
		}
	default:
		return resourcemodel.ResourceStatusPresentation{
			Label:        "NotReady",
			State:        readyStatus,
			Presentation: "not-ready",
			Reason:       ready.Reason,
			Signals:      signals,
			Lifecycle:    lifecycle,
		}
	}
}

func cordonedSignal(facts Facts) resourcemodel.ResourceStatusSignal {
	if facts.Unschedulable {
		return resourcemodel.ResourceStatusSignal{
			Type:   resourcemodel.StatusSignalResourceState,
			Name:   "spec.unschedulable",
			Status: strconv.FormatBool(facts.Unschedulable),
			Reason: "Unschedulable",
		}
	}
	for _, taint := range facts.Taints {
		if taint.Key == corev1.TaintNodeUnschedulable {
			return resourcemodel.ResourceStatusSignal{
				Type:   resourcemodel.StatusSignalResourceState,
				Name:   taint.Key,
				Status: taint.Effect,
				Reason: "UnschedulableTaint",
			}
		}
	}
	return resourcemodel.ResourceStatusSignal{
		Type:   resourcemodel.StatusSignalResourceState,
		Name:   "spec.unschedulable",
		Status: strconv.FormatBool(facts.Unschedulable),
		Reason: "Unschedulable",
	}
}

func cordonedStatus(facts Facts) string {
	if facts.Unschedulable {
		return strconv.FormatBool(facts.Unschedulable)
	}
	for _, taint := range facts.Taints {
		if taint.Key == corev1.TaintNodeUnschedulable {
			return taint.Effect
		}
	}
	return strconv.FormatBool(facts.Cordoned)
}

func findCondition(node *corev1.Node, conditionType corev1.NodeConditionType) *corev1.NodeCondition {
	for index := range node.Status.Conditions {
		if node.Status.Conditions[index].Type == conditionType {
			return &node.Status.Conditions[index]
		}
	}
	return nil
}

func roles(node *corev1.Node) []string {
	result := make([]string, 0, len(node.Labels))
	for label := range node.Labels {
		if role, ok := strings.CutPrefix(label, "node-role.kubernetes.io/"); ok {
			if role != "" {
				result = append(result, role)
			}
		}
	}
	sort.Strings(result)
	return result
}
