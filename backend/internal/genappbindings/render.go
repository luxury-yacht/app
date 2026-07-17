// Package genappbindings renders the App.Get<Kind> resource-detail bindings and
// the object-panel detail-fetcher dispatch map, both from one binding table.
//
// Every standard binding is the same shape: resolve cluster deps, then
// Fetch{Namespaced,Cluster}Resource with a closure that calls the kind's typed
// service method. The only things that vary per kind — the kind name, whether it
// is namespaced, the fetch selection key, the service constructor, and the method
// name — are declared once in the bindings table below. Generating the wrappers
// from that table makes "add a kind" a single table row plus its typed service
// method/DTO; the wrapper can no longer drift or be forgotten.
//
// The same table also generates the runtime objectDetailFetchers map (see
// RenderDetailFetchers): the object panel dispatches a kind to the same typed
// service call, so it must not be a second hand-maintained copy. Three kinds whose
// App.Get binding is hand-written — pods (extra args), helm (its own Dependencies
// + non-Details return types), and apiextensions/CRD (extra client guard) — still
// have a generated detail fetcher, declared in detailExtras.
package genappbindings

import (
	"bytes"
	"fmt"
	"go/format"
	"sort"
	"strings"

	"github.com/luxury-yacht/app/backend/resources/apiextensions"
	"github.com/luxury-yacht/app/backend/resources/pods"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/resourcekind"
	"github.com/luxury-yacht/app/backend/resources/appbinding"
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
	DTOImport  string // DTO package import path (default: Import — DTO shares the service's package)
	Fetch      string // raw detail-fetch expression override (default: Service.Method(args))
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

// dtoImport is the import path of the package holding the <Name>Details DTO. It
// defaults to the service package (most kinds co-locate the DTO with the service)
// and is overridden when the DTO lives elsewhere (e.g. the shared resources/types).
func (b binding) dtoImport() string {
	if b.DTOImport != "" {
		return b.DTOImport
	}
	return b.Import
}

// dtoType is the package-qualified DTO type the App.Get wrapper returns, e.g.
// "deployment.DeploymentDetails". Qualifying it here means package backend no
// longer needs a re-export alias for every kind's DTO.
func (b binding) dtoType() string {
	imp := b.dtoImport()
	selector := imp[strings.LastIndex(imp, "/")+1:]
	return selector + "." + b.Name + "Details"
}

// detailKey is the object-panel dispatch key: the lowercased kind name.
func (b binding) detailKey() string {
	return strings.ToLower(b.Name)
}

// fetchExpr is the detail-fetch call the object panel runs for this kind. It is
// the Fetch override when set, else the typed service call with namespaced kinds
// taking (namespace, name) and cluster kinds taking (name).
func (b binding) fetchExpr() string {
	if b.Fetch != "" {
		return b.Fetch
	}
	if b.Namespaced {
		return fmt.Sprintf("%s.%s(namespace, name)", b.Service, b.method())
	}
	return fmt.Sprintf("%s.%s(name)", b.Service, b.method())
}

// fromSpec adapts a kind package's appbinding.Spec to the generator's internal
// binding, taking the kind name and scope from the spec's Identity so neither is
// a second copy.
func fromSpec(s appbinding.Spec) binding {
	return binding{
		Name:       s.Identity.Kind,
		Namespaced: s.Identity.Namespaced,
		Key:        s.Key,
		Method:     s.Method,
		Service:    s.Service,
		Import:     s.Import,
		DTOImport:  s.DTOImport,
		Fetch:      s.Fetch,
	}
}

func fromSpecs(specs []appbinding.Spec) []binding {
	out := make([]binding, len(specs))
	for i, s := range specs {
		out[i] = fromSpec(s)
	}
	return out
}

// Bindings is the aggregated source for the generated App.Get wrappers, derived
// from the kind registry. The generator sorts by Name for stable output, so
// registry order is immaterial.
var Bindings = bindingsFromRegistry()

func bindingsFromRegistry() []binding {
	out := make([]binding, 0, len(kindregistry.All))
	for _, d := range kindregistry.All {
		if d.Binding != nil {
			out = append(out, fromSpec(*d.Binding))
		}
	}
	return out
}

// detailExtras are kinds that have a runtime object-panel detail fetcher but whose
// App.Get binding is hand-written, so they are absent from Bindings. They take part
// only in detail-fetcher generation, never in App.Get binding generation. Their
// Identity is declared inline because HelmRelease is not a built-in Kubernetes kind.
var detailExtras = fromSpecs([]appbinding.Spec{
	{Identity: pods.Identity, Fetch: "pods.GetPod(deps, namespace, name, true)", Import: resourcesPkg + "pods"},
	{Identity: resourcekind.Identity{Kind: "HelmRelease", Namespaced: true}, Fetch: "helm.NewService(helm.Dependencies{Common: deps}).ReleaseDetails(namespace, name)", Import: resourcesPkg + "helm"},
	{Identity: apiextensions.Identity, Service: "apiextensions.NewService(deps)", Import: resourcesPkg + "apiextensions"},
})

// Render returns the gofmt'd source of the generated bindings file.
func Render() ([]byte, error) {
	rows := append([]binding(nil), Bindings...)
	sort.Slice(rows, func(i, j int) bool { return rows[i].Name < rows[j].Name })

	importSet := map[string]struct{}{}
	for _, r := range rows {
		importSet[r.Import] = struct{}{}
		importSet[r.dtoImport()] = struct{}{}
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

// RenderDetailFetchers returns the gofmt'd source of the generated
// objectDetailFetchers map: the object panel's GVK→typed-detail dispatch, built
// from the same binding table as the App.Get wrappers plus detailExtras. This is
// why the dispatch can no longer be a hand-maintained second copy.
func RenderDetailFetchers() ([]byte, error) {
	rows := append([]binding(nil), Bindings...)
	rows = append(rows, detailExtras...)
	sort.Slice(rows, func(i, j int) bool { return rows[i].detailKey() < rows[j].detailKey() })

	importSet := map[string]struct{}{"github.com/luxury-yacht/app/backend/resources/common": {}}
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
	b.WriteString("// objectDetailFetchers maps a kind's dispatch key to its typed detail retrieval.\n")
	b.WriteString("var objectDetailFetchers = map[string]objectDetailFetcher{\n")
	for _, r := range rows {
		fmt.Fprintf(&b, "\t%q: {\n", r.detailKey())
		b.WriteString("\t\twithDeps: func(deps common.Dependencies, namespace, name string) (interface{}, error) {\n")
		fmt.Fprintf(&b, "\t\t\tdetail, err := %s\n", r.fetchExpr())
		b.WriteString("\t\t\treturn detail, err\n")
		b.WriteString("\t\t},\n")
		b.WriteString("\t},\n")
	}
	b.WriteString("}\n")
	return format.Source(b.Bytes())
}

func writeBinding(b *bytes.Buffer, r binding) {
	dto := r.dtoType()
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
