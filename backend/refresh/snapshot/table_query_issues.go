package snapshot

import (
	"context"
	"fmt"
	"strings"
)

type typedTableResourceSource struct {
	Kind       string
	Group      string
	Resource   string
	Available  bool
	QueryKinds []string
}

func typedTableQueryResourceIssues(ctx context.Context, domainName string, query typedTableQuery, sources []typedTableResourceSource) []ResourceQueryIssue {
	if !query.Enabled {
		return nil
	}
	issues := make([]ResourceQueryIssue, 0)
	for _, source := range sources {
		if !typedTableQueryNeedsSource(query, source) {
			continue
		}
		if source.Available && runtimeResourceAllowed(ctx, domainName, source.Group, source.Resource) {
			continue
		}
		issues = append(issues, ResourceQueryIssue{
			Kind:    source.Kind,
			Message: fmt.Sprintf("%s resources are unavailable; table data is partial", source.Kind),
		})
	}
	return issues
}

func typedTableQueryNeedsSource(query typedTableQuery, source typedTableResourceSource) bool {
	kinds := source.QueryKinds
	if len(kinds) == 0 {
		kinds = []string{source.Kind}
	}
	if len(query.Request.Kinds) == 0 {
		return true
	}
	requested := make(map[string]struct{}, len(query.Request.Kinds))
	for _, kind := range query.Request.Kinds {
		normalized := normalizeTypedTableKind(kind)
		if normalized != "" {
			requested[normalized] = struct{}{}
		}
	}
	for _, kind := range kinds {
		if _, ok := requested[normalizeTypedTableKind(kind)]; ok {
			return true
		}
	}
	return false
}

func normalizeTypedTableKind(kind string) string {
	return strings.ToLower(strings.TrimSpace(kind))
}
