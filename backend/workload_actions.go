package backend

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/kind/kindspec"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/cronjob"
	"github.com/luxury-yacht/app/backend/resources/job"
)

const rolloutAnnotation = "kubectl.kubernetes.io/restartedAt"
const maxScaleReplicas = 1<<31 - 1

// workloadOperationsByKind indexes each workload kind's mutating operations from the
// single registry, so the action handlers dispatch by kind instead of switching on it.
var workloadOperationsByKind = func() map[string]*kindspec.WorkloadOperations {
	m := map[string]*kindspec.WorkloadOperations{}
	for _, d := range kindregistry.All {
		if d.Workload != nil {
			m[d.Identity.Kind] = d.Workload
		}
	}
	return m
}()

var (
	actionRestartableWorkloadKinds = workloadKindsSupporting(func(w *kindspec.WorkloadOperations) bool { return w.Restart != nil })
	actionScalableWorkloadKinds    = workloadKindsSupporting(func(w *kindspec.WorkloadOperations) bool { return w.Scale != nil })
)

// workloadKindsSupporting returns the set of workload kinds whose operations satisfy
// pred, so the supported-kind validation lists no kind by hand.
func workloadKindsSupporting(pred func(*kindspec.WorkloadOperations) bool) map[string]struct{} {
	m := map[string]struct{}{}
	for kind, ops := range workloadOperationsByKind {
		if pred(ops) {
			m[kind] = struct{}{}
		}
	}
	return m
}

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

	ops := workloadOperationsByKind[workloadKind]
	if ops == nil || ops.Restart == nil {
		return fmt.Errorf("restart not supported for workload kind %q", workloadKind)
	}
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
	if err = ops.Restart(ctx, deps.KubernetesClient, namespace, name, patchBytes); err != nil {
		return fmt.Errorf("failed to restart %s/%s (%s): %w", namespace, name, workloadKind, err)
	}

	applog.Info(deps.Logger, fmt.Sprintf("Restarted %s %s/%s", workloadKind, namespace, name), "restartWorkload")
	a.invalidateResponseCache(selectionKey, workloadKind, namespace, name)
	return nil
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

	ctx := deps.Context
	if ctx == nil {
		ctx = context.Background()
	}

	if err := ensureHPAManagedScaleAllowed(ctx, deps, namespace, group, version, workloadKind, name, replicas); err != nil {
		return err
	}

	ops := workloadOperationsByKind[workloadKind]
	if ops == nil || ops.Scale == nil {
		return fmt.Errorf("scaling not supported for workload kind %q", workloadKind)
	}
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
	if err := ops.Scale(ctx, deps.KubernetesClient, namespace, name, int32(replicas)); err != nil {
		return fmt.Errorf("failed to scale %s %s/%s: %w", strings.ToLower(workloadKind), namespace, name, err)
	}

	applog.Info(
		deps.Logger,
		fmt.Sprintf("Scaled %s %s/%s to %d replicas", workloadKind, namespace, name, replicas),
		"scaleWorkload",
	)
	a.invalidateResponseCache(selectionKey, workloadKind, namespace, name)
	return nil
}

func ensureHPAManagedScaleAllowed(ctx context.Context, deps common.Dependencies, namespace, group, version, workloadKind, name string, replicas int) error {
	managed, err := isWorkloadHPAManaged(ctx, deps, namespace, group, version, workloadKind, name)
	if err != nil {
		return fmt.Errorf("failed to determine HPA ownership for %s %s/%s: %w", workloadKind, namespace, name, err)
	}
	if !managed {
		return nil
	}
	if replicas == 0 {
		return nil
	}
	if replicas == 1 {
		current, err := currentWorkloadDesiredReplicas(ctx, deps, namespace, workloadKind, name)
		if err != nil {
			return fmt.Errorf("failed to read current scale for HPA-managed %s %s/%s: %w", workloadKind, namespace, name, err)
		}
		if current == 0 {
			return nil
		}
	}
	return fmt.Errorf("manual scale is disabled for HPA-managed %s %s/%s", workloadKind, namespace, name)
}

func currentWorkloadDesiredReplicas(ctx context.Context, deps common.Dependencies, namespace, workloadKind, name string) (int32, error) {
	if deps.KubernetesClient == nil {
		return 0, fmt.Errorf("kubernetes client is not initialized")
	}
	ops := workloadOperationsByKind[workloadKind]
	if ops == nil || ops.CurrentReplicas == nil {
		return 0, fmt.Errorf("scaling not supported for workload kind %q", workloadKind)
	}
	return ops.CurrentReplicas(ctx, deps.KubernetesClient, namespace, name)
}

func (a *App) triggerCronJobAction(target ObjectActionTargetRef) (string, error) {
	if target.Group != cronjob.Identity.Group || target.Version != cronjob.Identity.Version || target.Kind != cronjob.Identity.Kind {
		return "", errUnsupportedActionTarget(ObjectActionTrigger, target, cronjob.Identity.Group+"/"+cronjob.Identity.Version, cronjob.Identity.Kind)
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

	// Permission to create the Job is checked here; the CronJob fetch, suspended
	// guard, and Job creation live in the cronjob package.
	if err := a.requireResourcePermission(ctx, deps, resourcePermissionCheck{
		Group:     job.Identity.Group,
		Version:   job.Identity.Version,
		Kind:      job.Identity.Kind,
		Namespace: namespace,
		Verb:      "create",
	}); err != nil {
		return "", err
	}

	jobName, err := cronjob.TriggerManualJob(ctx, deps.KubernetesClient, namespace, name)
	if err != nil {
		return "", err
	}

	applog.Info(deps.Logger, fmt.Sprintf("Triggered CronJob %s/%s, created Job %s", namespace, name, jobName), "triggerCronJob")
	a.invalidateResponseCache(selectionKey, cronjob.Identity.Kind, namespace, name)
	return jobName, nil
}

func (a *App) suspendCronJobAction(target ObjectActionTargetRef, suspend bool) error {
	if target.Group != cronjob.Identity.Group || target.Version != cronjob.Identity.Version || target.Kind != cronjob.Identity.Kind {
		return errUnsupportedActionTarget(ObjectActionSuspend, target, cronjob.Identity.Group+"/"+cronjob.Identity.Version, cronjob.Identity.Kind)
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
		Group:     cronjob.Identity.Group,
		Version:   cronjob.Identity.Version,
		Kind:      cronjob.Identity.Kind,
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

	if err := cronjob.SetSuspend(ctx, deps.KubernetesClient, namespace, name, suspend); err != nil {
		return err
	}

	action := "Suspended"
	if !suspend {
		action = "Resumed"
	}
	applog.Info(deps.Logger, fmt.Sprintf("%s CronJob %s/%s", action, namespace, name), "suspendCronJob")
	a.invalidateResponseCache(selectionKey, cronjob.Identity.Kind, namespace, name)
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
