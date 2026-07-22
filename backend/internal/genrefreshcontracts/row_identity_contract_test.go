package genrefreshcontracts

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/resourcemodel"
)

func TestCanonicalObjectRowWireFixtureCoversInventory(t *testing.T) {
	fixturePath := filepath.Join("..", "..", "..", "frontend", "src", "test-fixtures", "canonical-resource-row-wire.json")
	data, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("read canonical row wire fixture: %v", err)
	}
	var fixture struct {
		Entries []struct {
			Family string `json:"family"`
		} `json:"entries"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatalf("decode canonical row wire fixture: %v", err)
	}

	specs := canonicalObjectRowSpecs()
	if len(fixture.Entries) != len(specs) {
		t.Fatalf("wire fixture has %d families, want %d", len(fixture.Entries), len(specs))
	}
	for index, spec := range specs {
		if got := fixture.Entries[index].Family; got != spec.name {
			t.Errorf("wire fixture family %d = %q, want %q", index, got, spec.name)
		}
	}
}

func TestCanonicalObjectRowsCarryOnlyRefIdentity(t *testing.T) {
	identityJSONFields := map[string]struct{}{
		"clusterId":   {},
		"clusterName": {},
		"group":       {},
		"version":     {},
		"kind":        {},
		"resource":    {},
		"namespace":   {},
		"name":        {},
		"uid":         {},
	}
	clusterMetaType := typeOf[streamrows.ClusterMeta]()
	resourceRefType := typeOf[resourcemodel.ResourceRef]()

	seenTypes := make(map[reflect.Type]string)
	for _, spec := range canonicalObjectRowSpecs() {
		t.Run(spec.name, func(t *testing.T) {
			rowType := indirect(spec.typeOf)
			if rowType.Kind() != reflect.Struct {
				t.Fatalf("canonical row type %s is %s, want struct", rowType, rowType.Kind())
			}
			if previous, exists := seenTypes[rowType]; exists {
				t.Fatalf("canonical row type %s is listed by both %s and %s", rowType, previous, spec.name)
			}
			seenTypes[rowType] = spec.name

			refCount := 0
			for index := 0; index < rowType.NumField(); index++ {
				field := rowType.Field(index)
				if field.Anonymous && indirect(field.Type) == clusterMetaType {
					t.Errorf("%s embeds row-level ClusterMeta", rowType)
				}

				jsonName := strings.Split(field.Tag.Get("json"), ",")[0]
				if jsonName == "ref" && indirect(field.Type) == resourceRefType {
					refCount++
					continue
				}
				if _, identityField := identityJSONFields[jsonName]; !identityField {
					continue
				}
				if reason := spec.semanticJSONFields[jsonName]; reason != "" {
					continue
				}
				t.Errorf("%s serializes duplicate own-identity field %q alongside ref", rowType, jsonName)
			}

			if refCount != 1 {
				t.Errorf("%s has %d direct canonical ref fields, want exactly 1", rowType, refCount)
			}
		})
	}
}
