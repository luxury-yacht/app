/*
 * backend/object_actions.go
 *
 * Owns the backend side of the object action contract consumed by frontend
 * actions and legacy wrapper methods.
 */

package backend

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/errorstatus"
	"github.com/luxury-yacht/app/backend/objectaction"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/nodes"
	"github.com/luxury-yacht/app/backend/resources/pods"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

const (
	ObjectActionDelete               = objectaction.BackendDelete
	ObjectActionRemoveFinalizer      = objectaction.BackendRemoveFinalizer
	ObjectActionForceDelete          = objectaction.BackendForceDelete
	ObjectActionRestart              = objectaction.BackendRestart
	ObjectActionScale                = objectaction.BackendScale
	ObjectActionTrigger              = objectaction.BackendTrigger
	ObjectActionSuspend              = objectaction.BackendSuspend
	ObjectActionCordon               = objectaction.BackendCordon
	ObjectActionUncordon             = objectaction.BackendUncordon
	ObjectActionDrain                = objectaction.BackendDrain
	ObjectActionStartDrain           = objectaction.BackendStartDrain
	ObjectActionStartPortForward     = objectaction.BackendPortForward
	ObjectActionCreateDebugContainer = objectaction.BackendDebugContainer
	ObjectActionRollback             = objectaction.BackendRollback
)

func backendActionSet(definitions []objectaction.BackendActionDefinition) map[string]struct{} {
	actions := make(map[string]struct{}, len(definitions))
	for _, definition := range definitions {
		actions[string(definition.Action)] = struct{}{}
	}
	return actions
}

var frontendObjectActions = backendActionSet(objectaction.FrontendBackendActions)
var backendOnlyObjectActions = backendActionSet(objectaction.BackendOnlyActions)

type objectActionInvocation struct {
	gateway *ResourceGateway
	action  string
	target  ObjectActionTargetRef
	request ObjectActionRequest
}

type objectActionHandler func(objectActionInvocation) (ObjectActionResponse, error)

var objectActionHandlers = map[string]objectActionHandler{
	ObjectActionDelete:               boundedObjectAction(runDeleteObjectAction),
	ObjectActionRemoveFinalizer:      runRemoveFinalizerObjectAction,
	ObjectActionForceDelete:          boundedObjectAction(runForceDeleteObjectAction),
	ObjectActionRestart:              boundedObjectAction(runRestartObjectAction),
	ObjectActionScale:                boundedObjectAction(runScaleObjectAction),
	ObjectActionTrigger:              runTriggerObjectAction,
	ObjectActionSuspend:              boundedObjectAction(runSuspendObjectAction),
	ObjectActionCordon:               boundedObjectAction(runCordonObjectAction),
	ObjectActionUncordon:             boundedObjectAction(runUncordonObjectAction),
	ObjectActionDrain:                runDrainObjectAction,
	ObjectActionStartDrain:           boundedObjectAction(runStartDrainObjectAction),
	ObjectActionStartPortForward:     runStartPortForwardObjectAction,
	ObjectActionCreateDebugContainer: runCreateDebugContainerObjectAction,
	ObjectActionRollback:             runRollbackObjectAction,
}

// objectActionsBoundToUID are the actions that tie their writes to target.UID, so
// the API server refuses them for any other object.
var objectActionsBoundToUID = map[string]struct{}{
	ObjectActionDelete:      {},
	ObjectActionForceDelete: {},
	ObjectActionRestart:     {},
	ObjectActionScale:       {},
	ObjectActionSuspend:     {},
	ObjectActionCordon:      {},
	ObjectActionUncordon:    {},
	ObjectActionDrain:       {},
	ObjectActionStartDrain:  {},
}

// requireEnforceableUID refuses a UID the action cannot hold the cluster to. A UID
// is the caller's promise that only that object changes, so an action that would
// ignore it must not run against whatever now holds the name. A listed action must
// bind the UID for every target it accepts. A Helm release is the one target none
// can bind: Helm stores it, not the cluster.
func requireEnforceableUID(action string, target ObjectActionTargetRef) error {
	if target.UID == "" {
		return nil
	}
	_, bound := objectActionsBoundToUID[action]
	if bound && !resourcemodel.IsHelmReleaseGVK(objectActionTargetGVK(target)) {
		return nil
	}
	return errorstatus.BadRequest(fmt.Errorf("%s of %s %s cannot be limited to one object by UID", action, target.Kind, target.Name))
}

const objectActionNoAnswerMessage = "The cluster did not answer in time."

// boundedObjectAction limits how long an action waits on the cluster. The deadline
// cancels the action's own requests, so none is still running once the caller has
// its answer. The caller can tell this case apart: it means the cluster stopped
// responding, not that it refused. Two things run outside it. A drain that
// start-drain begins runs on under the app's context after the call returns. A
// Helm release delete ignores the deadline: its permission check keeps its own
// shorter timeout and Helm's uninstall takes no context, so the call lasts as long
// as Helm does.
func boundedObjectAction(
	handler func(context.Context, objectActionInvocation) (ObjectActionResponse, error),
) objectActionHandler {
	return func(invocation objectActionInvocation) (ObjectActionResponse, error) {
		ctx, cancel := common.WithDefaultTimeout(invocation.gateway.CtxOrBackground(), config.ObjectActionRequestTimeout)
		defer cancel()
		response, err := handler(ctx, invocation)
		if errors.Is(err, context.DeadlineExceeded) {
			err = errorstatus.NoAnswerInTime(errorstatus.WithMessage(objectActionNoAnswerMessage, err))
		}
		return response, err
	}
}

// ObjectActionTargetRef is the canonical object identity for state-changing
// app actions. Core resources use group="" with version="v1".
type ObjectActionTargetRef = resourcemodel.ResourceRef

type ObjectActionPortForwardOptions struct {
	ContainerPort int `json:"containerPort"`
	LocalPort     int `json:"localPort"`
}

type ObjectActionDebugContainerOptions struct {
	Image           string `json:"image"`
	TargetContainer string `json:"targetContainer,omitempty"`
}

type ObjectActionRequest struct {
	Action         string                             `json:"action"`
	Target         ObjectActionTargetRef              `json:"target"`
	Replicas       *int                               `json:"replicas,omitempty"`
	Suspend        *bool                              `json:"suspend,omitempty"`
	DrainOptions   *DrainNodeOptions                  `json:"drainOptions,omitempty"`
	PortForward    *ObjectActionPortForwardOptions    `json:"portForward,omitempty"`
	DebugContainer *ObjectActionDebugContainerOptions `json:"debugContainer,omitempty"`
	Revision       *int64                             `json:"revision,omitempty"`
	Finalizer      string                             `json:"finalizer,omitempty"`
	FinalizerPath  string                             `json:"finalizerPath,omitempty"`
}

type ObjectActionResponse struct {
	Name           string                  `json:"name,omitempty"`
	JobID          string                  `json:"jobId,omitempty"`
	SessionID      string                  `json:"sessionId,omitempty"`
	DebugContainer *DebugContainerResponse `json:"debugContainer,omitempty"`
}

func objectActionTarget(clusterID, group, version, kind, namespace, name string) ObjectActionTargetRef {
	return resourcemodel.NewResourceRef(resourcemodel.ResourceRef{ClusterID: clusterID, Group: group, Version: version, Kind: kind, Resource: "", Namespace: namespace, Name: name, UID: ""})
}

func objectActionTargetGVK(t ObjectActionTargetRef) schema.GroupVersionKind {
	return schema.GroupVersionKind{
		Group:   strings.TrimSpace(t.Group),
		Version: strings.TrimSpace(t.Version),
		Kind:    strings.TrimSpace(t.Kind),
	}
}

func normalizeObjectActionTarget(t ObjectActionTargetRef) ObjectActionTargetRef {
	normalized := objectActionTarget(t.ClusterID, t.Group, t.Version, t.Kind, t.Namespace, t.Name)
	normalized.UID = strings.TrimSpace(t.UID)
	return normalized
}

func validateObjectActionTarget(target ObjectActionTargetRef) (ObjectActionTargetRef, error) {
	normalized := normalizeObjectActionTarget(target)
	if err := resourcemodel.ValidateResourceRef(normalized); err != nil {
		return ObjectActionTargetRef{}, errorstatus.BadRequest(err)
	}
	return normalized, nil
}

func validateObjectActionName(action string) error {
	if _, ok := frontendObjectActions[action]; ok {
		return nil
	}
	if _, ok := backendOnlyObjectActions[action]; ok {
		return nil
	}
	return errorstatus.BadRequest(fmt.Errorf("unsupported object action %q", action))
}

func requireActionNamespacedTarget(target ObjectActionTargetRef, action string) error {
	if strings.TrimSpace(target.Namespace) == "" {
		return errorstatus.BadRequest(fmt.Errorf("%s requires namespace for %s/%s", action, target.Kind, target.Name))
	}
	return nil
}

func requireObjectActionOption[T any](value *T, name, action string) (T, error) {
	if value == nil {
		var zero T
		return zero, errorstatus.BadRequest(fmt.Errorf("%s action requires %s", action, name))
	}
	return *value, nil
}

func errUnsupportedActionTarget(action string, target ObjectActionTargetRef, apiVersion, kind string) error {
	return errorstatus.BadRequest(fmt.Errorf("%s requires %s %s target, got %s %s", action, apiVersion, kind, objectActionTargetGVK(target).GroupVersion().String(), target.Kind))
}

func (g *ResourceGateway) deleteObjectAction(ctx context.Context, target ObjectActionTargetRef, force bool) error {
	return g.confirmDeletedObjectAbsence(ctx, target, g.dispatchObjectDelete(ctx, target, force))
}

func (g *ResourceGateway) dispatchObjectDelete(ctx context.Context, target ObjectActionTargetRef, force bool) error {
	switch {
	case target.Group == "" && target.Version == "v1" && target.Kind == pods.Identity.Kind:
		return g.deletePodAction(ctx, target)
	case target.Group == "" && target.Version == "v1" && target.Kind == nodes.Identity.Kind:
		return g.deleteNodeAction(ctx, target, force)
	case resourcemodel.IsHelmReleaseGVK(objectActionTargetGVK(target)):
		return g.deleteHelmReleaseAction(target)
	default:
		if force {
			return errorstatus.BadRequest(fmt.Errorf("force delete is only supported for core/v1 Node"))
		}
		return g.deleteGenericResourceAction(ctx, target)
	}
}

// confirmDeletedObjectAbsence names the target on a delete's 404 only once a read of
// that exact object also finds nothing. The delete's own 404 proves nothing: an
// admission webhook can answer with any status, while reads never pass through one.
func (g *ResourceGateway) confirmDeletedObjectAbsence(ctx context.Context, target ObjectActionTargetRef, err error) error {
	if !apierrors.IsNotFound(err) {
		return err
	}
	deps, _, resolveErr := g.resolveClusterDependencies(target.ClusterID)
	if resolveErr != nil {
		return err
	}
	gvk := objectActionTargetGVK(target)
	gvr, _, resolveErr := resolveObjectYAMLGVR(ctx, deps, gvk, objectYAMLResolverStrict)
	if resolveErr != nil {
		return err
	}
	_, readErr := fetchObjectByGVK(ctx, deps, gvk, target.Namespace, target.Name)
	if !errorstatus.ConfirmsObjectAbsent(readErr, gvr.GroupResource(), target.Name) {
		return err
	}
	return errorstatus.ObjectNotFound(objectActionStatusRef(target), err)
}

func (g *ResourceGateway) rollbackObjectAction(target ObjectActionTargetRef, revision int64) error {
	if resourcemodel.IsHelmReleaseGVK(objectActionTargetGVK(target)) {
		return g.rollbackHelmReleaseAction(target, revision)
	}
	return g.rollbackWorkloadAction(target, revision)
}

// RunObjectAction is the single Wails mutation contract for Kubernetes object
// actions. The target always carries clusterId + full GVK + name, and namespace
// when the target is namespaced.
func (g *ResourceGateway) RunObjectAction(req ObjectActionRequest) (ObjectActionResponse, error) {
	action := strings.TrimSpace(req.Action)
	if err := validateObjectActionName(action); err != nil {
		return ObjectActionResponse{}, err
	}
	target, err := validateObjectActionTarget(req.Target)
	if err != nil {
		return ObjectActionResponse{}, err
	}
	if err := requireEnforceableUID(action, target); err != nil {
		return ObjectActionResponse{}, err
	}
	handler, ok := objectActionHandlers[action]
	if !ok {
		return ObjectActionResponse{}, fmt.Errorf("object action %q has no backend handler", action)
	}
	response, err := handler(objectActionInvocation{gateway: g, action: action, target: target, request: req})
	return response, errorstatus.UserAction(objectActionStatusRef(target), err)
}

// objectActionStatusRef is the action target as an error-status object reference.
func objectActionStatusRef(target ObjectActionTargetRef) errorstatus.ObjectRef {
	return errorstatus.ObjectRef{
		ClusterID: target.ClusterID, Group: target.Group, Version: target.Version,
		Kind: target.Kind, Namespace: target.Namespace, Name: target.Name,
	}
}

func runDeleteObjectAction(ctx context.Context, invocation objectActionInvocation) (ObjectActionResponse, error) {
	return ObjectActionResponse{}, invocation.gateway.deleteObjectAction(ctx, invocation.target, false)
}

func runRemoveFinalizerObjectAction(invocation objectActionInvocation) (ObjectActionResponse, error) {
	finalizer := strings.TrimSpace(invocation.request.Finalizer)
	if finalizer == "" {
		return ObjectActionResponse{}, errorstatus.BadRequest(fmt.Errorf("%s action requires finalizer", invocation.action))
	}
	path := strings.TrimSpace(invocation.request.FinalizerPath)
	if path == "" {
		return ObjectActionResponse{}, errorstatus.BadRequest(fmt.Errorf("%s action requires finalizerPath", invocation.action))
	}
	if path == objectFinalizerPathSpec && !isNamespaceFinalizerTarget(invocation.target) {
		return ObjectActionResponse{}, errorstatus.BadRequest(fmt.Errorf("%s requires core/v1 Namespace target", path))
	}
	if path != objectFinalizerPathMetadata && path != objectFinalizerPathSpec {
		return ObjectActionResponse{}, errorstatus.BadRequest(fmt.Errorf("unsupported finalizer path %q", path))
	}
	return ObjectActionResponse{}, invocation.gateway.removeObjectFinalizerAction(invocation.target, finalizer, path)
}

func runForceDeleteObjectAction(ctx context.Context, invocation objectActionInvocation) (ObjectActionResponse, error) {
	return ObjectActionResponse{}, invocation.gateway.deleteObjectAction(ctx, invocation.target, true)
}

func runRestartObjectAction(ctx context.Context, invocation objectActionInvocation) (ObjectActionResponse, error) {
	if err := requireActionNamespacedTarget(invocation.target, invocation.action); err != nil {
		return ObjectActionResponse{}, err
	}
	return ObjectActionResponse{}, invocation.gateway.restartWorkloadAction(ctx, invocation.target)
}

func runScaleObjectAction(ctx context.Context, invocation objectActionInvocation) (ObjectActionResponse, error) {
	replicas, err := requireObjectActionOption(invocation.request.Replicas, "replicas", invocation.action)
	if err != nil {
		return ObjectActionResponse{}, err
	}
	if err := requireActionNamespacedTarget(invocation.target, invocation.action); err != nil {
		return ObjectActionResponse{}, err
	}
	return ObjectActionResponse{}, invocation.gateway.scaleWorkloadAction(ctx, invocation.target, replicas)
}

func runTriggerObjectAction(invocation objectActionInvocation) (ObjectActionResponse, error) {
	if err := requireActionNamespacedTarget(invocation.target, invocation.action); err != nil {
		return ObjectActionResponse{}, err
	}
	name, err := invocation.gateway.triggerCronJobAction(invocation.target)
	return ObjectActionResponse{Name: name}, err
}

func runSuspendObjectAction(ctx context.Context, invocation objectActionInvocation) (ObjectActionResponse, error) {
	suspend, err := requireObjectActionOption(invocation.request.Suspend, "suspend", invocation.action)
	if err != nil {
		return ObjectActionResponse{}, err
	}
	if err := requireActionNamespacedTarget(invocation.target, invocation.action); err != nil {
		return ObjectActionResponse{}, err
	}
	return ObjectActionResponse{}, invocation.gateway.suspendCronJobAction(ctx, invocation.target, suspend)
}

func runCordonObjectAction(ctx context.Context, invocation objectActionInvocation) (ObjectActionResponse, error) {
	return ObjectActionResponse{}, invocation.gateway.cordonNodeAction(ctx, invocation.target)
}

func runUncordonObjectAction(ctx context.Context, invocation objectActionInvocation) (ObjectActionResponse, error) {
	return ObjectActionResponse{}, invocation.gateway.uncordonNodeAction(ctx, invocation.target)
}

func runDrainObjectAction(invocation objectActionInvocation) (ObjectActionResponse, error) {
	return ObjectActionResponse{}, invocation.gateway.drainNodeAction(invocation.target, objectActionDrainOptions(invocation.request))
}

func runStartDrainObjectAction(ctx context.Context, invocation objectActionInvocation) (ObjectActionResponse, error) {
	jobID, err := invocation.gateway.startDrainNodeAction(ctx, invocation.target, objectActionDrainOptions(invocation.request))
	return ObjectActionResponse{JobID: jobID}, err
}

func objectActionDrainOptions(request ObjectActionRequest) DrainNodeOptions {
	if request.DrainOptions == nil {
		return DrainNodeOptions{}
	}
	return *request.DrainOptions
}

func runStartPortForwardObjectAction(invocation objectActionInvocation) (ObjectActionResponse, error) {
	options, err := requireObjectActionOption(invocation.request.PortForward, "portForward", invocation.action)
	if err != nil {
		return ObjectActionResponse{}, err
	}
	if err := requireActionNamespacedTarget(invocation.target, invocation.action); err != nil {
		return ObjectActionResponse{}, err
	}
	if invocation.gateway.operations == nil {
		return ObjectActionResponse{}, fmt.Errorf("operations coordinator not initialized")
	}
	sessionID, err := invocation.gateway.operations.startPortForwardAction(invocation.target, options)
	return ObjectActionResponse{SessionID: sessionID}, err
}

func runCreateDebugContainerObjectAction(invocation objectActionInvocation) (ObjectActionResponse, error) {
	options, err := requireObjectActionOption(invocation.request.DebugContainer, "debugContainer", invocation.action)
	if err != nil {
		return ObjectActionResponse{}, err
	}
	if err := requireActionNamespacedTarget(invocation.target, invocation.action); err != nil {
		return ObjectActionResponse{}, err
	}
	response, err := invocation.gateway.createDebugContainerAction(invocation.target, options)
	return ObjectActionResponse{DebugContainer: response}, err
}

func runRollbackObjectAction(invocation objectActionInvocation) (ObjectActionResponse, error) {
	revision, err := requireObjectActionOption(invocation.request.Revision, "revision", invocation.action)
	if err != nil {
		return ObjectActionResponse{}, err
	}
	if err := requireActionNamespacedTarget(invocation.target, invocation.action); err != nil {
		return ObjectActionResponse{}, err
	}
	return ObjectActionResponse{}, invocation.gateway.rollbackObjectAction(invocation.target, revision)
}
