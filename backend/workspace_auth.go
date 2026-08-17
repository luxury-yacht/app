package backend

import (
	"context"
	"fmt"
)

func (a *WorkspaceCoordinator) dispatchClusterAuthMutation(intent ClusterRuntimeIntent, command clusterAuthStateCommand) {
	if command.mutation == clusterAuthMutationNone {
		return
	}
	reason := fmt.Sprintf("cluster-auth-%s:%s", command.mutation, command.clusterID)
	a.runSelectionMutationAsync(reason, func(_ *selectionMutation) error {
		if !a.clusterRuntimeIntentIsCurrent(intent) {
			return nil
		}
		return a.clusterRuntime.runClusterOperation(context.Background(), command.clusterID, func(opCtx context.Context) error {
			return a.executeClusterAuthMutation(opCtx, command)
		})
	})
}

func (a *WorkspaceCoordinator) executeClusterAuthMutation(ctx context.Context, command clusterAuthStateCommand) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	switch command.mutation {
	case clusterAuthMutationRebuild:
		a.refresh.rebuildClusterSubsystem(command.clusterID)
	case clusterAuthMutationTeardown:
		a.refresh.teardownClusterSubsystem(command.clusterID)
	default:
		return fmt.Errorf("unsupported cluster auth mutation %q", command.mutation)
	}
	return ctx.Err()
}
