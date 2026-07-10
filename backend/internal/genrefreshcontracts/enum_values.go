package genrefreshcontracts

import (
	"fmt"
	"go/constant"
	"go/types"
	"sort"

	"golang.org/x/tools/go/packages"
)

type enumValue struct {
	value  string
	offset int
}

func resolveEnumSpecs(specs []enumSpec) ([]enumSpec, error) {
	packagePaths := make([]string, 0)
	seenPaths := make(map[string]struct{})
	for _, spec := range specs {
		path := spec.typeOf.PkgPath()
		if _, ok := seenPaths[path]; ok {
			continue
		}
		seenPaths[path] = struct{}{}
		packagePaths = append(packagePaths, path)
	}
	sort.Strings(packagePaths)

	loaded, err := packages.Load(&packages.Config{
		Mode: packages.NeedName | packages.NeedTypes | packages.NeedTypesInfo | packages.NeedSyntax,
	}, packagePaths...)
	if err != nil {
		return nil, fmt.Errorf("load enum packages: %w", err)
	}
	if packages.PrintErrors(loaded) > 0 {
		return nil, fmt.Errorf("load enum packages: package errors")
	}
	packagesByPath := make(map[string]*packages.Package, len(loaded))
	for _, loadedPackage := range loaded {
		packagesByPath[loadedPackage.PkgPath] = loadedPackage
	}

	resolved := make([]enumSpec, len(specs))
	for index, spec := range specs {
		loadedPackage := packagesByPath[spec.typeOf.PkgPath()]
		if loadedPackage == nil {
			return nil, fmt.Errorf("enum %s: package %s was not loaded", spec.name, spec.typeOf.PkgPath())
		}
		values := make([]enumValue, 0)
		for _, object := range loadedPackage.TypesInfo.Defs {
			constantObject, ok := object.(*types.Const)
			if !ok {
				continue
			}
			named, ok := constantObject.Type().(*types.Named)
			if !ok || named.Obj().Pkg() == nil || named.Obj().Pkg().Path() != spec.typeOf.PkgPath() || named.Obj().Name() != spec.typeOf.Name() {
				continue
			}
			if constantObject.Val().Kind() != constant.String {
				return nil, fmt.Errorf("enum %s constant %s is not a string", spec.name, constantObject.Name())
			}
			values = append(values, enumValue{
				value:  constant.StringVal(constantObject.Val()),
				offset: loadedPackage.Fset.Position(constantObject.Pos()).Offset,
			})
		}
		sort.Slice(values, func(i, j int) bool { return values[i].offset < values[j].offset })
		if len(values) == 0 {
			return nil, fmt.Errorf("enum %s has no typed constants", spec.name)
		}

		resolved[index] = spec
		resolved[index].values = make([]string, 0, len(values))
		for _, value := range values {
			resolved[index].values = append(resolved[index].values, value.value)
		}
	}
	return resolved, nil
}
