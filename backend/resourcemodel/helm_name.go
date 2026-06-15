package resourcemodel

import "strings"

// HelmReleaseNamePrefix is the prefix Helm uses on its release storage objects
// (Secrets/ConfigMaps named "sh.helm.release.v1.<release>.v<revision>").
const HelmReleaseNamePrefix = "sh.helm.release.v1."

// HelmReleaseName extracts the Helm release name from a Helm storage object
// name. Names without the Helm prefix are returned unchanged. Single source of
// truth shared by cache invalidation and the resource stream.
func HelmReleaseName(name string) string {
	if !strings.HasPrefix(name, HelmReleaseNamePrefix) {
		return name
	}
	trimmed := strings.TrimPrefix(name, HelmReleaseNamePrefix)
	index := strings.LastIndex(trimmed, ".v")
	if index <= 0 {
		return trimmed
	}
	return trimmed[:index]
}
