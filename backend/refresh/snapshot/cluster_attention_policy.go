package snapshot

import (
	"strings"
	"time"
)

// AttentionSeverity is the closed, ordered vocabulary used by every Attention
// finding, query facet, sort, and frontend presentation.
type AttentionSeverity string

const (
	AttentionSeverityInfo    AttentionSeverity = "info"
	AttentionSeverityWarning AttentionSeverity = "warning"
	AttentionSeverityError   AttentionSeverity = "error"
)

// attentionClassificationRule is the single policy table for status-derived
// Attention findings. Rules are evaluated in order, so specific intentional
// states precede the generic unhealthy-presentation rules.
type attentionClassificationRule struct {
	ID                    string
	Label                 string
	Sources               []attentionSource
	Kinds                 []string
	Presentations         []string
	ExcludedPresentations []string
	Statuses              []string
	StatusReasons         []string
	Severity              AttentionSeverity
	Grace                 time.Duration
	GraceSeverity         AttentionSeverity
	FindingReason         string
}

var attentionClassificationRules = []attentionClassificationRule{
	{
		ID: "workload-scaled-to-zero", Label: "Scaled to zero", Sources: []attentionSource{attentionSourceWorkload},
		Kinds: []string{"Deployment", "StatefulSet"}, Presentations: []string{"inactive"},
		StatusReasons: []string{"ScaledToZero"}, Severity: AttentionSeverityInfo,
		FindingReason: "Scaled to 0",
	},
	{
		ID: "cronjob-idle", Label: "Idle CronJobs", Sources: []attentionSource{attentionSourceWorkload},
		Kinds: []string{"CronJob"}, Presentations: []string{"inactive"}, Statuses: []string{"Idle"},
		Severity: AttentionSeverityInfo, FindingReason: "Idle",
	},
	{
		ID: "daemonset-no-eligible-nodes", Label: "DaemonSets with no eligible nodes", Sources: []attentionSource{attentionSourceWorkload},
		Kinds: []string{"DaemonSet"}, Presentations: []string{"warning"}, StatusReasons: []string{"NoEligibleNodes"},
		Severity: AttentionSeverityInfo, FindingReason: "No eligible nodes",
	},
	{
		ID: "error-presentation", Label: "Error status", Sources: []attentionSource{attentionSourcePod, attentionSourceWorkload, attentionSourceNode},
		Presentations: []string{"error"}, Severity: AttentionSeverityError,
	},
	{
		ID: "pod-unhealthy", Label: "Unhealthy pods", Sources: []attentionSource{attentionSourcePod},
		ExcludedPresentations: []string{"", "ready", "success"},
		Severity:              AttentionSeverityWarning, Grace: attentionWarningGrace, GraceSeverity: AttentionSeverityInfo,
	},
	{
		ID: "workload-unhealthy", Label: "Unhealthy workloads", Sources: []attentionSource{attentionSourceWorkload},
		ExcludedPresentations: []string{"", "ready", "success"},
		Severity:              AttentionSeverityWarning, Grace: attentionWarningGrace,
	},
	{
		ID: "node-unhealthy", Label: "Unhealthy nodes", Sources: []attentionSource{attentionSourceNode},
		ExcludedPresentations: []string{"", "ready", "success"}, Severity: AttentionSeverityWarning,
	},
	{
		ID: "warning-event", Label: "Warning events", Sources: []attentionSource{attentionSourceEvent},
		Statuses: []string{"Warning"}, Severity: AttentionSeverityWarning,
	},
}

type attentionSignal string

const (
	attentionSignalPodNotReady     attentionSignal = "pod-not-ready"
	attentionSignalRestarts        attentionSignal = "restarts"
	attentionSignalReplicaMismatch attentionSignal = "replica-mismatch"
)

type attentionSignalPolicy struct {
	Severity      AttentionSeverity
	Grace         time.Duration
	GraceSeverity AttentionSeverity
	Label         string
}

var attentionSignalPolicies = map[attentionSignal]attentionSignalPolicy{
	attentionSignalPodNotReady:     {Severity: AttentionSeverityWarning, Grace: attentionWarningGrace, GraceSeverity: AttentionSeverityInfo, Label: "Pods not ready"},
	attentionSignalRestarts:        {Severity: AttentionSeverityWarning, Label: "Restarts"},
	attentionSignalReplicaMismatch: {Severity: AttentionSeverityWarning, Grace: attentionWarningGrace, Label: "Replica mismatch"},
}

var attentionSignalOrder = []attentionSignal{
	attentionSignalPodNotReady,
	attentionSignalRestarts,
	attentionSignalReplicaMismatch,
}

// AttentionFindingTypes returns the stable, display-labeled suppression
// vocabulary in policy order.
func AttentionFindingTypes() []AttentionFindingTypeDefinition {
	definitions := make([]AttentionFindingTypeDefinition, 0, len(attentionClassificationRules)+len(attentionSignalOrder))
	seen := make(map[string]struct{}, cap(definitions))
	for _, rule := range attentionClassificationRules {
		if _, exists := seen[rule.ID]; exists {
			continue
		}
		seen[rule.ID] = struct{}{}
		definitions = append(definitions, AttentionFindingTypeDefinition{ID: rule.ID, Label: rule.Label})
	}
	for _, signal := range attentionSignalOrder {
		policy := attentionSignalPolicies[signal]
		id := string(signal)
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		definitions = append(definitions, AttentionFindingTypeDefinition{ID: id, Label: policy.Label})
	}
	return definitions
}

// IsAttentionFindingType reports whether id belongs to the centralized
// suppression vocabulary.
func IsAttentionFindingType(id string) bool {
	id = strings.TrimSpace(id)
	for _, definition := range AttentionFindingTypes() {
		if definition.ID == id {
			return true
		}
	}
	return false
}

type attentionSeverityDefinition struct {
	Priority int
	SortRank float64
}

var attentionSeverityDefinitions = map[AttentionSeverity]attentionSeverityDefinition{
	AttentionSeverityInfo:    {Priority: 1, SortRank: 2},
	AttentionSeverityWarning: {Priority: 2, SortRank: 1},
	AttentionSeverityError:   {Priority: 3, SortRank: 0},
}

func classifyAttentionSource(record attentionSourceRecord) (attentionClassificationRule, bool) {
	for _, rule := range attentionClassificationRules {
		if rule.matches(record) {
			return rule, true
		}
	}
	return attentionClassificationRule{}, false
}

func (r attentionClassificationRule) matches(record attentionSourceRecord) bool {
	return attentionRuleValueMatches(string(record.Source), r.Sources) &&
		attentionRuleValueMatches(record.Ref.Kind, r.Kinds) &&
		attentionRuleValueMatches(record.StatusPresentation, r.Presentations) &&
		!attentionRuleValueExcluded(record.StatusPresentation, r.ExcludedPresentations) &&
		attentionRuleValueMatches(record.Status, r.Statuses) &&
		attentionRuleValueMatches(record.StatusReason, r.StatusReasons)
}

func attentionRuleValueMatches[T ~string](value string, allowed []T) bool {
	if len(allowed) == 0 {
		return true
	}
	value = strings.TrimSpace(value)
	for _, candidate := range allowed {
		if strings.EqualFold(value, strings.TrimSpace(string(candidate))) {
			return true
		}
	}
	return false
}

func attentionRuleValueExcluded(value string, excluded []string) bool {
	return len(excluded) > 0 && attentionRuleValueMatches(value, excluded)
}

func attentionClassificationReason(rule attentionClassificationRule, record attentionSourceRecord) string {
	return firstNonEmpty(rule.FindingReason, record.StatusReason, record.Status)
}

func attentionPolicyForSignal(signal attentionSignal) attentionSignalPolicy {
	return attentionSignalPolicies[signal]
}

func moreSevereAttentionLevel(left, right AttentionSeverity) AttentionSeverity {
	if attentionSeverityPriority(right) > attentionSeverityPriority(left) {
		return right
	}
	return left
}

func attentionSeverityPriority(severity AttentionSeverity) int {
	return attentionSeverityDefinitions[severity].Priority
}

func attentionSeveritySortRank(severity AttentionSeverity) (float64, bool) {
	definition, ok := attentionSeverityDefinitions[severity]
	return definition.SortRank, ok
}
