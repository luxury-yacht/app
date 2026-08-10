package backend

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/resources/generic"
	"github.com/luxury-yacht/app/backend/resources/namespaces"
)

const (
	objectFinalizerPathMetadata = "metadata.finalizers"
	objectFinalizerPathSpec     = "spec.finalizers"
)

func isNamespaceFinalizerTarget(target ObjectActionTargetRef) bool {
	return target.Group == "" && target.Version == "v1" && target.Kind == "Namespace"
}

func (a *App) removeObjectFinalizerAction(target ObjectActionTargetRef, finalizer, path string) error {
	deps, selectionKey, err := a.resolveClusterDependencies(target.ClusterID)
	if err != nil {
		return err
	}
	ctx := a.CtxOrBackground()
	permission := resourcePermissionCheck{
		Group: target.Group, Version: target.Version, Kind: target.Kind,
		Namespace: target.Namespace, Name: target.Name,
	}

	switch path {
	case objectFinalizerPathMetadata:
		permission.Verb = "patch"
		if err := a.requireResourcePermission(ctx, deps, permission); err != nil {
			return err
		}
		if err := generic.NewService(deps).RemoveMetadataFinalizerByGVK(
			ctx, objectActionTargetGVK(target), target.Namespace, target.Name, finalizer,
		); err != nil {
			return err
		}
	case objectFinalizerPathSpec:
		if !isNamespaceFinalizerTarget(target) {
			return errUnsupportedActionTarget(ObjectActionRemoveFinalizer, target, "v1", "Namespace")
		}
		permission.Verb = "update"
		permission.Subresource = "finalize"
		if err := a.requireResourcePermission(ctx, deps, permission); err != nil {
			return err
		}
		if err := namespaces.NewService(deps).RemoveSpecFinalizer(ctx, target.Name, finalizer); err != nil {
			return err
		}
	default:
		return fmt.Errorf("unsupported finalizer path %q", path)
	}

	a.invalidateResponseCacheForGVK(selectionKey, objectActionTargetGVK(target), target.Namespace, target.Name)
	return nil
}
