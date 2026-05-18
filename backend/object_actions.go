package backend

import (
	"fmt"
	"strings"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

const (
	ObjectActionDelete               = "delete"
	ObjectActionForceDelete          = "forceDelete"
	ObjectActionRestart              = "restart"
	ObjectActionScale                = "scale"
	ObjectActionTrigger              = "trigger"
	ObjectActionSuspend              = "suspend"
	ObjectActionCordon               = "cordon"
	ObjectActionUncordon             = "uncordon"
	ObjectActionDrain                = "drain"
	ObjectActionStartDrain           = "startDrain"
	ObjectActionStartPortForward     = "startPortForward"
	ObjectActionCreateDebugContainer = "createDebugContainer"
	ObjectActionRollback             = "rollback"
)

// ObjectActionTargetRef is the canonical object identity for state-changing
// app actions. Core resources use group="" with version="v1".
type ObjectActionTargetRef struct {
	ClusterID string `json:"clusterId"`
	Group     string `json:"group"`
	Version   string `json:"version"`
	Kind      string `json:"kind"`
	Namespace string `json:"namespace,omitempty"`
	Name      string `json:"name"`
}

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
}

type ObjectActionResponse struct {
	Name           string                  `json:"name,omitempty"`
	JobID          string                  `json:"jobId,omitempty"`
	SessionID      string                  `json:"sessionId,omitempty"`
	DebugContainer *DebugContainerResponse `json:"debugContainer,omitempty"`
}

func objectActionTarget(clusterID, group, version, kind, namespace, name string) ObjectActionTargetRef {
	return ObjectActionTargetRef{
		ClusterID: strings.TrimSpace(clusterID),
		Group:     strings.TrimSpace(group),
		Version:   strings.TrimSpace(version),
		Kind:      strings.TrimSpace(kind),
		Namespace: strings.TrimSpace(namespace),
		Name:      strings.TrimSpace(name),
	}
}

func objectActionTargetFromGVK(clusterID string, gvk schema.GroupVersionKind, namespace, name string) ObjectActionTargetRef {
	return objectActionTarget(clusterID, gvk.Group, gvk.Version, gvk.Kind, namespace, name)
}

func (t ObjectActionTargetRef) gvk() schema.GroupVersionKind {
	return schema.GroupVersionKind{
		Group:   strings.TrimSpace(t.Group),
		Version: strings.TrimSpace(t.Version),
		Kind:    strings.TrimSpace(t.Kind),
	}
}

func (t ObjectActionTargetRef) normalized() ObjectActionTargetRef {
	return objectActionTarget(t.ClusterID, t.Group, t.Version, t.Kind, t.Namespace, t.Name)
}

func validateObjectActionTarget(target ObjectActionTargetRef) (ObjectActionTargetRef, error) {
	normalized := target.normalized()
	if err := resourcemodel.ValidateResourceRef(resourcemodel.NewResourceRef(
		normalized.ClusterID,
		normalized.Group,
		normalized.Version,
		normalized.Kind,
		"",
		normalized.Namespace,
		normalized.Name,
		"",
	)); err != nil {
		return ObjectActionTargetRef{}, err
	}
	return normalized, nil
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
	return fmt.Errorf("%s requires %s %s target, got %s %s", action, apiVersion, kind, target.gvk().GroupVersion().String(), target.Kind)
}

func (a *App) deleteObjectAction(target ObjectActionTargetRef, force bool) error {
	switch {
	case target.Group == "" && target.Version == "v1" && target.Kind == "Pod":
		return a.deletePodAction(target)
	case target.Group == "" && target.Version == "v1" && target.Kind == "Node":
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
	target, err := validateObjectActionTarget(req.Target)
	if err != nil {
		return ObjectActionResponse{}, err
	}

	switch action {
	case ObjectActionDelete:
		return ObjectActionResponse{}, a.deleteObjectAction(target, false)
	case ObjectActionForceDelete:
		return ObjectActionResponse{}, a.deleteObjectAction(target, true)
	case ObjectActionRestart:
		if err := requireActionNamespacedTarget(target, action); err != nil {
			return ObjectActionResponse{}, err
		}
		return ObjectActionResponse{}, a.restartWorkloadAction(target)
	case ObjectActionScale:
		replicas, err := requireObjectActionOption(req.Replicas, "replicas", action)
		if err != nil {
			return ObjectActionResponse{}, err
		}
		if err := requireActionNamespacedTarget(target, action); err != nil {
			return ObjectActionResponse{}, err
		}
		return ObjectActionResponse{}, a.scaleWorkloadAction(target, replicas)
	case ObjectActionTrigger:
		if err := requireActionNamespacedTarget(target, action); err != nil {
			return ObjectActionResponse{}, err
		}
		name, err := a.triggerCronJobAction(target)
		return ObjectActionResponse{Name: name}, err
	case ObjectActionSuspend:
		suspend, err := requireObjectActionOption(req.Suspend, "suspend", action)
		if err != nil {
			return ObjectActionResponse{}, err
		}
		if err := requireActionNamespacedTarget(target, action); err != nil {
			return ObjectActionResponse{}, err
		}
		return ObjectActionResponse{}, a.suspendCronJobAction(target, suspend)
	case ObjectActionCordon:
		return ObjectActionResponse{}, a.cordonNodeAction(target)
	case ObjectActionUncordon:
		return ObjectActionResponse{}, a.uncordonNodeAction(target)
	case ObjectActionDrain:
		options := DrainNodeOptions{}
		if req.DrainOptions != nil {
			options = *req.DrainOptions
		}
		return ObjectActionResponse{}, a.drainNodeAction(target, options)
	case ObjectActionStartDrain:
		options := DrainNodeOptions{}
		if req.DrainOptions != nil {
			options = *req.DrainOptions
		}
		jobID, err := a.startDrainNodeAction(target, options)
		return ObjectActionResponse{JobID: jobID}, err
	case ObjectActionStartPortForward:
		options, err := requireObjectActionOption(req.PortForward, "portForward", action)
		if err != nil {
			return ObjectActionResponse{}, err
		}
		if err := requireActionNamespacedTarget(target, action); err != nil {
			return ObjectActionResponse{}, err
		}
		sessionID, err := a.startPortForwardAction(target, options)
		return ObjectActionResponse{SessionID: sessionID}, err
	case ObjectActionCreateDebugContainer:
		options, err := requireObjectActionOption(req.DebugContainer, "debugContainer", action)
		if err != nil {
			return ObjectActionResponse{}, err
		}
		if err := requireActionNamespacedTarget(target, action); err != nil {
			return ObjectActionResponse{}, err
		}
		response, err := a.createDebugContainerAction(target, options)
		return ObjectActionResponse{DebugContainer: response}, err
	case ObjectActionRollback:
		revision, err := requireObjectActionOption(req.Revision, "revision", action)
		if err != nil {
			return ObjectActionResponse{}, err
		}
		if err := requireActionNamespacedTarget(target, action); err != nil {
			return ObjectActionResponse{}, err
		}
		return ObjectActionResponse{}, a.rollbackWorkloadAction(target, revision)
	default:
		return ObjectActionResponse{}, fmt.Errorf("unsupported object action %q", action)
	}
}
