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
	"time"

	"github.com/luxury-yacht/app/backend/internal/authstate"
	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/errorcapture"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/refresh/system"
)

// handleClusterAuthStateChange handles auth state changes for a specific cluster.
// Unlike the global handleAuthStateChange, this only affects the specific cluster
// that experienced the auth failure, allowing other clusters to continue operating.
//
// NOTE: This is called from the auth manager with the mutex held, so heavy
// operations must be run asynchronously to avoid blocking other auth operations.
func (m *ClusterRuntimeManager) handleClusterAuthStateChange(clusterID string, state authstate.State, diag authstate.FailureDiagnostic) {
	if m == nil || clusterID == "" {
		return
	}

	command, ok := newClusterAuthStateCommand(clusterID, m.clusterAuthDisplayName(clusterID), state, diag)
	if !ok {
		return
	}

	m.reportClusterAuthState(command)
	m.emitEvent(command.eventName, command.eventPayload)
	m.applyClusterAuthLifecycle(command)
	if command.mutation != clusterAuthMutationNone {
		m.intents.Publish(ClusterRuntimeIntent{
			Kind:       ClusterRuntimeIntentAuthRebuild,
			ClusterID:  clusterID,
			Generation: m.intentGeneration.Add(1),
			AuthState:  state,
			Diagnostic: diag,
		})
	}
}

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

func (m *ClusterRuntimeManager) clusterAuthDisplayName(clusterID string) string {
	clients := m.clusterClientsForID(clusterID)
	if clients == nil {
		return clusterID
	}
	return clients.meta.Name
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

func (m *ClusterRuntimeManager) reportClusterAuthState(command clusterAuthStateCommand) {
	switch command.state {
	case authstate.StateValid:
		m.logger.Info(fmt.Sprintf("Cluster %s: auth recovered", command.clusterName), logsources.Auth, command.clusterID, command.clusterName)
	case authstate.StateRecovering:
		m.logger.Warn(fmt.Sprintf("Cluster %s: auth recovering - %s", command.clusterName, command.diagnostic.Reason), logsources.Auth, command.clusterID, command.clusterName)
	case authstate.StateInvalid:
		m.reportInvalidClusterAuthState(command)
	}
}

func (m *ClusterRuntimeManager) reportInvalidClusterAuthState(command clusterAuthStateCommand) {
	m.logger.Warn(fmt.Sprintf("Cluster %s: auth failed - %s", command.clusterName, command.diagnostic.Reason), logsources.Auth, command.clusterID, command.clusterName)
	errorcapture.CaptureWithCluster(command.clusterID, fmt.Sprintf("auth failed: %s", command.diagnostic.Reason))
}

func (m *ClusterRuntimeManager) applyClusterAuthLifecycle(command clusterAuthStateCommand) {
	if command.state != authstate.StateInvalid || m.clusterLifecycle == nil {
		return
	}
	m.clusterLifecycle.SetState(command.clusterID, ClusterStateAuthFailed)
}

func (a *WorkspaceCoordinator) dispatchClusterAuthMutation(intent ClusterRuntimeIntent, command clusterAuthStateCommand) {
	if command.mutation == clusterAuthMutationNone {
		return
	}
	reason := fmt.Sprintf("cluster-auth-%s:%s", command.mutation, command.clusterID)
	a.runSelectionMutationAsync(reason, func(_ *selectionMutation) error {
		if !a.clusterRuntimeIntentIsCurrent(intent) {
			return nil
		}
		return a.runClusterOperation(context.Background(), command.clusterID, func(opCtx context.Context) error {
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
		a.RefreshCoordinator.rebuildClusterSubsystem(command.clusterID)
	case clusterAuthMutationTeardown:
		a.RefreshCoordinator.teardownClusterSubsystem(command.clusterID)
	default:
		return fmt.Errorf("unsupported cluster auth mutation %q", command.mutation)
	}
	return ctx.Err()
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

// stopClusterFeeds stops everything that FEEDS a cluster's subsystem — permission
// revalidation, the resource stream, the refresh manager (which also stops the metrics
// poller and informer hub), and the informer factory — WITHOUT removing the subsystem from
// the registry and WITHOUT spilling. It is the shared stop logic for two callers:
//   - teardownClusterSubsystem, which then takes the subsystem + spills (full teardown), and
//   - coolClusterToMmapServing, which then swaps the maintained stores to mmap and keeps the
//     subsystem registered so it serves cooled queries.
//
// The subsystem must be the one currently registered for clusterID; the caller passes it so
// cool can act on the same subsystem it will keep serving.
func (a *RefreshCoordinator) stopClusterFeeds(clusterID string, subsystem *system.Subsystem) {
	if a == nil || clusterID == "" || subsystem == nil {
		return
	}
	subsystem.CancelColdPreparation()

	// Stop permission revalidation for this cluster.
	a.stopRefreshPermissionRevalidation(clusterID)

	// Silence the doorbell notifiers (namespaces, object-events) BEFORE the
	// stream manager stops: their debounce/rearm timers outlive the informers
	// and would keep broadcasting into the dead manager.
	subsystem.StopDoorbellNotifiers()

	// Stop active streams before shutting down their producers.
	if subsystem.ContainerLogs != nil {
		subsystem.ContainerLogs.Stop()
	}
	if subsystem.ResourceStream != nil {
		subsystem.ResourceStream.Stop()
	}

	if subsystem.Manager != nil {
		done := make(chan struct{})
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), config.RefreshShutdownTimeout)
			defer cancel()
			if err := subsystem.Manager.Shutdown(ctx); err != nil {
				a.appLogs.logger.Warn(fmt.Sprintf("Failed to shutdown refresh manager for cluster %s: %v", clusterID, err), logsources.Auth, clusterID, clusterID)
			}
			close(done)
		}()
		select {
		case <-done:
		case <-time.After(config.RefreshShutdownTimeout):
			a.appLogs.logger.Warn(fmt.Sprintf("Timed out waiting for refresh manager shutdown for cluster %s", clusterID), logsources.Auth, clusterID, clusterID)
		}
	}

	// Shutdown the informer factory if present.
	if subsystem.InformerFactory != nil {
		_ = subsystem.InformerFactory.Shutdown()
	}
}

// teardownClusterSubsystem stops the refresh subsystem for a specific cluster
// without affecting other clusters.
func (a *RefreshCoordinator) teardownClusterSubsystem(clusterID string) {
	if a == nil || clusterID == "" {
		return
	}

	// A cluster torn down while cooled (e.g. closed, or pressure-collapsed after cooling)
	// must release its mmap mappings FIRST, before its stores are discarded — otherwise the
	// closers would never run. takeCooledClosers returns each closer exactly once, so this
	// never double-unmaps a subsequent re-warm.
	a.closeCooledClosers(clusterID)

	// Get and remove the subsystem for this cluster.
	subsystem := a.takeRefreshSubsystem(clusterID)
	if subsystem == nil {
		// No live subsystem; still ensure permission revalidation is stopped (takeRefreshSubsystem
		// short-circuits stopClusterFeeds below, which is where reval stop lives).
		a.stopRefreshPermissionRevalidation(clusterID)
		return
	}

	a.appLogs.logger.Info(fmt.Sprintf("Tearing down subsystem for cluster %s", clusterID), logsources.Auth, clusterID, clusterID)

	// Stop all feeds (permission reval, resource stream, manager, informer factory).
	a.stopClusterFeeds(clusterID, subsystem)

	// Spill this cluster's stores to disk now that the subsystem is quiescent, so a re-warm
	// re-paints them fast before its informers re-sync (the heap they hold is reclaimed by the
	// governor's Cold action right after this returns). The maintained query stores give the
	// instant warm-paint; the ingest stores (+ their RV) let each reflector resume from a
	// delta instead of a full re-LIST.
	a.spillClusterStores(clusterID, subsystem.Registry)
	a.spillClusterIngestStores(clusterID, subsystem.IngestManager)
}

// rebuildClusterSubsystem rebuilds the cluster clients and refresh subsystem
// for a specific cluster after auth recovery. This rebuilds everything with
// fresh credentials from the kubeconfig to pick up refreshed SSO tokens.
func (a *RefreshCoordinator) rebuildClusterSubsystem(clusterID string) {
	if a == nil || clusterID == "" {
		return
	}
	a.appLogs.logger.Info(fmt.Sprintf("Rebuilding subsystem for cluster %s", clusterID), logsources.Auth, clusterID, clusterID)
	rebuild, ok := a.prepareClusterSubsystemRebuild(clusterID)
	if !ok {
		return
	}
	rebuild.run()
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
	r.refresh.appLogs.logger.Info(fmt.Sprintf("Successfully rebuilt subsystem for cluster %s", r.clusterID), logsources.Auth, r.clusterID, r.clusterName)
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
	r.refresh.clusterClientsMu.Lock()
	r.refresh.setClusterClientLocked(r.clusterID, newClients)
	r.refresh.clusterClientsMu.Unlock()
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

func (a *RefreshCoordinator) prepareClusterSubsystemRebuild(clusterID string) (clusterSubsystemRebuild, bool) {
	oldClients := a.clusterClientsForID(clusterID)
	if oldClients == nil {
		a.appLogs.logger.Warn(fmt.Sprintf("Cannot rebuild subsystem for cluster %s: clients not found", clusterID), logsources.Auth, clusterID, clusterID)
		return clusterSubsystemRebuild{}, false
	}
	selection := kubeconfigSelection{Path: oldClients.kubeconfigPath, Context: oldClients.kubeconfigContext}
	if selection.Path == "" {
		a.appLogs.logger.Warn(fmt.Sprintf("Cannot rebuild subsystem for cluster %s: selection not found", clusterID), logsources.Auth, clusterID, oldClients.meta.Name)
		return clusterSubsystemRebuild{}, false
	}
	return clusterSubsystemRebuild{
		refresh: a, clusterID: clusterID, clusterName: oldClients.meta.Name,
		selection: selection, oldClients: oldClients,
	}, true
}

func (r clusterSubsystemRebuild) rebuildClients() (*clusterClients, bool) {
	clients, err := r.refresh.buildClusterClientsWithManager(
		context.Background(), r.selection, r.oldClients.meta, r.oldClients.authManager,
	)
	if err != nil {
		r.reportBuildError("clients", "client rebuild failed", err)
		return nil, false
	}
	if clusterClientsAuthInvalid(clients) {
		r.refresh.appLogs.logger.Warn(fmt.Sprintf("Skipping subsystem rebuild for cluster %s: auth not valid after client rebuild", r.clusterID), logsources.Auth, r.clusterID, r.clusterName)
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
	r.refresh.appLogs.logger.ErrorWithCause(
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
		r.refresh.appLogs.logger.Warn(fmt.Sprintf("Refresh manager for cluster %s stopped: %v", r.clusterID, err), logsources.Auth, r.clusterID, r.clusterName)
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
		r.refresh.appLogs.logger.ErrorWithCause(err, fmt.Sprintf("Failed to update aggregates for cluster %s", r.clusterID), logsources.Auth, r.clusterID, r.clusterName)
		return false
	}
	return true
}

func (r clusterSubsystemRebuild) bootstrapRefreshRouting(subsystems map[string]*system.Subsystem, clusterOrder []string) bool {
	mux, aggregates, err := r.refresh.buildRefreshMux(subsystems, clusterOrder)
	if err != nil {
		r.refresh.appLogs.logger.ErrorWithCause(err, fmt.Sprintf("Failed to build refresh mux after cluster %s recovery", r.clusterID), logsources.Auth, r.clusterID, r.clusterName)
		return false
	}
	r.refresh.refreshAggregates.Store(aggregates)
	r.refresh.sweepNamespacesReadiness(subsystems)
	r.refresh.publishRefreshService(mux, subsystems)
	r.refresh.appLogs.logger.Info(fmt.Sprintf("Published refresh service after cluster %s recovery", r.clusterID), logsources.Auth, r.clusterID, r.clusterName)
	return true
}

func (r clusterSubsystemRebuild) startObjectCatalog(clients *clusterClients) {
	target := catalogTarget{selection: r.selection, meta: clients.meta}
	if err := r.refresh.startObjectCatalogForTarget(target); err != nil {
		r.refresh.appLogs.logger.Warn(fmt.Sprintf("Object catalog skipped for %s: %v", r.clusterID, err), logsources.Auth, r.clusterID, r.clusterName)
	}
}

// RetryClusterAuth triggers a manual authentication recovery attempt for a specific cluster.
// Called when user clicks "Retry" for a specific cluster after re-authenticating externally.
func (m *ClusterRuntimeManager) RetryClusterAuth(clusterID string) {
	if m == nil || clusterID == "" {
		return
	}

	clients := m.clusterClientsForID(clusterID)
	if clients == nil || clients.authManager == nil {
		return
	}

	clients.authManager.TriggerRetry()
}

// GetClusterAuthState returns the current auth state for a specific cluster.
func (m *ClusterRuntimeManager) GetClusterAuthState(clusterID string) (string, string) {
	if m == nil || clusterID == "" {
		return "unknown", ""
	}

	clients := m.clusterClientsForID(clusterID)
	if clients == nil || clients.authManager == nil {
		return "unknown", ""
	}

	state, reason := clients.authManager.State()
	return state.String(), reason
}

// handleClusterAuthRecoveryProgress handles recovery progress updates for a specific cluster.
// This is called periodically during recovery to allow the frontend to show countdowns.
func (m *ClusterRuntimeManager) handleClusterAuthRecoveryProgress(clusterID string, progress authstate.RecoveryProgress) {
	if m == nil || clusterID == "" {
		return
	}

	// Get cluster name and the stored failure diagnostic. FailureDiagnostic is
	// read outside the manager's lock (OnRecoveryProgress fires after emitProgress
	// releases it), so this cannot deadlock.
	clusterName := clusterID
	var diag authstate.FailureDiagnostic
	if clients := m.clusterClientsForID(clusterID); clients != nil {
		clusterName = clients.meta.Name
		if clients.authManager != nil {
			diag = clients.authManager.FailureDiagnostic()
		}
	}

	// Emit per-cluster progress event for the frontend. errorClass carries the
	// latest probe verdict ("auth", "connectivity", or "" before any verdict)
	// so the UI can distinguish an unreachable cluster from rejected credentials.
	// The typed diagnostic fields let a late-subscribing UI render exec-helper
	// copy without having seen the failed/recovering event.
	payload := authEventPayload(clusterID, clusterName, diag)
	m.emitEvent(clusterAuthProgressEventName, ClusterAuthProgressEvent{
		ClusterID:         payload.ClusterID,
		ClusterName:       payload.ClusterName,
		Reason:            payload.Reason,
		Class:             payload.Class,
		Kind:              payload.Kind,
		Summary:           payload.Summary,
		ExecCommand:       payload.ExecCommand,
		SecondsUntilRetry: progress.SecondsUntilRetry,
		ErrorClass:        string(progress.ErrorClass),
	})
}
