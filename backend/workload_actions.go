package backend

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	autoscalingv1 "k8s.io/api/autoscaling/v1"
	batchv1 "k8s.io/api/batch/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
)

const rolloutAnnotation = "kubectl.kubernetes.io/restartedAt"
const maxScaleReplicas = 1<<31 - 1

var (
	actionRestartableWorkloadKinds = map[string]struct{}{
		"Deployment":  {},
		"StatefulSet": {},
		"DaemonSet":   {},
	}
	actionScalableWorkloadKinds = map[string]struct{}{
		"Deployment":  {},
		"StatefulSet": {},
		"ReplicaSet":  {},
	}
)

func validateAppsV1WorkloadAction(action, group, version, kind string, supported map[string]struct{}) (string, error) {
	normalizedKind := strings.TrimSpace(kind)
	if _, ok := supported[normalizedKind]; !ok {
		return "", fmt.Errorf("%s not supported for workload kind %q", action, normalizedKind)
	}
	if strings.TrimSpace(group) != "apps" || strings.TrimSpace(version) != "v1" {
		apiVersion := strings.Trim(strings.TrimSpace(group)+"/"+strings.TrimSpace(version), "/")
		if apiVersion == "" {
			return "", fmt.Errorf("%s requires apiVersion for workload kind %q", action, normalizedKind)
		}
		return "", fmt.Errorf("%s not supported for %s %q", action, apiVersion, normalizedKind)
	}
	return normalizedKind, nil
}

// restartWorkload performs a rollout restart by patching the pod template metadata on the target workload.
// Supported workload kinds: Deployment, StatefulSet, DaemonSet.
func (a *App) restartWorkload(clusterID, namespace, group, version, workloadKind, name string) error {
	if err := requireNamespacedObject(namespace, name); err != nil {
		return err
	}
	_, err := a.RunObjectAction(ObjectActionRequest{
		Action: ObjectActionRestart,
		Target: objectActionTarget(
			clusterID,
			group,
			version,
			workloadKind,
			namespace,
			name,
		),
	})
	return err
}

func (a *App) restartWorkloadAction(target ObjectActionTargetRef) error {
	return a.restartWorkloadInternal(target.ClusterID, target.Namespace, target.Group, target.Version, target.Kind, target.Name)
}

func (a *App) restartWorkloadInternal(clusterID, namespace, group, version, workloadKind, name string) error {
	if err := requireNamespacedObject(namespace, name); err != nil {
		return err
	}
	workloadKind, err := validateAppsV1WorkloadAction("restart", group, version, workloadKind, actionRestartableWorkloadKinds)
	if err != nil {
		return err
	}

	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return err
	}
	if deps.KubernetesClient == nil {
		return fmt.Errorf("kubernetes client is not initialized")
	}

	annotationValue := time.Now().UTC().Format(time.RFC3339)
	patch := map[string]any{
		"spec": map[string]any{
			"template": map[string]any{
				"metadata": map[string]any{
					"annotations": map[string]any{
						rolloutAnnotation: annotationValue,
					},
				},
			},
		},
	}

	patchBytes, err := json.Marshal(patch)
	if err != nil {
		return fmt.Errorf("failed to marshal restart patch: %w", err)
	}

	ctx := deps.Context
	if ctx == nil {
		ctx = context.Background()
	}

	switch workloadKind {
	case "Deployment":
		if err := a.requireResourcePermission(ctx, deps, resourcePermissionCheck{
			Group:     group,
			Version:   version,
			Kind:      workloadKind,
			Namespace: namespace,
			Name:      name,
			Verb:      "patch",
		}); err != nil {
			return err
		}
		_, err = deps.KubernetesClient.AppsV1().Deployments(namespace).Patch(
			ctx,
			name,
			types.StrategicMergePatchType,
			patchBytes,
			metav1.PatchOptions{},
		)
	case "StatefulSet":
		if err := a.requireResourcePermission(ctx, deps, resourcePermissionCheck{
			Group:     group,
			Version:   version,
			Kind:      workloadKind,
			Namespace: namespace,
			Name:      name,
			Verb:      "patch",
		}); err != nil {
			return err
		}
		_, err = deps.KubernetesClient.AppsV1().StatefulSets(namespace).Patch(
			ctx,
			name,
			types.StrategicMergePatchType,
			patchBytes,
			metav1.PatchOptions{},
		)
	case "DaemonSet":
		if err := a.requireResourcePermission(ctx, deps, resourcePermissionCheck{
			Group:     group,
			Version:   version,
			Kind:      workloadKind,
			Namespace: namespace,
			Name:      name,
			Verb:      "patch",
		}); err != nil {
			return err
		}
		_, err = deps.KubernetesClient.AppsV1().DaemonSets(namespace).Patch(
			ctx,
			name,
			types.StrategicMergePatchType,
			patchBytes,
			metav1.PatchOptions{},
		)
	default:
		return fmt.Errorf("restart not supported for workload kind %q", workloadKind)
	}

	if err != nil {
		return fmt.Errorf("failed to restart %s/%s (%s): %w", namespace, name, workloadKind, err)
	}

	if deps.Logger != nil {
		deps.Logger.Info(fmt.Sprintf("Restarted %s %s/%s", workloadKind, namespace, name), "restartWorkload")
	}
	a.invalidateResponseCache(selectionKey, workloadKind, namespace, name)
	return nil
}

// scaleWorkload updates the replica count on a scalable workload.
// Supported workload kinds: Deployment, StatefulSet, ReplicaSet.
func (a *App) scaleWorkload(clusterID, namespace, group, version, workloadKind, name string, replicas int) error {
	if err := requireNamespacedObject(namespace, name); err != nil {
		return err
	}
	if replicas < 0 {
		return fmt.Errorf("replicas must be non-negative")
	}
	if replicas > maxScaleReplicas {
		return fmt.Errorf("replicas must be less than or equal to %d", maxScaleReplicas)
	}
	_, err := a.RunObjectAction(ObjectActionRequest{
		Action: ObjectActionScale,
		Target: objectActionTarget(
			clusterID,
			group,
			version,
			workloadKind,
			namespace,
			name,
		),
		Replicas: &replicas,
	})
	return err
}

func (a *App) scaleWorkloadAction(target ObjectActionTargetRef, replicas int) error {
	return a.scaleWorkloadInternal(target.ClusterID, target.Namespace, target.Group, target.Version, target.Kind, target.Name, replicas)
}

func (a *App) scaleWorkloadInternal(clusterID, namespace, group, version, workloadKind, name string, replicas int) error {
	if err := requireNamespacedObject(namespace, name); err != nil {
		return err
	}
	if replicas < 0 {
		return fmt.Errorf("replicas must be non-negative")
	}
	if replicas > maxScaleReplicas {
		return fmt.Errorf("replicas must be less than or equal to %d", maxScaleReplicas)
	}
	workloadKind, err := validateAppsV1WorkloadAction("scaling", group, version, workloadKind, actionScalableWorkloadKinds)
	if err != nil {
		return err
	}

	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return err
	}
	if deps.KubernetesClient == nil {
		return fmt.Errorf("kubernetes client is not initialized")
	}

	scale := &autoscalingv1.Scale{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: namespace,
		},
		Spec: autoscalingv1.ScaleSpec{Replicas: int32(replicas)},
	}

	ctx := deps.Context
	if ctx == nil {
		ctx = context.Background()
	}

	switch workloadKind {
	case "Deployment":
		if err := a.requireResourcePermission(ctx, deps, resourcePermissionCheck{
			Group:       group,
			Version:     version,
			Kind:        workloadKind,
			Namespace:   namespace,
			Name:        name,
			Verb:        "update",
			Subresource: "scale",
		}); err != nil {
			return err
		}
		_, err := deps.KubernetesClient.AppsV1().Deployments(namespace).UpdateScale(
			ctx,
			name,
			scale,
			metav1.UpdateOptions{},
		)
		if err != nil {
			return fmt.Errorf("failed to scale deployment %s/%s: %w", namespace, name, err)
		}
	case "StatefulSet":
		if err := a.requireResourcePermission(ctx, deps, resourcePermissionCheck{
			Group:       group,
			Version:     version,
			Kind:        workloadKind,
			Namespace:   namespace,
			Name:        name,
			Verb:        "update",
			Subresource: "scale",
		}); err != nil {
			return err
		}
		_, err := deps.KubernetesClient.AppsV1().StatefulSets(namespace).UpdateScale(
			ctx,
			name,
			scale,
			metav1.UpdateOptions{},
		)
		if err != nil {
			return fmt.Errorf("failed to scale statefulset %s/%s: %w", namespace, name, err)
		}
	case "ReplicaSet":
		if err := a.requireResourcePermission(ctx, deps, resourcePermissionCheck{
			Group:       group,
			Version:     version,
			Kind:        workloadKind,
			Namespace:   namespace,
			Name:        name,
			Verb:        "update",
			Subresource: "scale",
		}); err != nil {
			return err
		}
		_, err := deps.KubernetesClient.AppsV1().ReplicaSets(namespace).UpdateScale(
			ctx,
			name,
			scale,
			metav1.UpdateOptions{},
		)
		if err != nil {
			return fmt.Errorf("failed to scale replicaset %s/%s: %w", namespace, name, err)
		}
	default:
		return fmt.Errorf("scaling not supported for workload kind %q", workloadKind)
	}

	if deps.Logger != nil {
		deps.Logger.Info(
			fmt.Sprintf("Scaled %s %s/%s to %d replicas", workloadKind, namespace, name, replicas),
			"scaleWorkload",
		)
	}
	a.invalidateResponseCache(selectionKey, workloadKind, namespace, name)
	return nil
}

// triggerCronJob creates a Job immediately from a CronJob's jobTemplate spec.
// Returns the name of the created Job on success.
func (a *App) triggerCronJob(clusterID, namespace, name string) (string, error) {
	if err := requireNamespacedObject(namespace, name); err != nil {
		return "", err
	}
	resp, err := a.RunObjectAction(ObjectActionRequest{
		Action: ObjectActionTrigger,
		Target: objectActionTarget(
			clusterID,
			"batch",
			"v1",
			"CronJob",
			namespace,
			name,
		),
	})
	return resp.Name, err
}

func (a *App) triggerCronJobAction(target ObjectActionTargetRef) (string, error) {
	if target.Group != "batch" || target.Version != "v1" || target.Kind != "CronJob" {
		return "", errUnsupportedActionTarget(ObjectActionTrigger, target, "batch/v1", "CronJob")
	}
	return a.triggerCronJobInternal(target.ClusterID, target.Namespace, target.Name)
}

func (a *App) triggerCronJobInternal(clusterID, namespace, name string) (string, error) {
	if err := requireNamespacedObject(namespace, name); err != nil {
		return "", err
	}
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return "", err
	}
	if deps.KubernetesClient == nil {
		return "", fmt.Errorf("kubernetes client is not initialized")
	}

	ctx := deps.Context
	if ctx == nil {
		ctx = context.Background()
	}

	// Fetch the CronJob to get its jobTemplate
	cronJob, err := deps.KubernetesClient.BatchV1().CronJobs(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return "", fmt.Errorf("failed to get cronjob %s/%s: %w", namespace, name, err)
	}
	if err := a.requireResourcePermission(ctx, deps, resourcePermissionCheck{
		Kind:      "Job",
		Namespace: namespace,
		Verb:      "create",
	}); err != nil {
		return "", err
	}

	// Generate a unique job name with timestamp
	timestamp := time.Now().UTC().Format("20060102150405")
	jobName := fmt.Sprintf("%s-manual-%s", name, timestamp)

	// Create the Job from the CronJob's jobTemplate
	job := &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{
			Name:      jobName,
			Namespace: namespace,
			Labels:    cronJob.Spec.JobTemplate.Labels,
			Annotations: map[string]string{
				"cronjob.kubernetes.io/instantiate": "manual",
			},
			OwnerReferences: []metav1.OwnerReference{
				{
					APIVersion: "batch/v1",
					Kind:       "CronJob",
					Name:       cronJob.Name,
					UID:        cronJob.UID,
					Controller: boolPtr(true),
				},
			},
		},
		Spec: cronJob.Spec.JobTemplate.Spec,
	}

	// Copy annotations from jobTemplate if present
	if cronJob.Spec.JobTemplate.Annotations != nil {
		if job.ObjectMeta.Annotations == nil {
			job.ObjectMeta.Annotations = make(map[string]string)
		}
		for k, v := range cronJob.Spec.JobTemplate.Annotations {
			job.ObjectMeta.Annotations[k] = v
		}
	}

	createdJob, err := deps.KubernetesClient.BatchV1().Jobs(namespace).Create(ctx, job, metav1.CreateOptions{})
	if err != nil {
		return "", fmt.Errorf("failed to create job from cronjob %s/%s: %w", namespace, name, err)
	}

	if deps.Logger != nil {
		deps.Logger.Info(fmt.Sprintf("Triggered CronJob %s/%s, created Job %s", namespace, name, createdJob.Name), "triggerCronJob")
	}
	a.invalidateResponseCache(selectionKey, "CronJob", namespace, name)
	return createdJob.Name, nil
}

// suspendCronJob sets the suspend field on a CronJob.
// When suspended, the CronJob will not create new Jobs on schedule.
func (a *App) suspendCronJob(clusterID, namespace, name string, suspend bool) error {
	if err := requireNamespacedObject(namespace, name); err != nil {
		return err
	}
	_, err := a.RunObjectAction(ObjectActionRequest{
		Action: ObjectActionSuspend,
		Target: objectActionTarget(
			clusterID,
			"batch",
			"v1",
			"CronJob",
			namespace,
			name,
		),
		Suspend: &suspend,
	})
	return err
}

func (a *App) suspendCronJobAction(target ObjectActionTargetRef, suspend bool) error {
	if target.Group != "batch" || target.Version != "v1" || target.Kind != "CronJob" {
		return errUnsupportedActionTarget(ObjectActionSuspend, target, "batch/v1", "CronJob")
	}
	return a.suspendCronJobInternal(target.ClusterID, target.Namespace, target.Name, suspend)
}

func (a *App) suspendCronJobInternal(clusterID, namespace, name string, suspend bool) error {
	if err := requireNamespacedObject(namespace, name); err != nil {
		return err
	}
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return err
	}
	if deps.KubernetesClient == nil {
		return fmt.Errorf("kubernetes client is not initialized")
	}

	if err := a.requireResourcePermission(deps.Context, deps, resourcePermissionCheck{
		Kind:      "CronJob",
		Namespace: namespace,
		Name:      name,
		Verb:      "patch",
	}); err != nil {
		return err
	}

	ctx := deps.Context
	if ctx == nil {
		ctx = context.Background()
	}

	patch := map[string]any{
		"spec": map[string]any{
			"suspend": suspend,
		},
	}

	patchBytes, err := json.Marshal(patch)
	if err != nil {
		return fmt.Errorf("failed to marshal suspend patch: %w", err)
	}

	_, err = deps.KubernetesClient.BatchV1().CronJobs(namespace).Patch(
		ctx,
		name,
		types.StrategicMergePatchType,
		patchBytes,
		metav1.PatchOptions{},
	)
	if err != nil {
		return fmt.Errorf("failed to update cronjob %s/%s suspend state: %w", namespace, name, err)
	}

	action := "Suspended"
	if !suspend {
		action = "Resumed"
	}
	if deps.Logger != nil {
		deps.Logger.Info(fmt.Sprintf("%s CronJob %s/%s", action, namespace, name), "suspendCronJob")
	}
	a.invalidateResponseCache(selectionKey, "CronJob", namespace, name)
	return nil
}

// boolPtr returns a pointer to a bool value.
func boolPtr(b bool) *bool {
	return &b
}

// Helper to obtain context even when Startup not yet run.
func (a *App) CtxOrBackground() context.Context {
	if a.Ctx != nil {
		return a.Ctx
	}
	return context.Background()
}
