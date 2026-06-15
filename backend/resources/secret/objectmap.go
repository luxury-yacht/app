/*
 * backend/resources/secret/objectmap.go
 *
 * Secret's object-map status projection, co-located with its model.
 */

package secret

import (
	"github.com/luxury-yacht/app/backend/refresh/objectmap"
	corev1 "k8s.io/api/core/v1"
)

// ObjectMapStatus projects a Secret into its object-map node status.
func ObjectMapStatus(clusterID string, sec corev1.Secret) *objectmap.Status {
	return objectmap.FromResourceModel(BuildResourceModel(clusterID, &sec))
}
