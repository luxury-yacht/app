/*
 * backend/cluster_auth.go
 *
 * Per-cluster authentication state management.
 * Handles auth failures and recovery independently for each cluster,
 * so auth issues in one cluster don't affect other clusters.
 */

package backend

import (
	"context"
	"fmt"

	"github.com/luxury-yacht/app/backend/internal/authstate"
	"github.com/luxury-yacht/app/backend/internal/errorcapture"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/refresh/system"
)

type clusterAuthMutation string

const (
	clusterAuthMutationNone     clusterAuthMutation = ""
	clusterAuthMutationRebuild  clusterAuthMutation = "rebuild"
	clusterAuthMutationTeardown clusterAuthMutation = "teardown"
)

type clusterAuthStateCommand struct {
	clusterID    string
	clusterName  string
	state        authstate.State
	diagnostic   authstate.FailureDiagnostic
	eventName    string
	eventPayload ClusterAuthEvent
	mutation     clusterAuthMutation
}

func newClusterAuthStateCommand(
	clusterID string,
	clusterName string,
	state authstate.State,
	diag authstate.FailureDiagnostic,
) (clusterAuthStateCommand, bool) {
	command := clusterAuthStateCommand{
		clusterID:   clusterID,
		clusterName: clusterName,
		state:       state,
		diagnostic:  diag,
	}
	switch state {
	case authstate.StateValid:
		command.eventName = clusterAuthRecoveredEventName
		command.eventPayload = authEventPayload(clusterID, clusterName, diag)
		command.mutation = clusterAuthMutationRebuild
	case authstate.StateRecovering:
		command.eventName = clusterAuthRecoveringEventName
		command.eventPayload = authEventPayload(clusterID, clusterName, diag)
		command.mutation = clusterAuthMutationTeardown
	case authstate.StateInvalid:
		command.eventName = clusterAuthFailedEventName
		command.eventPayload = authEventPayload(clusterID, clusterName, diag)
		command.mutation = clusterAuthMutationNone
	default:
		return clusterAuthStateCommand{}, false
	}
	return command, true
}

// authEventPayload builds an auth event payload carrying the per-cluster identity
// plus the typed credential diagnostic. Every diagnostic field is always present
// (empty string when unknown) so the frontend can rely on the payload shape.
func authEventPayload(clusterID, clusterName string, diag authstate.FailureDiagnostic) ClusterAuthEvent {
	return ClusterAuthEvent{
		ClusterID:   clusterID,
		ClusterName: clusterName,
		Reason:      diag.Reason,
		Class:       diag.Class,
		Kind:        diag.Kind,
		Summary:     diag.Summary,
		ExecCommand: diag.ExecCommand,
	}
}

func (r clusterSubsystemRebuild) run() {
	newClients, ok := r.rebuildClients()
	if !ok {
		return
	}
	subsystem, ok := r.buildSubsystem(newClients)
	if !ok {
		return
	}
	if !r.activateSubsystem(newClients, subsystem) {
		return
	}
	r.refresh.logger.Info(fmt.Sprintf("Successfully rebuilt subsystem for cluster %s", r.clusterID), logsources.Auth, r.clusterID, r.clusterName)
}

func (r clusterSubsystemRebuild) activateSubsystem(newClients *clusterClients, subsystem *system.Subsystem) bool {
	if !r.startManager(subsystem) {
		// A subsystem that cannot start has not been published, but all resources
		// constructed for that generation still need an owner to stop them.
		r.refresh.stopRefreshSubsystem(subsystem)
		return false
	}

	previous := r.refresh.getRefreshSubsystem(r.clusterID)
	r.refresh.setRefreshSubsystem(r.clusterID, subsystem)
	subsystems, clusterOrder := refreshSubsystemTopology(r.refresh.snapshotRefreshSubsystems())
	if !r.updateRefreshRouting(subsystems, clusterOrder) {
		if previous == nil {
			r.refresh.takeRefreshSubsystem(r.clusterID)
		} else {
			r.refresh.setRefreshSubsystem(r.clusterID, previous)
		}
		if previous != subsystem {
			r.refresh.stopRefreshSubsystem(subsystem)
		}
		return false
	}

	// Commit the clients only after the matching subsystem is started and every
	// aggregate consumer routes to it. Until this point the previous generation
	// remains available if activation fails.
	r.refresh.clusterRuntime.replaceClusterClient(r.clusterID, newClients)
	if previous != nil && previous != subsystem {
		r.refresh.stopRefreshSubsystem(previous)
	}
	r.startObjectCatalog(newClients)
	return true
}

type clusterSubsystemRebuild struct {
	refresh     *RefreshCoordinator
	clusterID   string
	clusterName string
	selection   kubeconfigSelection
	oldClients  *clusterClients
}

func (r clusterSubsystemRebuild) rebuildClients() (*clusterClients, bool) {
	clients, err := r.refresh.clusterRuntime.buildClusterClientsWithManager(
		context.Background(), r.selection, r.oldClients.meta, r.oldClients.authManager,
	)
	if err != nil {
		r.reportBuildError("clients", "client rebuild failed", err)
		return nil, false
	}
	if clusterClientsAuthInvalid(clients) {
		r.refresh.logger.Warn(fmt.Sprintf("Skipping subsystem rebuild for cluster %s: auth not valid after client rebuild", r.clusterID), logsources.Auth, r.clusterID, r.clusterName)
		return nil, false
	}
	return clients, true
}

func clusterClientsAuthInvalid(clients *clusterClients) bool {
	return clients.authFailedOnInit || (clients.authManager != nil && !clients.authManager.IsValid())
}

func (r clusterSubsystemRebuild) buildSubsystem(clients *clusterClients) (*system.Subsystem, bool) {
	subsystem, err := r.refresh.buildRefreshSubsystemForSelection(r.selection, clients, clients.meta)
	if err != nil {
		r.reportBuildError("subsystem", "subsystem rebuild failed", err)
		return nil, false
	}
	return subsystem, true
}

func (r clusterSubsystemRebuild) reportBuildError(component, capturePrefix string, err error) {
	r.refresh.logger.ErrorWithCause(
		err, fmt.Sprintf("Failed to rebuild %s for cluster %s", component, r.clusterID),
		logsources.Auth, r.clusterID, r.clusterName,
	)
	errorcapture.CaptureWithCluster(r.clusterID, fmt.Sprintf("%s: %v", capturePrefix, err))
}

func (r clusterSubsystemRebuild) startManager(subsystem *system.Subsystem) bool {
	if r.refresh == nil || subsystem == nil || subsystem.Manager == nil {
		return false
	}
	refreshCtx := r.refresh.ensureRefreshRuntimeContext()
	if refreshCtx == nil {
		return false
	}
	go r.runManager(refreshCtx, subsystem)
	return true
}

func (r clusterSubsystemRebuild) runManager(ctx context.Context, subsystem *system.Subsystem) {
	if err := subsystem.Manager.Start(ctx); err != nil {
		r.refresh.logger.Warn(fmt.Sprintf("Refresh manager for cluster %s stopped: %v", r.clusterID, err), logsources.Auth, r.clusterID, r.clusterName)
		return
	}
	if subsystem.Registry != nil {
		subsystem.Registry.ReconcileMaintainedStores()
	}
}

func refreshSubsystemTopology(subsystems map[string]*system.Subsystem) (map[string]*system.Subsystem, []string) {
	clusterOrder := make([]string, 0, len(subsystems))
	for clusterID := range subsystems {
		clusterOrder = append(clusterOrder, clusterID)
	}
	return subsystems, clusterOrder
}

func (r clusterSubsystemRebuild) updateRefreshRouting(subsystems map[string]*system.Subsystem, clusterOrder []string) bool {
	if r.refresh.refreshService.Load() == nil || r.refresh.refreshAggregates.Load() == nil {
		return r.bootstrapRefreshRouting(subsystems, clusterOrder)
	}
	if err := r.refresh.refreshAggregates.Load().Update(clusterOrder, subsystems); err != nil {
		r.refresh.logger.ErrorWithCause(err, fmt.Sprintf("Failed to update aggregates for cluster %s", r.clusterID), logsources.Auth, r.clusterID, r.clusterName)
		return false
	}
	return true
}

func (r clusterSubsystemRebuild) bootstrapRefreshRouting(subsystems map[string]*system.Subsystem, clusterOrder []string) bool {
	mux, aggregates, err := r.refresh.buildRefreshMux(subsystems, clusterOrder)
	if err != nil {
		r.refresh.logger.ErrorWithCause(err, fmt.Sprintf("Failed to build refresh mux after cluster %s recovery", r.clusterID), logsources.Auth, r.clusterID, r.clusterName)
		return false
	}
	r.refresh.refreshAggregates.Store(aggregates)
	r.refresh.sweepNamespacesReadiness(subsystems)
	r.refresh.publishRefreshService(mux, subsystems)
	r.refresh.logger.Info(fmt.Sprintf("Published refresh service after cluster %s recovery", r.clusterID), logsources.Auth, r.clusterID, r.clusterName)
	return true
}

func (r clusterSubsystemRebuild) startObjectCatalog(clients *clusterClients) {
	target := catalogTarget{selection: r.selection, meta: clients.meta}
	if err := r.refresh.startObjectCatalogForTarget(target); err != nil {
		r.refresh.logger.Warn(fmt.Sprintf("Object catalog skipped for %s: %v", r.clusterID, err), logsources.Auth, r.clusterID, r.clusterName)
	}
}
