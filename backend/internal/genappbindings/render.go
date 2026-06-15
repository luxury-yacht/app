// Package genappbindings renders the App.Get<Kind> resource-detail bindings.
//
// Every standard binding is the same shape: resolve cluster deps, then
// Fetch{Namespaced,Cluster}Resource with a closure that calls the kind's typed
// service method. The only things that vary per kind — the kind name, whether it
// is namespaced, the fetch selection key, the service constructor, and the method
// name — are declared once in the bindings table below. Generating the wrappers
// from that table makes "add a kind" a single table row plus its typed service
// method/DTO; the wrapper can no longer drift or be forgotten.
//
// Non-standard bindings stay hand-written: apiextensions (extra client guard),
// helm (its own Dependencies + non-Details return types), and pods (extra args).
package genappbindings

import (
	"bytes"
	"fmt"
	"go/format"
	"sort"
)

const resourcesPkg = "github.com/luxury-yacht/app/backend/resources/"

// binding describes one App.Get<Name> wrapper. Key and Method default to Name.
type binding struct {
	Name       string // K8s kind: App method is Get<Name>, DTO is <Name>Details
	Namespaced bool
	Key        string // Fetch selection key (default Name)
	Method     string // service method (default Name)
	Service    string // service constructor expression, e.g. "rbac.NewService(deps)"
	Import     string // service package import path
}

func (b binding) key() string {
	if b.Key != "" {
		return b.Key
	}
	return b.Name
}

func (b binding) method() string {
	if b.Method != "" {
		return b.Method
	}
	return b.Name
}

// Bindings is the single source for the generated App.Get wrappers. Keep it
// sorted by Name; the generator re-sorts anyway for stable output.
var Bindings = []binding{
	{Name: "BackendTLSPolicy", Namespaced: true, Service: "gatewayapi.NewService(deps)", Import: resourcesPkg + "gatewayapi"},
	{Name: "ClusterRole", Service: "rbac.NewService(deps)", Import: resourcesPkg + "rbac"},
	{Name: "ClusterRoleBinding", Service: "rbac.NewService(deps)", Import: resourcesPkg + "rbac"},
	{Name: "ConfigMap", Namespaced: true, Service: "config.NewService(deps)", Import: resourcesPkg + "config"},
	{Name: "CronJob", Namespaced: true, Service: "cronjob.NewService(deps)", Import: resourcesPkg + "cronjob"},
	{Name: "DaemonSet", Namespaced: true, Service: "daemonset.NewService(deps)", Import: resourcesPkg + "daemonset"},
	{Name: "Deployment", Namespaced: true, Service: "deployment.NewService(deps)", Import: resourcesPkg + "deployment"},
	{Name: "EndpointSlice", Namespaced: true, Service: "network.NewService(deps)", Import: resourcesPkg + "network"},
	{Name: "Gateway", Namespaced: true, Service: "gatewayapi.NewService(deps)", Import: resourcesPkg + "gatewayapi"},
	{Name: "GatewayClass", Service: "gatewayapi.NewService(deps)", Import: resourcesPkg + "gatewayapi"},
	{Name: "GRPCRoute", Namespaced: true, Service: "gatewayapi.NewService(deps)", Import: resourcesPkg + "gatewayapi"},
	{Name: "HorizontalPodAutoscaler", Namespaced: true, Key: "HPA", Service: "autoscaling.NewService(deps)", Import: resourcesPkg + "autoscaling"},
	{Name: "HTTPRoute", Namespaced: true, Service: "gatewayapi.NewService(deps)", Import: resourcesPkg + "gatewayapi"},
	{Name: "Ingress", Namespaced: true, Service: "network.NewService(deps)", Import: resourcesPkg + "network"},
	{Name: "IngressClass", Service: "ingressclass.NewService(deps)", Import: resourcesPkg + "ingressclass"},
	{Name: "Job", Namespaced: true, Service: "job.NewService(deps)", Import: resourcesPkg + "job"},
	{Name: "LimitRange", Namespaced: true, Service: "constraints.NewService(deps)", Import: resourcesPkg + "constraints"},
	{Name: "ListenerSet", Namespaced: true, Service: "gatewayapi.NewService(deps)", Import: resourcesPkg + "gatewayapi"},
	{Name: "MutatingWebhookConfiguration", Service: "admission.NewService(deps)", Import: resourcesPkg + "admission"},
	{Name: "Namespace", Service: "namespaces.NewService(deps)", Import: resourcesPkg + "namespaces"},
	{Name: "NetworkPolicy", Namespaced: true, Service: "network.NewService(deps)", Import: resourcesPkg + "network"},
	{Name: "Node", Service: "nodes.NewService(deps)", Import: resourcesPkg + "nodes"},
	{Name: "PersistentVolume", Service: "storage.NewService(deps)", Import: resourcesPkg + "storage"},
	{Name: "PersistentVolumeClaim", Namespaced: true, Key: "PVC", Service: "storage.NewService(deps)", Import: resourcesPkg + "storage"},
	{Name: "PodDisruptionBudget", Namespaced: true, Service: "poddisruptionbudget.NewService(deps)", Import: resourcesPkg + "poddisruptionbudget"},
	{Name: "ReferenceGrant", Namespaced: true, Service: "gatewayapi.NewService(deps)", Import: resourcesPkg + "gatewayapi"},
	{Name: "ReplicaSet", Namespaced: true, Service: "replicaset.NewService(deps)", Import: resourcesPkg + "replicaset"},
	{Name: "ResourceQuota", Namespaced: true, Service: "constraints.NewService(deps)", Import: resourcesPkg + "constraints"},
	{Name: "Role", Namespaced: true, Service: "rbac.NewService(deps)", Import: resourcesPkg + "rbac"},
	{Name: "RoleBinding", Namespaced: true, Service: "rbac.NewService(deps)", Import: resourcesPkg + "rbac"},
	{Name: "Secret", Namespaced: true, Service: "config.NewService(deps)", Import: resourcesPkg + "config"},
	{Name: "Service", Namespaced: true, Method: "GetService", Service: "network.NewService(deps)", Import: resourcesPkg + "network"},
	{Name: "ServiceAccount", Namespaced: true, Service: "rbac.NewService(deps)", Import: resourcesPkg + "rbac"},
	{Name: "StatefulSet", Namespaced: true, Service: "statefulset.NewService(deps)", Import: resourcesPkg + "statefulset"},
	{Name: "StorageClass", Service: "storage.NewService(deps)", Import: resourcesPkg + "storage"},
	{Name: "TLSRoute", Namespaced: true, Service: "gatewayapi.NewService(deps)", Import: resourcesPkg + "gatewayapi"},
	{Name: "ValidatingWebhookConfiguration", Service: "admission.NewService(deps)", Import: resourcesPkg + "admission"},
}

// Render returns the gofmt'd source of the generated bindings file.
func Render() ([]byte, error) {
	rows := append([]binding(nil), Bindings...)
	sort.Slice(rows, func(i, j int) bool { return rows[i].Name < rows[j].Name })

	importSet := map[string]struct{}{}
	for _, r := range rows {
		importSet[r.Import] = struct{}{}
	}
	imports := make([]string, 0, len(importSet))
	for imp := range importSet {
		imports = append(imports, imp)
	}
	sort.Strings(imports)

	var b bytes.Buffer
	b.WriteString("// Code generated by genappbindings; DO NOT EDIT.\n\n")
	b.WriteString("package backend\n\n")
	b.WriteString("import (\n")
	for _, imp := range imports {
		fmt.Fprintf(&b, "\t%q\n", imp)
	}
	b.WriteString(")\n\n")
	for _, r := range rows {
		writeBinding(&b, r)
	}
	return format.Source(b.Bytes())
}

func writeBinding(b *bytes.Buffer, r binding) {
	dto := r.Name + "Details"
	if r.Namespaced {
		fmt.Fprintf(b, `func (a *App) Get%[1]s(clusterID, namespace, name string) (*%[2]s, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	return FetchNamespacedResource(a, deps, selectionKey, %[3]q, namespace, name, func() (*%[2]s, error) {
		return %[4]s.%[5]s(namespace, name)
	})
}

`, r.Name, dto, r.key(), r.Service, r.method())
		return
	}
	fmt.Fprintf(b, `func (a *App) Get%[1]s(clusterID, name string) (*%[2]s, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	return FetchClusterResource(a, deps, selectionKey, %[3]q, name, func() (*%[2]s, error) {
		return %[4]s.%[5]s(name)
	})
}

`, r.Name, dto, r.key(), r.Service, r.method())
}
