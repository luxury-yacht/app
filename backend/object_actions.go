/*
 * backend/object_actions.go
 *
 * Owns the backend side of the object action contract consumed by frontend
 * actions and legacy wrapper methods.
 */

package backend

import (
	"fmt"
	"strings"

	"github.com/luxury-yacht/app/backend/objectaction"
	"github.com/luxury-yacht/app/backend/resources/nodes"
	"github.com/luxury-yacht/app/backend/resources/pods"

	"github.com/luxury-yacht/app/backend/resourcemodel"
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
	app     *App
	action  string
	target  ObjectActionTargetRef
	request ObjectActionRequest
}

type objectActionHandler func(objectActionInvocation) (ObjectActionResponse, error)

var objectActionHandlers = map[string]objectActionHandler{
	ObjectActionDelete:               runDeleteObjectAction,
	ObjectActionRemoveFinalizer:      runRemoveFinalizerObjectAction,
	ObjectActionForceDelete:          runForceDeleteObjectAction,
	ObjectActionRestart:              runRestartObjectAction,
	ObjectActionScale:                runScaleObjectAction,
	ObjectActionTrigger:              runTriggerObjectAction,
	ObjectActionSuspend:              runSuspendObjectAction,
	ObjectActionCordon:               runCordonObjectAction,
	ObjectActionUncordon:             runUncordonObjectAction,
	ObjectActionDrain:                runDrainObjectAction,
	ObjectActionStartDrain:           runStartDrainObjectAction,
	ObjectActionStartPortForward:     runStartPortForwardObjectAction,
	ObjectActionCreateDebugContainer: runCreateDebugContainerObjectAction,
	ObjectActionRollback:             runRollbackObjectAction,
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
	return objectActionTarget(t.ClusterID, t.Group, t.Version, t.Kind, t.Namespace, t.Name)
}

func validateObjectActionTarget(target ObjectActionTargetRef) (ObjectActionTargetRef, error) {
	normalized := normalizeObjectActionTarget(target)
	if err := resourcemodel.ValidateResourceRef(normalized); err != nil {
		return ObjectActionTargetRef{}, err
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
	return fmt.Errorf("unsupported object action %q", action)
}

func requireActionNamespacedTarget(target ObjectActionTargetRef, action string) error {
	if strings.TrimSpace(target.Namespace) == "" {
		return fmt.Errorf("%s requires namespace for %s/%s", action, target.Kind, target.Name)
	}
	return nil
}

func requireObjectActionOption[T any](value *T, name, action string) (T, error) {
	if value == nil {
		var zero T
		return zero, fmt.Errorf("%s action requires %s", action, name)
	}
	return *value, nil
}

func errUnsupportedActionTarget(action string, target ObjectActionTargetRef, apiVersion, kind string) error {
	return fmt.Errorf("%s requires %s %s target, got %s %s", action, apiVersion, kind, objectActionTargetGVK(target).GroupVersion().String(), target.Kind)
}

func (a *App) deleteObjectAction(target ObjectActionTargetRef, force bool) error {
	switch {
	case target.Group == "" && target.Version == "v1" && target.Kind == pods.Identity.Kind:
		return a.deletePodAction(target)
	case target.Group == "" && target.Version == "v1" && target.Kind == nodes.Identity.Kind:
		return a.deleteNodeAction(target, force)
	case target.Group == "helm.sh" && target.Version == "v3" && strings.EqualFold(target.Kind, "HelmRelease"):
		return a.deleteHelmReleaseAction(target)
	default:
		if force {
			return fmt.Errorf("force delete is only supported for core/v1 Node")
		}
		return a.deleteGenericResourceAction(target)
	}
}

// RunObjectAction is the single Wails mutation contract for Kubernetes object
// actions. The target always carries clusterId + full GVK + name, and namespace
// when the target is namespaced.
func (a *App) RunObjectAction(req ObjectActionRequest) (ObjectActionResponse, error) {
	action := strings.TrimSpace(req.Action)
	if err := validateObjectActionName(action); err != nil {
		return ObjectActionResponse{}, err
	}
	target, err := validateObjectActionTarget(req.Target)
	if err != nil {
		return ObjectActionResponse{}, err
	}
	handler, ok := objectActionHandlers[action]
	if !ok {
		return ObjectActionResponse{}, fmt.Errorf("object action %q has no backend handler", action)
	}
	return handler(objectActionInvocation{app: a, action: action, target: target, request: req})
}

func runDeleteObjectAction(invocation objectActionInvocation) (ObjectActionResponse, error) {
	return ObjectActionResponse{}, invocation.app.deleteObjectAction(invocation.target, false)
}

func runRemoveFinalizerObjectAction(invocation objectActionInvocation) (ObjectActionResponse, error) {
	finalizer := strings.TrimSpace(invocation.request.Finalizer)
	if finalizer == "" {
		return ObjectActionResponse{}, fmt.Errorf("%s action requires finalizer", invocation.action)
	}
	path := strings.TrimSpace(invocation.request.FinalizerPath)
	if path == "" {
		return ObjectActionResponse{}, fmt.Errorf("%s action requires finalizerPath", invocation.action)
	}
	if path == objectFinalizerPathSpec && !isNamespaceFinalizerTarget(invocation.target) {
		return ObjectActionResponse{}, fmt.Errorf("%s requires core/v1 Namespace target", path)
	}
	if path != objectFinalizerPathMetadata && path != objectFinalizerPathSpec {
		return ObjectActionResponse{}, fmt.Errorf("unsupported finalizer path %q", path)
	}
	return ObjectActionResponse{}, invocation.app.removeObjectFinalizerAction(invocation.target, finalizer, path)
}

func runForceDeleteObjectAction(invocation objectActionInvocation) (ObjectActionResponse, error) {
	return ObjectActionResponse{}, invocation.app.deleteObjectAction(invocation.target, true)
}

func runRestartObjectAction(invocation objectActionInvocation) (ObjectActionResponse, error) {
	if err := requireActionNamespacedTarget(invocation.target, invocation.action); err != nil {
		return ObjectActionResponse{}, err
	}
	return ObjectActionResponse{}, invocation.app.restartWorkloadAction(invocation.target)
}

func runScaleObjectAction(invocation objectActionInvocation) (ObjectActionResponse, error) {
	replicas, err := requireObjectActionOption(invocation.request.Replicas, "replicas", invocation.action)
	if err != nil {
		return ObjectActionResponse{}, err
	}
	if err := requireActionNamespacedTarget(invocation.target, invocation.action); err != nil {
		return ObjectActionResponse{}, err
	}
	return ObjectActionResponse{}, invocation.app.scaleWorkloadAction(invocation.target, replicas)
}

func runTriggerObjectAction(invocation objectActionInvocation) (ObjectActionResponse, error) {
	if err := requireActionNamespacedTarget(invocation.target, invocation.action); err != nil {
		return ObjectActionResponse{}, err
	}
	name, err := invocation.app.triggerCronJobAction(invocation.target)
	return ObjectActionResponse{Name: name}, err
}

func runSuspendObjectAction(invocation objectActionInvocation) (ObjectActionResponse, error) {
	suspend, err := requireObjectActionOption(invocation.request.Suspend, "suspend", invocation.action)
	if err != nil {
		return ObjectActionResponse{}, err
	}
	if err := requireActionNamespacedTarget(invocation.target, invocation.action); err != nil {
		return ObjectActionResponse{}, err
	}
	return ObjectActionResponse{}, invocation.app.suspendCronJobAction(invocation.target, suspend)
}

func runCordonObjectAction(invocation objectActionInvocation) (ObjectActionResponse, error) {
	return ObjectActionResponse{}, invocation.app.cordonNodeAction(invocation.target)
}

func runUncordonObjectAction(invocation objectActionInvocation) (ObjectActionResponse, error) {
	return ObjectActionResponse{}, invocation.app.uncordonNodeAction(invocation.target)
}

func runDrainObjectAction(invocation objectActionInvocation) (ObjectActionResponse, error) {
	return ObjectActionResponse{}, invocation.app.drainNodeAction(invocation.target, objectActionDrainOptions(invocation.request))
}

func runStartDrainObjectAction(invocation objectActionInvocation) (ObjectActionResponse, error) {
	jobID, err := invocation.app.startDrainNodeAction(invocation.target, objectActionDrainOptions(invocation.request))
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
	sessionID, err := invocation.app.startPortForwardAction(invocation.target, options)
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
	response, err := invocation.app.createDebugContainerAction(invocation.target, options)
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
	return ObjectActionResponse{}, invocation.app.rollbackWorkloadAction(invocation.target, revision)
}
