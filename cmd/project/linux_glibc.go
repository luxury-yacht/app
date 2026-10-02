package main

import (
	"debug/elf"
	"fmt"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
)

// Ubuntu 24.04 is the oldest supported Linux distribution because it is the
// oldest that ships WebKitGTK 6.0, so Linux release binaries must load with its
// glibc. The requirement comes from the build host's glibc, not from our code.
const linuxGlibcFloor = "2.39"

func runLinuxGlibcValidation() error {
	metadata, err := readProjectMetadata(projectConfigPath)
	if err != nil {
		return fmt.Errorf("read Linux binary metadata: %w", err)
	}
	binaryName, err := projectBinaryName(metadata)
	if err != nil {
		return err
	}
	return validateLinuxGlibcFloor(filepath.Join("bin", binaryName), linuxGlibcFloor)
}

// validateLinuxGlibcFloor fails when the dynamic loader on a system with the
// floor glibc would refuse the binary because it needs a newer symbol version.
func validateLinuxGlibcFloor(path, floor string) error {
	file, err := elf.Open(path)
	if err != nil {
		return fmt.Errorf("open Linux binary %s: %w", path, err)
	}
	defer file.Close()
	libraries, err := file.DynamicVersionNeeds()
	if err != nil {
		return fmt.Errorf("read glibc requirements of %s: %w", path, err)
	}
	var tooNew []string
	for _, library := range libraries {
		for _, need := range library.Needs {
			if glibcVersionNewer(need.Dep, floor) {
				tooNew = append(tooNew, need.Dep)
			}
		}
	}
	if len(tooNew) == 0 {
		return nil
	}
	return fmt.Errorf(
		"%s requires %s, newer than the glibc %s floor (symbols: %s); build Linux releases on Ubuntu 24.04",
		path, strings.Join(tooNew, ", "), floor, strings.Join(symbolsWithVersions(file, tooNew), ", "),
	)
}

// glibcVersionNewer compares release numbers, so GLIBC_2.4 is older than 2.39.
// Markers without a release number, such as GLIBC_PRIVATE, never raise the floor.
func glibcVersionNewer(dependency, floor string) bool {
	version, ok := strings.CutPrefix(dependency, "GLIBC_")
	if !ok {
		return false
	}
	required, ok := releaseNumbers(version)
	if !ok {
		return false
	}
	limit, _ := releaseNumbers(floor)
	return slices.Compare(required, limit) > 0
}

func releaseNumbers(version string) ([]int, bool) {
	parts := strings.Split(version, ".")
	numbers := make([]int, len(parts))
	for index, part := range parts {
		number, err := strconv.Atoi(part)
		if err != nil {
			return nil, false
		}
		numbers[index] = number
	}
	return numbers, true
}

// symbolsWithVersions names the imports that need the given versions so a
// failure points at what raised the floor.
func symbolsWithVersions(file *elf.File, versions []string) []string {
	symbols, err := file.DynamicSymbols()
	if err != nil {
		return nil
	}
	var names []string
	for _, symbol := range symbols {
		if slices.Contains(versions, symbol.Version) {
			names = append(names, symbol.Name)
		}
	}
	slices.Sort(names)
	return slices.Compact(names)
}
