/*
 * backend/resources/serviceaccount/objectmap.go
 *
 * ServiceAccount's object-map status projection, co-located with its model. The
 * object map does not materialize reverse links (nil relationships).
 */

package serviceaccount

import (
	"github.com/luxury-yacht/app/backend/refresh/objectmap"
	corev1 "k8s.io/api/core/v1"
)

// ObjectMapStatus projects a ServiceAccount into its object-map node status.
func ObjectMapStatus(clusterID string, sa corev1.ServiceAccount) *objectmap.Status {
	return objectmap.FromResourceModel(BuildResourceModel(clusterID, &sa, nil))
}
