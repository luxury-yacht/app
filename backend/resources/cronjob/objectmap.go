/*
 * backend/resources/cronjob/objectmap.go
 *
 * CronJob's object-map status projection, co-located with its model.
 */

package cronjob

import (
	"github.com/luxury-yacht/app/backend/kind/objectmap"
	batchv1 "k8s.io/api/batch/v1"
)

// ObjectMapStatus projects a CronJob into its object-map node status.
func ObjectMapStatus(clusterID string, cron batchv1.CronJob) *objectmap.Status {
	return objectmap.FromResourceModel(BuildResourceModel(clusterID, &cron))
}
