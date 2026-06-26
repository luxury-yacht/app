package snapshot

import "strings"

func metricSourceVersions(revision string) map[string]string {
	revision = strings.TrimSpace(revision)
	if revision == "" {
		return nil
	}
	return map[string]string{"metric": revision}
}
