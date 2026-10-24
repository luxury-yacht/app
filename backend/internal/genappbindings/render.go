// Package genappbindings renders, from one binding table, the object-panel
// detail-fetcher dispatch map and the BindingModelAnchor that keeps every
// detail DTO reachable by the Wails binding generator.
//
// Every kind's detail fetch is the same shape: call the kind's typed service
// method with (namespace, name) or (name). The only things that vary per kind —
// the kind name, whether it is namespaced, the service constructor, and the
// method name — are declared once in the bindings table below, so "add a kind"
// is a single table row plus its typed service method/DTO.
//
// Three kinds — pods (extra args), helm (its own Dependencies), and
// apiextensions/CRD — are absent from the registry bindings but still have a
// generated detail fetcher, declared in detailExtras.
package genappbindings

import (
	"bytes"
	"fmt"
	"go/format"
	"path"
	"sort"
	"strings"

	"github.com/luxury-yacht/app/backend/resources/apiextensions"
	"github.com/luxury-yacht/app/backend/resources/pods"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/resourcekind"
	"github.com/luxury-yacht/app/backend/resources/appbinding"
)

const resourcesPkg = "github.com/luxury-yacht/app/backend/resources/"

// binding describes one kind's typed detail fetch. Method defaults to Name.
type binding struct {
	Name       string // K8s kind: the DTO is <Name>Details
	Namespaced bool
	Method     string // service method (default Name)
	Service    string // service constructor expression, e.g. "rbac.NewService(deps)"
	Import     string // service package import path
	DTOImport  string // DTO package import path (default: Import — DTO shares the service's package)
	DTOName    string // DTO type name (default: <Name>Details)
	Fetch      string // raw detail-fetch expression override (default: Service.Method(args))
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

func (b binding) dtoName() string {
	if b.DTOName != "" {
		return b.DTOName
	}
	return b.Name + "Details"
}

// dtoType is the package-qualified DTO type the anchor references, e.g.
// "deployment.DeploymentDetails". Qualifying it here means package backend no
// longer needs a re-export alias for every kind's DTO.
func (b binding) dtoType() string {
	return b.detailType().GoType()
}

func (b binding) detailType() DetailType {
	return DetailType{Tag: b.detailKey(), DTOImport: b.dtoImport(), DTOName: b.dtoName()}
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
		return fmt.Sprintf("%s.%s(ctx, namespace, name)", b.Service, b.method())
	}
	return fmt.Sprintf("%s.%s(ctx, name)", b.Service, b.method())
}

// fromSpec adapts a kind package's appbinding.Spec to the generator's internal
// binding, taking the kind name and scope from the spec's Identity so neither is
// a second copy.
func fromSpec(s appbinding.Spec) binding {
	return binding{
		Name:       s.Identity.Kind,
		Namespaced: s.Identity.Namespaced,
		Method:     s.Method,
		Service:    s.Service,
		Import:     s.Import,
		DTOImport:  s.DTOImport,
		DTOName:    s.DTOName,
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

// Bindings is the aggregated source for the generated detail fetchers and DTO
// anchor, derived from the kind registry. The generator sorts by Name for stable
// output, so registry order is immaterial.
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

// detailExtras are kinds that have a runtime object-panel detail fetcher but no
// registry binding, so they are absent from Bindings. They take part only in
// detail-fetcher generation; the anchor lists their DTOs explicitly. Their
// Identity is declared inline because HelmRelease is not a built-in Kubernetes kind.
var detailExtras = fromSpecs([]appbinding.Spec{
	{Identity: pods.Identity, Fetch: "pods.GetPod(ctx, deps, namespace, name, true)", Import: resourcesPkg + "pods", DTOImport: resourcesPkg + "types", DTOName: "PodDetailInfo"},
	{Identity: resourcekind.Identity{Kind: "HelmRelease", Namespaced: true}, Fetch: "helm.NewService(helm.Dependencies{Common: deps}).ReleaseDetails(ctx, namespace, name)", Import: resourcesPkg + "helm"},
	{Identity: apiextensions.Identity, Service: "apiextensions.NewService(deps)", Import: resourcesPkg + "apiextensions"},
})

// CustomResourceDetailType tags the details of discovered custom resources. They
// share one DTO and are fetched outside objectDetailFetchers.
const CustomResourceDetailType = "customresource"

// DetailType is one type of object-panel detail: the tag the object-details
// payload carries and the DTO its details decode to.
type DetailType struct {
	Tag       string
	DTOImport string // import path of the package declaring the DTO
	DTOName   string
}

// GoType is the package-qualified DTO type, e.g. "deployment.DeploymentDetails".
func (d DetailType) GoType() string {
	return path.Base(d.DTOImport) + "." + d.DTOName
}

// detailRows are the kinds with a generated detail fetcher, ordered by tag.
func detailRows() []binding {
	rows := append([]binding(nil), Bindings...)
	rows = append(rows, detailExtras...)
	sort.Slice(rows, func(i, j int) bool { return rows[i].detailKey() < rows[j].detailKey() })
	return rows
}

// DetailTypes lists every detail type a fetched object detail can carry: one
// per generated fetcher, then discovered custom resources. The refresh contract
// generator renders the payload's TypeScript union from it.
func DetailTypes() []DetailType {
	rows := detailRows()
	types := make([]DetailType, 0, len(rows)+1)
	for _, r := range rows {
		types = append(types, r.detailType())
	}
	return append(types, DetailType{Tag: CustomResourceDetailType, DTOImport: resourcesPkg + "customresource", DTOName: "Details"})
}

// Render returns the gofmt'd source of the generated binding-model anchor file.
func Render() ([]byte, error) {
	rows := append([]binding(nil), Bindings...)
	sort.Slice(rows, func(i, j int) bool { return rows[i].Name < rows[j].Name })

	importSet := map[string]struct{}{}
	for _, r := range rows {
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
	b.WriteString("// BindingModelAnchor keeps object-detail DTOs reachable by the Wails generator;\n")
	b.WriteString("// the object-details refresh domain returns them untyped.\n")
	b.WriteString("//wails:internal\n")
	b.WriteString("type BindingModelAnchor struct {\n")
	for _, r := range rows {
		fmt.Fprintf(&b, "\t%s *%s\n", r.Name, r.dtoType())
	}
	b.WriteString("\tCustomResourceDefinition *CustomResourceDefinitionDetails\n")
	b.WriteString("\tHelmRelease *HelmReleaseDetails\n")
	b.WriteString("\tPod *PodDetailInfo\n")
	b.WriteString("}\n\n")
	b.WriteString("//wails:internal\n")
	b.WriteString("func (s *DesktopService) BindingModelAnchor() BindingModelAnchor { return BindingModelAnchor{} }\n")
	return format.Source(b.Bytes())
}

// RenderDetailFetchers returns the gofmt'd source of the generated
// objectDetailFetchers map: the object panel's GVK→typed-detail dispatch, built
// from the binding table plus detailExtras, so the dispatch can never be a
// hand-maintained second copy.
func RenderDetailFetchers() ([]byte, error) {
	rows := detailRows()

	importSet := map[string]struct{}{
		"context": {},
		"github.com/luxury-yacht/app/backend/refresh/snapshot": {},
		"github.com/luxury-yacht/app/backend/resources/common": {},
	}
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
	b.WriteString("// customResourceDetailType tags discovered custom-resource details.\n")
	fmt.Fprintf(&b, "const customResourceDetailType = %q\n\n", CustomResourceDetailType)
	b.WriteString("// objectDetailFetchers maps a kind's dispatch key to its typed detail retrieval.\n")
	b.WriteString("var objectDetailFetchers = map[string]objectDetailFetcher{\n")
	for _, r := range rows {
		fmt.Fprintf(&b, "\t%q: {\n", r.detailKey())
		b.WriteString("\t\twithDeps: func(ctx context.Context, deps common.Dependencies, namespace, name string) (snapshot.ObjectDetail, error) {\n")
		fmt.Fprintf(&b, "\t\t\tdetail, err := %s\n", r.fetchExpr())
		fmt.Fprintf(&b, "\t\t\treturn tagObjectDetail[*%s](%q, detail, err)\n", r.dtoType(), r.detailKey())
		b.WriteString("\t\t},\n")
		b.WriteString("\t},\n")
	}
	b.WriteString("}\n")
	return format.Source(b.Bytes())
}
