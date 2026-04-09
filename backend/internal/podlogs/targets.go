package podlogs

import (
	"fmt"
	"sort"

	corev1 "k8s.io/api/core/v1"
)

const DefaultPerScopeTargetLimit = 24

type SelectedTarget struct {
	Namespace string
	PodName   string
	Container ContainerRef
}

func (t SelectedTarget) Key() string {
	return t.Namespace + "/" + t.PodName + "/" + t.Container.Name
}

func SelectTargets(pods []*corev1.Pod, containerFilter string, limit int) ([]SelectedTarget, int) {
	if len(pods) == 0 {
		return nil, 0
	}

	if limit <= 0 {
		limit = DefaultPerScopeTargetLimit
	}

	type rankedTarget struct {
		target SelectedTarget
		rank   int
	}

	var ranked []rankedTarget
	for _, pod := range pods {
		if pod == nil {
			continue
		}
		rank := rankPodForLogs(pod)
		for _, container := range EnumerateContainers(pod, containerFilter) {
			ranked = append(ranked, rankedTarget{
				target: SelectedTarget{
					Namespace: pod.Namespace,
					PodName:   pod.Name,
					Container: container,
				},
				rank: rank,
			})
		}
	}

	sort.Slice(ranked, func(i, j int) bool {
		if ranked[i].rank != ranked[j].rank {
			return ranked[i].rank < ranked[j].rank
		}
		if ranked[i].target.PodName != ranked[j].target.PodName {
			return ranked[i].target.PodName < ranked[j].target.PodName
		}
		return ranked[i].target.Container.Name < ranked[j].target.Container.Name
	})

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

func BuildTargetLimitWarnings(selectedCount, totalCount int) []string {
	if totalCount <= selectedCount || selectedCount <= 0 {
		return nil
	}
	return []string{
		fmt.Sprintf("Showing logs for %d of %d pod/container targets. Refine filters to view more.", selectedCount, totalCount),
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
