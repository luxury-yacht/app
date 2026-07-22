package genrefreshcontracts

import (
	"reflect"
	"strings"
	"testing"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/resourcemodel"
)

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
