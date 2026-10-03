package containerlogs

import (
	"sort"

	corev1 "k8s.io/api/core/v1"
)

const DefaultPerScopeTargetLimit = 100
const (
	MinPerScopeTargetLimit = 1
	MaxPerScopeTargetLimit = 1000
)

func ClampPerScopeTargetLimit(limit int) int {
	if limit < MinPerScopeTargetLimit {
		return MinPerScopeTargetLimit
	}
	if limit > MaxPerScopeTargetLimit {
		return MaxPerScopeTargetLimit
	}
	return limit
}

type SelectedTarget struct {
	Namespace string
	PodName   string
	Container ContainerRef
}

func (t SelectedTarget) Key() string {
	return t.Namespace + "/" + t.PodName + "/" + t.Container.SelectionValue()
}

func SelectTargets(
	pods []*corev1.Pod,
	selection ScopeSelection,
	limit int,
) ([]SelectedTarget, int) {
	if limit <= 0 {
		limit = DefaultPerScopeTargetLimit
	}
	limit = ClampPerScopeTargetLimit(limit)

	ranked := rankTargets(pods, selection)
	total := len(ranked)
	if total == 0 {
		return nil, 0
	}
	if total > limit {
		ranked = ranked[:limit]
	}

	selected := make([]SelectedTarget, 0, len(ranked))
	for _, target := range ranked {
		selected = append(selected, target.target)
	}
	return selected, total
}

type rankedTarget struct {
	target SelectedTarget
	rank   int
}

// rankTargets lists every selected container, best log candidates first.
func rankTargets(pods []*corev1.Pod, selection ScopeSelection) []rankedTarget {
	var ranked []rankedTarget
	for _, pod := range pods {
		if pod == nil {
			continue
		}
		rank := rankPodForLogs(pod)
		for _, container := range EnumerateContainers(pod, selection) {
			ranked = append(ranked, rankedTarget{
				target: SelectedTarget{Namespace: pod.Namespace, PodName: pod.Name, Container: container},
				rank:   rank,
			})
		}
	}
	sort.Slice(ranked, func(i, j int) bool {
		return lessRankedTarget(ranked[i], ranked[j])
	})
	return ranked
}

func lessRankedTarget(left, right rankedTarget) bool {
	if left.rank != right.rank {
		return left.rank < right.rank
	}
	if left.target.PodName != right.target.PodName {
		return left.target.PodName < right.target.PodName
	}
	return left.target.Container.Name < right.target.Container.Name
}

// WarningKind names a typed notice about logs the viewer is not showing.
type WarningKind string

const (
	// WarningTargetLimit means a target limit hid some containers.
	WarningTargetLimit WarningKind = "targetLimit"
	// WarningDropped means entries were lost because the client fell behind.
	WarningDropped WarningKind = "dropped"
)

// LimitScope says which target limit hid containers.
type LimitScope string

const (
	// LimitPerTab is the per-scope (per-tab) target limit.
	LimitPerTab LimitScope = "perTab"
	// LimitGlobal is the limit shared by every open log stream.
	LimitGlobal LimitScope = "global"
)

// Warning is a typed notice about logs the viewer is not showing. Scope,
// Hidden and Limit describe a target limit; Count is the number of dropped
// entries.
type Warning struct {
	Kind   WarningKind `json:"kind"`
	Scope  LimitScope  `json:"scope,omitempty"`
	Hidden int         `json:"hidden,omitempty"`
	Limit  int         `json:"limit,omitempty"`
	Count  int         `json:"count,omitempty"`
}

// TargetLimitWarnings reports the containers a target limit hid, if any.
func TargetLimitWarnings(scope LimitScope, selectedCount, totalCount, limit int) []Warning {
	if totalCount <= selectedCount {
		return nil
	}
	return []Warning{{Kind: WarningTargetLimit, Scope: scope, Hidden: totalCount - selectedCount, Limit: limit}}
}

func rankPodForLogs(pod *corev1.Pod) int {
	if pod == nil {
		return 3
	}
	ready := false
	for _, condition := range pod.Status.Conditions {
		if condition.Type == corev1.PodReady && condition.Status == corev1.ConditionTrue {
			ready = true
			break
		}
	}
	switch {
	case pod.Status.Phase == corev1.PodRunning && ready:
		return 0
	case pod.Status.Phase == corev1.PodRunning:
		return 1
	default:
		return 2
	}
}
