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

func (g *ResourceGateway) restartWorkloadAction(target ObjectActionTargetRef) error {
	if err := requireNamespacedObject(target.Namespace, target.Name); err != nil {
		return err
	}
	workloadKind, err := validateAppsV1WorkloadAction("restart", target.Group, target.Version, target.Kind, actionRestartableWorkloadKinds)
	if err != nil {
		return err
	}

	deps, selectionKey, err := g.resolveClusterDependencies(target.ClusterID)
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

	ctx := g.CtxOrBackground()

	ops := workloadOperationsByKind[workloadKind]
	if ops == nil || ops.Restart == nil {
		return fmt.Errorf("restart not supported for workload kind %q", workloadKind)
	}
	if err := requireResourcePermission(ctx, deps, resourcePermissionCheck{
		Group:     target.Group,
		Version:   target.Version,
		Kind:      workloadKind,
		Namespace: target.Namespace,
		Name:      target.Name,
		Verb:      "patch",
	}); err != nil {
		return err
	}
	if err = ops.Restart(ctx, deps.KubernetesClient, target.Namespace, target.Name, patchBytes); err != nil {
		return fmt.Errorf("failed to restart %s/%s (%s): %w", target.Namespace, target.Name, workloadKind, err)
	}

	applog.Info(deps.Logger, fmt.Sprintf("Restarted %s %s/%s", workloadKind, target.Namespace, target.Name), "restartWorkload")
	g.invalidateResponseCache(selectionKey, workloadKind, target.Namespace, target.Name)
	return nil
}

func (g *ResourceGateway) scaleWorkloadAction(target ObjectActionTargetRef, replicas int) error {
	if err := requireNamespacedObject(target.Namespace, target.Name); err != nil {
		return err
	}
	if replicas < 0 {
		return fmt.Errorf("replicas must be non-negative")
	}
	if replicas > maxScaleReplicas {
		return fmt.Errorf("replicas must be less than or equal to %d", maxScaleReplicas)
	}
	workloadKind, err := validateAppsV1WorkloadAction("scaling", target.Group, target.Version, target.Kind, actionScalableWorkloadKinds)
	if err != nil {
		return err
	}

	target.Kind = workloadKind

	deps, selectionKey, err := g.resolveClusterDependencies(target.ClusterID)
	if err != nil {
		return err
	}
	if deps.KubernetesClient == nil {
		return fmt.Errorf("kubernetes client is not initialized")
	}

	ctx := g.CtxOrBackground()

	if err := ensureHPAManagedScaleAllowed(ctx, deps, target, replicas); err != nil {
		return err
	}

	ops := workloadOperationsByKind[workloadKind]
	if ops == nil || ops.Scale == nil {
		return fmt.Errorf("scaling not supported for workload kind %q", workloadKind)
	}
	if err := requireResourcePermission(ctx, deps, resourcePermissionCheck{
		Group:       target.Group,
		Version:     target.Version,
		Kind:        workloadKind,
		Namespace:   target.Namespace,
		Name:        target.Name,
		Verb:        "update",
		Subresource: "scale",
	}); err != nil {
		return err
	}
	if err := ops.Scale(ctx, deps.KubernetesClient, target.Namespace, target.Name, int32(replicas)); err != nil {
		return fmt.Errorf("failed to scale %s %s/%s: %w", strings.ToLower(workloadKind), target.Namespace, target.Name, err)
	}

	applog.Info(
		deps.Logger,
		fmt.Sprintf("Scaled %s %s/%s to %d replicas", workloadKind, target.Namespace, target.Name, replicas),
		"scaleWorkload",
	)
	g.invalidateResponseCache(selectionKey, workloadKind, target.Namespace, target.Name)
	return nil
}

func ensureHPAManagedScaleAllowed(ctx context.Context, deps common.Dependencies, target ObjectActionTargetRef, replicas int) error {
	managed, err := isWorkloadHPAManaged(ctx, deps, target.Namespace, target.Group, target.Version, target.Kind, target.Name)
	if err != nil {
		return fmt.Errorf("failed to determine HPA ownership for %s %s/%s: %w", target.Kind, target.Namespace, target.Name, err)
	}
	if !managed {
		return nil
	}
	if replicas == 0 {
		return nil
	}
	if replicas == 1 {
		current, err := currentWorkloadDesiredReplicas(ctx, deps, target.Namespace, target.Kind, target.Name)
		if err != nil {
			return fmt.Errorf("failed to read current scale for HPA-managed %s %s/%s: %w", target.Kind, target.Namespace, target.Name, err)
		}
		if current == 0 {
			return nil
		}
	}
	return fmt.Errorf("manual scale is disabled for HPA-managed %s %s/%s", target.Kind, target.Namespace, target.Name)
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

func (g *ResourceGateway) triggerCronJobAction(target ObjectActionTargetRef) (string, error) {
	if target.Group != cronjob.Identity.Group || target.Version != cronjob.Identity.Version || target.Kind != cronjob.Identity.Kind {
		return "", errUnsupportedActionTarget(ObjectActionTrigger, target, cronjob.Identity.Group+"/"+cronjob.Identity.Version, cronjob.Identity.Kind)
	}
	if err := requireNamespacedObject(target.Namespace, target.Name); err != nil {
		return "", err
	}
	deps, selectionKey, err := g.resolveClusterDependencies(target.ClusterID)
	if err != nil {
		return "", err
	}
	if deps.KubernetesClient == nil {
		return "", fmt.Errorf("kubernetes client is not initialized")
	}

	ctx := g.CtxOrBackground()

	// Permission to create the Job is checked here; the CronJob fetch, suspended
	// guard, and Job creation live in the cronjob package.
	if err := requireResourcePermission(ctx, deps, resourcePermissionCheck{
		Group:     job.Identity.Group,
		Version:   job.Identity.Version,
		Kind:      job.Identity.Kind,
		Namespace: target.Namespace,
		Verb:      "create",
	}); err != nil {
		return "", err
	}

	jobName, err := cronjob.TriggerManualJob(ctx, deps.KubernetesClient, target.Namespace, target.Name)
	if err != nil {
		return "", err
	}

	applog.Info(deps.Logger, fmt.Sprintf("Triggered CronJob %s/%s, created Job %s", target.Namespace, target.Name, jobName), "triggerCronJob")
	g.invalidateResponseCache(selectionKey, cronjob.Identity.Kind, target.Namespace, target.Name)
	return jobName, nil
}

func (g *ResourceGateway) suspendCronJobAction(target ObjectActionTargetRef, suspend bool) error {
	if target.Group != cronjob.Identity.Group || target.Version != cronjob.Identity.Version || target.Kind != cronjob.Identity.Kind {
		return errUnsupportedActionTarget(ObjectActionSuspend, target, cronjob.Identity.Group+"/"+cronjob.Identity.Version, cronjob.Identity.Kind)
	}
	if err := requireNamespacedObject(target.Namespace, target.Name); err != nil {
		return err
	}
	deps, selectionKey, err := g.resolveClusterDependencies(target.ClusterID)
	if err != nil {
		return err
	}
	if deps.KubernetesClient == nil {
		return fmt.Errorf("kubernetes client is not initialized")
	}

	ctx := g.CtxOrBackground()
	if err := requireResourcePermission(ctx, deps, resourcePermissionCheck{
		Group:     cronjob.Identity.Group,
		Version:   cronjob.Identity.Version,
		Kind:      cronjob.Identity.Kind,
		Namespace: target.Namespace,
		Name:      target.Name,
		Verb:      "patch",
	}); err != nil {
		return err
	}

	if err := cronjob.SetSuspend(ctx, deps.KubernetesClient, target.Namespace, target.Name, suspend); err != nil {
		return err
	}

	action := "Suspended"
	if !suspend {
		action = "Resumed"
	}
	applog.Info(deps.Logger, fmt.Sprintf("%s CronJob %s/%s", action, target.Namespace, target.Name), "suspendCronJob")
	g.invalidateResponseCache(selectionKey, cronjob.Identity.Kind, target.Namespace, target.Name)
	return nil
}

// boolPtr returns a pointer to a bool value.
func boolPtr(b bool) *bool {
	return &b
}
