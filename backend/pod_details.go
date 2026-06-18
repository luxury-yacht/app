/*
 * backend/resources_pods.go
 *
 * App-level pod resource wrappers.
 * - Bridges Wails handlers to pod services.
 * - Resolves cluster-scoped dependencies for pod actions.
 */

package backend

import "github.com/luxury-yacht/app/backend/resources/pods"

func (a *App) GetPod(clusterID, namespace, name string, detailed bool) (*PodDetailInfo, error) {
	if err := requirePodObject(namespace, name); err != nil {
		return nil, err
	}
	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	return pods.GetPod(deps, namespace, name, detailed)
}
