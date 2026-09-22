package snapshot

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"strings"
)

func metricSourceVersions(revision string) map[string]string {
	revision = strings.TrimSpace(revision)
	if revision == "" {
		return nil
	}
	return map[string]string{"metric": revision}
}

func maxSnapshotVersion(current uint64, object metav1.Object) uint64 {
	if version := resourceVersionOrTimestamp(object); version > current {
		return version
	}
	return current
}
