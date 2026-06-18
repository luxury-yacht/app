/*
 * backend/portforward_targets.go
 *
 * Shared capability table for Kubernetes resources that can be used as
 * port-forward targets.
 */
package backend

import (
	"context"
	"fmt"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"k8s.io/client-go/kubernetes"
)

type portForwardTargetCapability struct {
	Group               string
	Version             string
	Reconnect           bool
	UsesServicePortSpec bool
	resolvePod          func(ctx context.Context, client kubernetes.Interface, namespace, name string) (string, error)
}

// portForwardTargetCapabilities is derived from the single kind registry: every
// kind with a PortForward facet is a port-forward target, carrying its identity and
// behaviour. The handlers never list a kind here.
var portForwardTargetCapabilities = func() map[string]portForwardTargetCapability {
	m := map[string]portForwardTargetCapability{}
	for _, d := range kindregistry.All {
		if d.PortForward == nil {
			continue
		}
		m[d.Identity.Kind] = portForwardTargetCapability{
			Group:               d.Identity.Group,
			Version:             d.Identity.Version,
			Reconnect:           d.PortForward.Reconnect,
			UsesServicePortSpec: d.PortForward.UsesServicePortSpec,
			resolvePod:          d.PortForward.ResolvePod,
		}
	}
	return m
}()

func lookupPortForwardTargetCapability(kind string) (portForwardTargetCapability, bool) {
	capability, ok := portForwardTargetCapabilities[kind]
	return capability, ok
}

func validatePortForwardTargetGVK(target portForwardTargetRef) error {
	capability, ok := lookupPortForwardTargetCapability(target.Kind)
	if !ok {
		return fmt.Errorf("unsupported target kind: %s", target.Kind)
	}
	if target.Version == "" {
		return fmt.Errorf("target version is required")
	}
	if target.Group != capability.Group || target.Version != capability.Version {
		return fmt.Errorf("target %s must use apiVersion %s", target.Kind, capability.apiVersion())
	}
	return nil
}

func (c portForwardTargetCapability) apiVersion() string {
	if c.Group == "" {
		return c.Version
	}
	return c.Group + "/" + c.Version
}
