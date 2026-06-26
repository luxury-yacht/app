package resourcestream

import (
	"go/ast"
	"go/parser"
	"go/token"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestStreamHandlersPassProjectorDerivedRowArg enforces that every call to the
// newObjectRowUpdate helper passes a projector-derived row argument (nil, a local
// identifier, or a snapshot.Build*Summary call) — never a hand-assembled row
// literal.
//
// The Update/ServerMessage envelope no longer has a Row field, so shipping a
// projected row over the wire is impossible by construction; what remains worth
// guarding is that the projection some callers still build (e.g. pods, for
// load-bearing broadcast scope) comes from the canonical projector rather than a
// divergent hand-built value.
func TestStreamHandlersPassProjectorDerivedRowArg(t *testing.T) {
	_, filename, _, ok := runtime.Caller(0)
	require.True(t, ok)
	dir := filepath.Dir(filename)

	files, err := filepath.Glob(filepath.Join(dir, "*.go"))
	require.NoError(t, err)
	for _, path := range files {
		if strings.HasSuffix(filepath.Base(path), "_test.go") {
			continue
		}

		fset := token.NewFileSet()
		file, err := parser.ParseFile(fset, path, nil, 0)
		require.NoError(t, err)
		ast.Inspect(file, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok || !callIsObjectRowUpdate(call) {
				return true
			}
			if len(call.Args) == 0 {
				return true
			}
			row := call.Args[len(call.Args)-1]
			if !rowArgIsApproved(row) {
				require.Failf(
					t,
					"row arg must come from snapshot.Build* projector",
					"%s passes a non-projector value as the row argument to newObjectRowUpdate; "+
						"row construction must go through snapshot.Build*Summary or a nil/identifier value derived from one",
					fset.Position(row.Pos()),
				)
			}
			return true
		})
	}
}

// callIsObjectRowUpdate reports whether the call expression invokes the
// newObjectRowUpdate helper that wraps a projected row in an Update.
// Direct calls and method calls on `m`/`mgr` style receivers all qualify.
func callIsObjectRowUpdate(call *ast.CallExpr) bool {
	switch fn := call.Fun.(type) {
	case *ast.Ident:
		return fn.Name == "newObjectRowUpdate"
	case *ast.SelectorExpr:
		return fn.Sel.Name == "newObjectRowUpdate"
	}
	return false
}

// rowArgIsApproved enforces that the row argument to newObjectRowUpdate
// is one of:
//   - nil (a row-less delete or transport message)
//   - a simple identifier (a local variable assigned earlier in the function;
//     parity tests cover the contents end-to-end)
//   - a direct CallExpr to snapshot.Build*Summary or to a local helper whose
//     name starts with "build" (defensive — wraps a projector call)
//
// It rejects composite literals like `PodSummary{...}` or `snapshot.PodSummary{...}`,
// which would let a handler hand-assemble a row payload outside the projector.
func rowArgIsApproved(arg ast.Expr) bool {
	switch v := arg.(type) {
	case *ast.Ident:
		// `nil` literal or a local variable — accepted; identifier provenance
		// is covered by parity tests on the projector return value.
		return true
	case *ast.CallExpr:
		// Direct projector call (snapshot.Build*Summary) or local helper call.
		switch fn := v.Fun.(type) {
		case *ast.SelectorExpr:
			return strings.HasPrefix(fn.Sel.Name, "Build") || strings.HasPrefix(fn.Sel.Name, "build")
		case *ast.Ident:
			return strings.HasPrefix(fn.Name, "Build") || strings.HasPrefix(fn.Name, "build")
		}
		return false
	case *ast.SelectorExpr:
		// Field access on a struct value — e.g. `summary.Row`. Allowed but
		// uncommon.
		return true
	}
	return false
}
