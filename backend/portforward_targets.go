/*
 * backend/portforward_targets.go
 *
 * Shared capability table for Kubernetes resources that can be used as
 * port-forward targets.
 */
package backend

import "fmt"

type portForwardTargetCapability struct {
	Group               string
	Version             string
	Reconnect           bool
	UsesServicePortSpec bool
}

var portForwardTargetCapabilities = map[string]portForwardTargetCapability{
	"Pod": {
		Group:     "",
		Version:   "v1",
		Reconnect: false,
	},
	"Service": {
		Group:               "",
		Version:             "v1",
		Reconnect:           true,
		UsesServicePortSpec: true,
	},
	"Deployment": {
		Group:     "apps",
		Version:   "v1",
		Reconnect: true,
	},
	"StatefulSet": {
		Group:     "apps",
		Version:   "v1",
		Reconnect: true,
	},
	"DaemonSet": {
		Group:     "apps",
		Version:   "v1",
		Reconnect: true,
	},
}

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
