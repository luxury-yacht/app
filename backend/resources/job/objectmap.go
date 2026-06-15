/*
 * backend/resources/job/objectmap.go
 *
 * Job's object-map status projection, co-located with its model.
 */

package job

import (
	"github.com/luxury-yacht/app/backend/refresh/objectmap"
	batchv1 "k8s.io/api/batch/v1"
)

// ObjectMapStatus projects a Job into its object-map node status.
func ObjectMapStatus(clusterID string, job batchv1.Job) *objectmap.Status {
	return objectmap.FromResourceModel(BuildResourceModel(clusterID, &job))
}
