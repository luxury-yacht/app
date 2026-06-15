/*
 * backend/resources/hpa/identity.go
 *
 * HorizontalPodAutoscaler's built-in resource identity, owned by the kind's
 * package. Plain struct (no resourcecontract import) so resourcecontract can
 * aggregate it. The contract lists HPA under v2 (its primary version); v1 is also
 * served (see model.BuildV1ResourceModel) but the catalog identity is v2.
 */

package hpa

// Identity is the HorizontalPodAutoscaler built-in resource identity (namespaced).
var Identity = struct {
	Group      string
	Version    string
	Kind       string
	Resource   string
	Namespaced bool
}{
	Group:      "autoscaling",
	Version:    "v2",
	Kind:       "HorizontalPodAutoscaler",
	Resource:   "horizontalpodautoscalers",
	Namespaced: true,
}
