package resourcemodel

import (
	"sort"
	"strconv"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
)

func BuildNodeResourceModel(clusterID string, node *corev1.Node) ResourceModel {
	facts := buildNodeFacts(node)
	status := buildNodeStatus(node, facts)

	return ResourceModel{
		Ref: ResourceRef{
			ClusterID: clusterID,
			Group:     "",
			Version:   "v1",
			Kind:      "Node",
			Resource:  "nodes",
			Name:      node.Name,
			UID:       string(node.UID),
		},
		Source: ResourceSourceKubernetes,
		Scope:  ResourceScopeCluster,
		Metadata: ResourceMetadata{
			Labels:            copyStringMap(node.Labels),
			Annotations:       copyStringMap(node.Annotations),
			CreationTimestamp: node.CreationTimestamp,
			ResourceVersion:   node.ResourceVersion,
			Finalizers:        append([]string(nil), node.Finalizers...),
		},
		Status: status,
		Facts: ResourceFacts{
			Node: &facts,
		},
	}
}

func buildNodeFacts(node *corev1.Node) NodeFacts {
	conditions := make([]ConditionFacts, 0, len(node.Status.Conditions))
	for _, condition := range node.Status.Conditions {
		conditions = append(conditions, ConditionFacts{
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

	return NodeFacts{
		Roles:         nodeRoles(node),
		Unschedulable: node.Spec.Unschedulable,
		Cordoned:      node.Spec.Unschedulable || cordonedByTaint,
		Conditions:    conditions,
		Taints:        taints,
	}
}

func buildNodeStatus(node *corev1.Node, facts NodeFacts) ResourceStatusPresentation {
	lifecycle := ResourceLifecycle{
		Deleting:         node.DeletionTimestamp != nil,
		FinalizerBlocked: node.DeletionTimestamp != nil && len(node.Finalizers) > 0,
	}

	ready := findNodeCondition(node, corev1.NodeReady)
	readyStatus := string(corev1.ConditionUnknown)
	signals := make([]ResourceStatusSignal, 0, 2)
	if ready != nil {
		readyStatus = string(ready.Status)
		signals = append(signals, ResourceStatusSignal{
			Type:    StatusSignalCondition,
			Name:    string(corev1.NodeReady),
			Status:  string(ready.Status),
			Reason:  ready.Reason,
			Message: ready.Message,
		})
	}
	if lifecycle.Deleting {
		deletionTimestamp := node.DeletionTimestamp.Time.Format(time.RFC3339)
		signals = append(signals, ResourceStatusSignal{
			Type:   StatusSignalDeletion,
			Name:   "metadata.deletionTimestamp",
			Status: deletionTimestamp,
		})
		return ResourceStatusPresentation{
			Label:     "Terminating",
			State:     readyStatus,
			Reason:    "DeletionTimestamp",
			Signals:   signals,
			Lifecycle: lifecycle,
		}
	}
	if facts.Cordoned {
		signals = append(signals, buildNodeCordonedSignal(facts))
	}

	if ready == nil {
		return ResourceStatusPresentation{
			Label:     "Unknown",
			State:     readyStatus,
			Signals:   signals,
			Lifecycle: lifecycle,
		}
	}

	switch ready.Status {
	case corev1.ConditionTrue:
		if facts.Cordoned {
			return ResourceStatusPresentation{
				Label:     "Ready (Cordoned)",
				State:     readyStatus,
				Reason:    "Unschedulable",
				Signals:   signals,
				Badges:    []ResourceStatusBadge{{Text: "Cordoned", Status: nodeCordonedStatus(facts)}},
				Lifecycle: lifecycle,
			}
		}
		return ResourceStatusPresentation{
			Label:     "Ready",
			State:     readyStatus,
			Signals:   signals,
			Lifecycle: lifecycle,
		}
	case corev1.ConditionUnknown:
		return ResourceStatusPresentation{
			Label:     "Unknown",
			State:     readyStatus,
			Reason:    ready.Reason,
			Signals:   signals,
			Lifecycle: lifecycle,
		}
	default:
		return ResourceStatusPresentation{
			Label:     "NotReady",
			State:     readyStatus,
			Reason:    ready.Reason,
			Signals:   signals,
			Lifecycle: lifecycle,
		}
	}
}

func buildNodeCordonedSignal(facts NodeFacts) ResourceStatusSignal {
	if facts.Unschedulable {
		return ResourceStatusSignal{
			Type:   StatusSignalResourceState,
			Name:   "spec.unschedulable",
			Status: strconv.FormatBool(facts.Unschedulable),
			Reason: "Unschedulable",
		}
	}
	for _, taint := range facts.Taints {
		if taint.Key == corev1.TaintNodeUnschedulable {
			return ResourceStatusSignal{
				Type:   StatusSignalResourceState,
				Name:   taint.Key,
				Status: taint.Effect,
				Reason: "UnschedulableTaint",
			}
		}
	}
	return ResourceStatusSignal{
		Type:   StatusSignalResourceState,
		Name:   "spec.unschedulable",
		Status: strconv.FormatBool(facts.Unschedulable),
		Reason: "Unschedulable",
	}
}

func nodeCordonedStatus(facts NodeFacts) string {
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

func findNodeCondition(node *corev1.Node, conditionType corev1.NodeConditionType) *corev1.NodeCondition {
	for index := range node.Status.Conditions {
		if node.Status.Conditions[index].Type == conditionType {
			return &node.Status.Conditions[index]
		}
	}
	return nil
}

func nodeRoles(node *corev1.Node) []string {
	roles := make([]string, 0, len(node.Labels))
	for label := range node.Labels {
		if role, ok := strings.CutPrefix(label, "node-role.kubernetes.io/"); ok {
			if role != "" {
				roles = append(roles, role)
			}
		}
	}
	sort.Strings(roles)
	return roles
}

func copyStringMap(input map[string]string) map[string]string {
	if len(input) == 0 {
		return nil
	}
	output := make(map[string]string, len(input))
	for key, value := range input {
		output[key] = value
	}
	return output
}
