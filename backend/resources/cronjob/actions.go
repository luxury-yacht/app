package cronjob

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	batchv1 "k8s.io/api/batch/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes"
)

// TriggerManualJob creates a Job immediately from the named CronJob's jobTemplate,
// returning the created Job's name. The Job is owned by the CronJob.
func TriggerManualJob(ctx context.Context, client kubernetes.Interface, namespace, name string) (string, error) {
	cronJob, err := client.BatchV1().CronJobs(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return "", fmt.Errorf("failed to get cronjob %s/%s: %w", namespace, name, err)
	}
	if cronJob.Spec.Suspend != nil && *cronJob.Spec.Suspend {
		return "", fmt.Errorf("cannot trigger suspended cronjob %s/%s", namespace, name)
	}

	jobName := fmt.Sprintf("%s-manual-%s", name, time.Now().UTC().Format("20060102150405"))
	controller := true
	job := &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{
			Name:      jobName,
			Namespace: namespace,
			Labels:    cronJob.Spec.JobTemplate.Labels,
			Annotations: map[string]string{
				"cronjob.kubernetes.io/instantiate": "manual",
			},
			OwnerReferences: []metav1.OwnerReference{{
				APIVersion: Identity.Group + "/" + Identity.Version,
				Kind:       Identity.Kind,
				Name:       cronJob.Name,
				UID:        cronJob.UID,
				Controller: &controller,
			}},
		},
		Spec: cronJob.Spec.JobTemplate.Spec,
	}
	for k, v := range cronJob.Spec.JobTemplate.Annotations {
		job.ObjectMeta.Annotations[k] = v
	}

	createdJob, err := client.BatchV1().Jobs(namespace).Create(ctx, job, metav1.CreateOptions{})
	if err != nil {
		return "", fmt.Errorf("failed to create job from cronjob %s/%s: %w", namespace, name, err)
	}
	return createdJob.Name, nil
}

// SetSuspend patches the named CronJob's spec.suspend.
func SetSuspend(ctx context.Context, client kubernetes.Interface, namespace, name string, suspend bool) error {
	patchBytes, err := json.Marshal(map[string]any{"spec": map[string]any{"suspend": suspend}})
	if err != nil {
		return fmt.Errorf("failed to marshal suspend patch: %w", err)
	}
	if _, err := client.BatchV1().CronJobs(namespace).Patch(ctx, name, types.StrategicMergePatchType, patchBytes, metav1.PatchOptions{}); err != nil {
		return fmt.Errorf("failed to update cronjob %s/%s suspend state: %w", namespace, name, err)
	}
	return nil
}
