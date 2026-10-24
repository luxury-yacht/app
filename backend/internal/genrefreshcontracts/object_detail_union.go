package genrefreshcontracts

import (
	"bytes"
	"fmt"
	"path"
	"reflect"
	"sort"
	"strings"

	"github.com/luxury-yacht/app/backend/internal/genappbindings"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
)

// The object-details payload embeds snapshot.ObjectDetail: a detail DTO tagged
// with its detail type. It renders as a TypeScript union of {tag, details}
// variants, one per detail type, so consumers narrow on the tag instead of
// casting the details.
var objectDetailCarrier = typeOf[snapshot.ObjectDetail]()

const (
	objectDetailUnionName = "ObjectDetail"
	objectDetailModels    = "@core/backend-api/models"
)

type objectDetailVariant struct {
	tag        string
	typeScript string
	// modelNamespace is the Wails models namespace declaring the DTO; empty
	// when this file renders the DTO itself.
	modelNamespace string
}

// objectDetailVariants are the detail types the payload can carry: every
// fetched detail type, then the builder's generic fallback.
func objectDetailVariants() []genappbindings.DetailType {
	generic := typeOf[snapshot.GenericObjectDetails]()
	return append(genappbindings.DetailTypes(), genappbindings.DetailType{
		Tag:       snapshot.GenericObjectDetailType,
		DTOImport: generic.PkgPath(),
		DTOName:   generic.Name(),
	})
}

// resolveObjectDetailVariants maps each variant's DTO to its TypeScript type:
// the name this file renders it under, else its Wails models namespace type.
func (r *renderer) resolveObjectDetailVariants() []objectDetailVariant {
	rendered := make(map[string]string, len(r.names))
	for typeOf, name := range r.names {
		rendered[typeOf.PkgPath()+"."+typeOf.Name()] = name
	}
	variants := objectDetailVariants()
	resolved := make([]objectDetailVariant, 0, len(variants))
	for _, variant := range variants {
		if name, ok := rendered[variant.DTOImport+"."+variant.DTOName]; ok {
			resolved = append(resolved, objectDetailVariant{tag: variant.Tag, typeScript: name})
			continue
		}
		namespace := path.Base(variant.DTOImport)
		resolved = append(resolved, objectDetailVariant{
			tag:            variant.Tag,
			typeScript:     namespace + "." + variant.DTOName,
			modelNamespace: namespace,
		})
	}
	return resolved
}

// objectDetailCarrierFields returns the JSON names of the carrier's string tag
// field and its interface details field.
func objectDetailCarrierFields() (tagField, detailsField string, err error) {
	for index := 0; index < objectDetailCarrier.NumField(); index++ {
		field := objectDetailCarrier.Field(index)
		name, _, _ := jsonField(field)
		switch field.Type.Kind() {
		case reflect.String:
			tagField = name
		case reflect.Interface:
			detailsField = name
		}
	}
	if objectDetailCarrier.NumField() != 2 || tagField == "" || detailsField == "" {
		return "", "", fmt.Errorf("%s must hold one string tag field and one interface details field", objectDetailCarrier)
	}
	return tagField, detailsField, nil
}

func renderObjectDetailImports(out *bytes.Buffer, variants []objectDetailVariant) {
	seen := map[string]struct{}{}
	namespaces := make([]string, 0, len(variants))
	for _, variant := range variants {
		if _, ok := seen[variant.modelNamespace]; ok || variant.modelNamespace == "" {
			continue
		}
		seen[variant.modelNamespace] = struct{}{}
		namespaces = append(namespaces, variant.modelNamespace)
	}
	sort.Strings(namespaces)
	fmt.Fprintf(out, "import type {\n  %s,\n} from '%s';\n\n", strings.Join(namespaces, ",\n  "), objectDetailModels)
}

func renderObjectDetailUnion(out *bytes.Buffer, variants []objectDetailVariant, tagField, detailsField string) {
	out.WriteString("export interface ObjectDetailTypes {\n")
	for _, variant := range variants {
		fmt.Fprintf(out, "  %s: %s;\n", quoteProperty(variant.tag), variant.typeScript)
	}
	out.WriteString("}\n\n")
	out.WriteString("export type ObjectDetailType = keyof ObjectDetailTypes;\n\n")
	fmt.Fprintf(out, "export type %s<K extends ObjectDetailType = ObjectDetailType> = {\n", objectDetailUnionName)
	fmt.Fprintf(out, "  [P in K]: { %s: P; %s: ObjectDetailTypes[P] };\n}[K];\n\n", tagField, detailsField)
}

// embedsObjectDetail reports whether a payload struct embeds the carrier, so it
// renders as an intersection with the union rather than as an interface.
func embedsObjectDetail(typeOf reflect.Type) bool {
	for index := 0; index < typeOf.NumField(); index++ {
		field := typeOf.Field(index)
		if field.Anonymous && indirect(field.Type) == objectDetailCarrier {
			return true
		}
	}
	return false
}
