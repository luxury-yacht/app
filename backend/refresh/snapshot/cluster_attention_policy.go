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
	Sources               []attentionSource
	Kinds                 []string
	Presentations         []string
	ExcludedPresentations []string
	Statuses              []string
	StatusReasons         []string
	Severity              AttentionSeverity
	Grace                 time.Duration
	FindingReason         string
}

var attentionClassificationRules = []attentionClassificationRule{
	{
		ID: "workload-scaled-to-zero", Sources: []attentionSource{attentionSourceWorkload},
		Kinds: []string{"Deployment", "StatefulSet"}, Presentations: []string{"inactive"},
		StatusReasons: []string{"ScaledToZero"}, Severity: AttentionSeverityInfo,
		FindingReason: "Scaled to 0",
	},
	{
		ID: "cronjob-idle", Sources: []attentionSource{attentionSourceWorkload},
		Kinds: []string{"CronJob"}, Presentations: []string{"inactive"}, Statuses: []string{"Idle"},
		Severity: AttentionSeverityInfo, FindingReason: "Idle",
	},
	{
		ID: "daemonset-no-eligible-nodes", Sources: []attentionSource{attentionSourceWorkload},
		Kinds: []string{"DaemonSet"}, Presentations: []string{"warning"}, StatusReasons: []string{"NoEligibleNodes"},
		Severity: AttentionSeverityInfo, FindingReason: "No eligible nodes",
	},
	{
		ID: "error-presentation", Sources: []attentionSource{attentionSourcePod, attentionSourceWorkload, attentionSourceNode},
		Presentations: []string{"error"}, Severity: AttentionSeverityError,
	},
	{
		ID: "pod-unhealthy", Sources: []attentionSource{attentionSourcePod},
		ExcludedPresentations: []string{"", "ready", "success"},
		Severity:              AttentionSeverityWarning, Grace: attentionWarningGrace,
	},
	{
		ID: "workload-unhealthy", Sources: []attentionSource{attentionSourceWorkload},
		ExcludedPresentations: []string{"", "ready", "success"},
		Severity:              AttentionSeverityWarning, Grace: attentionWarningGrace,
	},
	{
		ID: "node-unhealthy", Sources: []attentionSource{attentionSourceNode},
		ExcludedPresentations: []string{"", "ready", "success"}, Severity: AttentionSeverityWarning,
	},
	{
		ID: "warning-event", Sources: []attentionSource{attentionSourceEvent},
		Statuses: []string{"Warning"}, Severity: AttentionSeverityWarning,
	},
}

type attentionSignal string

const (
	attentionSignalRestarts        attentionSignal = "restarts"
	attentionSignalReplicaMismatch attentionSignal = "replica-mismatch"
)

type attentionSignalPolicy struct {
	Severity AttentionSeverity
	Grace    time.Duration
}

var attentionSignalPolicies = map[attentionSignal]attentionSignalPolicy{
	attentionSignalRestarts:        {Severity: AttentionSeverityWarning},
	attentionSignalReplicaMismatch: {Severity: AttentionSeverityWarning, Grace: attentionWarningGrace},
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
