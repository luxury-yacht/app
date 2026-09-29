package containerlogs

import (
	"fmt"
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

func BuildTargetLimitWarnings(selectedCount, totalCount, limit int) []string {
	if totalCount <= selectedCount || selectedCount <= 0 {
		return nil
	}
	limit = ClampPerScopeTargetLimit(limit)
	hiddenCount := totalCount - selectedCount
	return []string{
		fmt.Sprintf(
			"Logs are hidden for %d containers because the per-tab limit of %d was reached. Using filters to reduce the number of containers may clear this message.",
			hiddenCount,
			limit,
		),
	}
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
