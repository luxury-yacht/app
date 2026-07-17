package snapshot

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"strings"
	"testing"
)

// typedCapabilityConformance is the source of truth for the typed-resource
// capability conformance tests: every typed provider's published capabilities,
// driven by calling the real capability helper. A newly added typed domain must
// be added here (TestTypedResourceCapabilityConformanceCoversEveryDomain fails
// otherwise, because the AST discovery below finds a domain this map is missing).
var typedCapabilityConformance = map[string]ResourceQueryCapabilities{
	"cluster-config":        clusterConfigQueryCapabilities(),
	"cluster-storage":       clusterStorageQueryCapabilities(),
	"cluster-rbac":          clusterRBACQueryCapabilities(),
	"cluster-crds":          clusterCRDQueryCapabilities(),
	"cluster-events":        clusterEventsQueryCapabilities(),
	"cluster-attention":     clusterAttentionQueryCapabilities(),
	"namespace-config":      namespaceConfigQueryCapabilities(),
	"namespace-network":     namespaceNetworkQueryCapabilities(),
	"namespace-storage":     namespaceStorageQueryCapabilities(),
	"namespace-rbac":        namespaceRBACQueryCapabilities(),
	"namespace-quotas":      namespaceQuotasQueryCapabilities(),
	"namespace-autoscaling": namespaceAutoscalingQueryCapabilities(),
	"namespace-helm":        namespaceHelmQueryCapabilities(),
	"namespace-events":      namespaceEventsQueryCapabilities(),
	"namespace-workloads":   namespaceWorkloadsQueryCapabilities(),
	"nodes":                 nodeQueryCapabilities(),
	"pods":                  podQueryCapabilities(),
}

// typedDomainSource describes one typed-resource domain discovered from the
// package source rather than a hardcoded list.
type typedDomainSource struct {
	file           string
	capabilityFunc string
	// embedsEnvelope: some struct in this file embeds ResourceQueryEnvelope and
	// carries a Rows slice (the normalized payload shape).
	embedsEnvelope bool
	// usesEnvelopeHelper: the builder constructs its envelope through the canonical
	// helper (typedQueryEnvelope / typedWindowEnvelope) instead of hand-rolling it.
	usesEnvelopeHelper bool
}

// discoverTypedResourceDomains scans the package source (not a hardcoded list)
// for typed-resource domains. A typed-resource domain is identified by its
// capability function: a top-level `func xxxQueryCapabilities() ResourceQueryCapabilities`
// whose body calls newTypedResourceCapabilities.
//
// This mirrors the frontend's source-scan enforcement
// (gridTableViewRegistry.contract.test.ts): the domain set is derived from the
// code, so a newly added typed domain is covered automatically instead of
// needing to be appended to a list a developer can forget.
func discoverTypedResourceDomains(t *testing.T) []typedDomainSource {
	t.Helper()
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatalf("read package dir: %v", err)
	}
	fset := token.NewFileSet()

	var domains []typedDomainSource
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		file, err := parser.ParseFile(fset, name, nil, 0)
		if err != nil {
			t.Fatalf("parse %s: %v", name, err)
		}

		var capabilityFuncs []string
		embeds := false
		usesHelper := false

		ast.Inspect(file, func(n ast.Node) bool {
			switch node := n.(type) {
			case *ast.FuncDecl:
				if node.Recv == nil &&
					strings.HasSuffix(node.Name.Name, "QueryCapabilities") &&
					funcReturnsType(node, "ResourceQueryCapabilities") &&
					bodyCallsFunc(node.Body, "newTypedResourceCapabilities") {
					capabilityFuncs = append(capabilityFuncs, node.Name.Name)
				}
				// The engine-backed resolveTypedSnapshotPageViaStore wraps both
				// canonical envelope constructors, so it satisfies the same guarantee.
				if bodyCallsFunc(node.Body, "typedQueryEnvelope") ||
					bodyCallsFunc(node.Body, "typedWindowEnvelope") ||
					bodyCallsFunc(node.Body, "resolveTypedSnapshotPageViaStore") ||
					bodyCallsFunc(node.Body, "resolveMaintainedDirect") {
					usesHelper = true
				}
			case *ast.TypeSpec:
				if st, ok := node.Type.(*ast.StructType); ok {
					if structEmbeds(st, "ResourceQueryEnvelope") && structHasField(st, "Rows") {
						embeds = true
					}
				}
			}
			return true
		})

		for _, capabilityFunc := range capabilityFuncs {
			domains = append(domains, typedDomainSource{
				file:               name,
				capabilityFunc:     capabilityFunc,
				embedsEnvelope:     embeds,
				usesEnvelopeHelper: usesHelper,
			})
		}
	}
	return domains
}

func funcReturnsType(fn *ast.FuncDecl, typeName string) bool {
	if fn.Type.Results == nil || len(fn.Type.Results.List) != 1 {
		return false
	}
	ident, ok := fn.Type.Results.List[0].Type.(*ast.Ident)
	return ok && ident.Name == typeName
}

func bodyCallsFunc(body *ast.BlockStmt, funcName string) bool {
	if body == nil {
		return false
	}
	found := false
	ast.Inspect(body, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		switch fn := call.Fun.(type) {
		case *ast.Ident: // typedWindowEnvelope(...), newTypedResourceCapabilities(...)
			if fn.Name == funcName {
				found = true
			}
		case *ast.SelectorExpr: // typedQueryEnvelope(...).withDegraded(...)
			if fn.Sel.Name == funcName {
				found = true
			}
		}
		return true
	})
	return found
}

func structEmbeds(st *ast.StructType, typeName string) bool {
	for _, field := range st.Fields.List {
		if len(field.Names) != 0 { // named field, not an embed
			continue
		}
		if ident, ok := field.Type.(*ast.Ident); ok && ident.Name == typeName {
			return true
		}
	}
	return false
}

func structHasField(st *ast.StructType, fieldName string) bool {
	for _, field := range st.Fields.List {
		for _, name := range field.Names {
			if name.Name == fieldName {
				return true
			}
		}
	}
	return false
}

// TestEveryTypedResourceDomainEmbedsTheNormalizedEnvelope replaces the old
// hardcoded 16-struct reflection test with source discovery. For every
// typed-resource domain found in the package, it proves both halves of the
// "non-normalized backend shape is rejected" contract (plan Phase 6):
//   - the domain's payload embeds ResourceQueryEnvelope with a Rows slice, and
//   - the builder constructs that envelope via the canonical helper, so it cannot
//     ship an incompletely-wired (missing provider/capabilities/completeness)
//     envelope by hand.
//
// A new typed domain that omits the embed or hand-rolls the envelope fails here
// without anyone remembering to extend a list.
func TestEveryTypedResourceDomainEmbedsTheNormalizedEnvelope(t *testing.T) {
	domains := discoverTypedResourceDomains(t)
	if len(domains) == 0 {
		t.Fatal("discovered no typed-resource domains; the AST scan is broken")
	}
	for _, d := range domains {
		if !d.embedsEnvelope {
			t.Errorf("%s (%s): no struct embeds ResourceQueryEnvelope with a Rows slice; a typed-resource payload must embed the normalized envelope", d.file, d.capabilityFunc)
		}
		if !d.usesEnvelopeHelper {
			t.Errorf("%s (%s): builder must construct the envelope via typedQueryEnvelope/typedWindowEnvelope; hand-rolling risks an incompletely-wired envelope", d.file, d.capabilityFunc)
		}
	}
}

// TestTypedResourceCapabilityConformanceCoversEveryDomain keeps the capability
// conformance map (which must call each helper by name and so cannot be derived)
// honest against source discovery: if a typed domain is added without being
// listed in typedCapabilityConformance, the counts diverge and this fails,
// pointing the developer at the missing entry.
func TestTypedResourceCapabilityConformanceCoversEveryDomain(t *testing.T) {
	discovered := discoverTypedResourceDomains(t)
	if len(typedCapabilityConformance) != len(discovered) {
		names := make([]string, 0, len(discovered))
		for _, d := range discovered {
			names = append(names, d.capabilityFunc)
		}
		t.Fatalf("typed capability conformance covers %d domains but source discovery found %d (%s); add the new domain to typedCapabilityConformance",
			len(typedCapabilityConformance), len(discovered), strings.Join(names, ", "))
	}
}
