package backend

import (
	"os"
	"strings"
	"testing"

	"github.com/luxury-yacht/app/backend/internal/genappbindings"
	"github.com/luxury-yacht/app/backend/resourcecontract"
)

func TestGeneratedGoBindingsUseLFLineEndings(t *testing.T) {
	gitAttributes, err := os.ReadFile("../.gitattributes")
	if err != nil {
		t.Fatalf("read .gitattributes: %v", err)
	}
	if !strings.Contains(string(gitAttributes), "* text=auto eol=lf") {
		t.Fatal("generated Go bindings require LF line endings for byte-exact drift tests")
	}
}

// TestAppBindingsGeneratedInSync fails if resource_details_generated.go drifts from what
// the generator produces — i.e. it was hand-edited, or the binding table changed
// without running `go generate ./backend`.
func TestAppBindingsGeneratedInSync(t *testing.T) {
	want, err := genappbindings.Render()
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	got, err := os.ReadFile("resource_details_generated.go")
	if err != nil {
		t.Fatalf("read generated file: %v", err)
	}
	if string(got) != string(want) {
		t.Fatal("resource_details_generated.go is stale; run `go generate ./backend`")
	}
}

// TestObjectDetailFetchersGeneratedInSync fails if object_detail_fetchers_generated.go
// drifts from what the generator produces — i.e. it was hand-edited, or the binding
// table / detailExtras changed without running `go generate ./backend`.
func TestObjectDetailFetchersGeneratedInSync(t *testing.T) {
	want, err := genappbindings.RenderDetailFetchers()
	if err != nil {
		t.Fatalf("render detail fetchers: %v", err)
	}
	got, err := os.ReadFile("object_detail_fetchers_generated.go")
	if err != nil {
		t.Fatalf("read generated file: %v", err)
	}
	if string(got) != string(want) {
		t.Fatal("object_detail_fetchers_generated.go is stale; run `go generate ./backend`")
	}
}

// TestAppBindingsMatchContract ties the binding table to the identity source of
// truth: every generated binding must name a real kind in BuiltinResources, with
// a Namespaced flag that agrees. This catches a binding added with the wrong
// scope or for a kind the contract doesn't know.
func TestAppBindingsMatchContract(t *testing.T) {
	namespacedByKind := map[string]bool{}
	for _, r := range resourcecontract.BuiltinResources {
		namespacedByKind[r.Kind] = r.Namespaced
	}
	for _, b := range genappbindings.Bindings {
		ns, ok := namespacedByKind[b.Name]
		if !ok {
			t.Errorf("binding %q has no matching kind in resourcecontract.BuiltinResources", b.Name)
			continue
		}
		if ns != b.Namespaced {
			t.Errorf("binding %q: Namespaced=%v but contract says %v", b.Name, b.Namespaced, ns)
		}
	}
}
