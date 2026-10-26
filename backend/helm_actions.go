/*
 * backend/helm_actions.go
 *
 * Helm release object actions.
 */

package backend

import (
	"time"

	configmappkg "github.com/luxury-yacht/app/backend/resources/configmap"
	secretpkg "github.com/luxury-yacht/app/backend/resources/secret"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/helm"
)

func (g *ResourceGateway) deleteHelmReleaseAction(target ObjectActionTargetRef) error {
	if !resourcemodel.IsHelmReleaseGVK(objectActionTargetGVK(target)) {
		return errUnsupportedActionTarget(ObjectActionDelete, target, resourcemodel.HelmReleaseGVK.GroupVersion().String(), resourcemodel.HelmReleaseGVK.Kind)
	}
	if err := requireNamespacedObject(target.Namespace, target.Name); err != nil {
		return err
	}
	deps, selectionKey, err := g.resolveClusterDependencies(target.ClusterID)
	if err != nil {
		return err
	}
	ctx := g.CtxOrBackground()
	if err := requireAnyResourcePermission(ctx, deps,
		resourcePermissionCheck{
			Version:   "v1",
			Kind:      secretpkg.Identity.Kind,
			Namespace: target.Namespace,
			Verb:      "delete",
		},
		resourcePermissionCheck{
			Version:   "v1",
			Kind:      configmappkg.Identity.Kind,
			Namespace: target.Namespace,
			Verb:      "delete",
		},
	); err != nil {
		return err
	}
	if err := helm.NewService(helm.Dependencies{Common: deps}).DeleteRelease(target.Namespace, target.Name); err != nil {
		return err
	}
	g.invalidateHelmCache(selectionKey, target.Namespace, target.Name)
	return nil
}

// rollbackHelmReleaseAction rolls a release back to a stored revision. Helm
// records the rollback as a new revision and supersedes the current one in its
// storage, so it needs create and update there.
func (g *ResourceGateway) rollbackHelmReleaseAction(target ObjectActionTargetRef, revision int64) error {
	if err := requireNamespacedObject(target.Namespace, target.Name); err != nil {
		return err
	}
	deps, selectionKey, err := g.resolveClusterDependencies(target.ClusterID)
	if err != nil {
		return err
	}
	ctx := g.CtxOrBackground()
	for _, verb := range []string{"create", "update"} {
		if err := requireResourcePermission(ctx, deps, resourcePermissionCheck{
			Group:     helm.StorageGVK.Group,
			Version:   helm.StorageGVK.Version,
			Kind:      helm.StorageGVK.Kind,
			Namespace: target.Namespace,
			Verb:      verb,
		}); err != nil {
			return err
		}
	}
	if err := helm.NewService(helm.Dependencies{Common: deps}).RollbackRelease(target.Namespace, target.Name, int(revision)); err != nil {
		return err
	}
	g.invalidateHelmCache(selectionKey, target.Namespace, target.Name)
	return nil
}

// helmRevisionHistory lists a release's stored revisions, each with the
// rendered manifest a rollback to it reinstates.
func (g *ResourceGateway) helmRevisionHistory(target resourcemodel.ResourceRef) ([]RevisionEntry, error) {
	if err := requireNamespacedObject(target.Namespace, target.Name); err != nil {
		return nil, err
	}
	deps, _, err := g.resolveClusterDependencies(target.ClusterID)
	if err != nil {
		return nil, err
	}
	revisions, err := helm.NewService(helm.Dependencies{Common: deps}).ReleaseHistory(target.Namespace, target.Name)
	if err != nil {
		return nil, err
	}
	entries := make([]RevisionEntry, 0, len(revisions))
	for _, revision := range revisions {
		entries = append(entries, RevisionEntry{
			Revision:    int64(revision.Revision),
			CreatedAt:   revision.Deployed.UTC().Format(time.RFC3339),
			ChangeCause: revision.Description,
			Current:     revision.Current,
			Content:     revision.Manifest,
		})
	}
	return entries, nil
}
