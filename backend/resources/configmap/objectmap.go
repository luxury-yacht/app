/*
 * backend/resources/configmap/objectmap.go
 *
 * ConfigMap's object-map status projection, co-located with its model.
 */

package configmap

import (
	"github.com/luxury-yacht/app/backend/kind/objectmap"
	corev1 "k8s.io/api/core/v1"
)

// ObjectMapStatus projects a ConfigMap into its object-map node status.
func ObjectMapStatus(clusterID string, configMap corev1.ConfigMap) *objectmap.Status {
	return objectmap.FromResourceModel(BuildResourceModel(clusterID, &configMap))
}
