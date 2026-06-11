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

// typedTableQueryResourceIssues reports the sources that are unavailable or
// permission-blocked for the current query. It is computed for both the
// backend-query path and the local-window path: a blocked source silently
// reduces the rows in either mode, so both must surface it rather than present a
// partial table as complete.
func typedTableQueryResourceIssues(ctx context.Context, domainName string, query typedTableQuery, sources []typedTableResourceSource) []ResourceQueryIssue {
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

// capabilitiesWithAvailableKinds narrows the published kind vocabulary to the
// kinds that can currently produce rows, using the same source list the issues
// channel reports on: a source that is unavailable (the cluster does not serve
// the resource, or this user cannot list it) drops its kind from the Kinds
// dropdown options. Vocabulary kinds without a source entry are unconditional
// for the family and stay. The static capability helpers keep publishing the
// FULL family vocabulary (pinned by conformance); this narrowing applies where
// result envelopes are built, with the builder's live source state in hand.
func capabilitiesWithAvailableKinds(capabilities ResourceQueryCapabilities, sources []typedTableResourceSource) ResourceQueryCapabilities {
	if len(capabilities.KindVocabulary) == 0 || len(sources) == 0 {
		return capabilities
	}
	unavailable := make(map[string]bool, len(sources))
	for _, source := range sources {
		if !source.Available {
			unavailable[normalizeTypedTableKind(source.Kind)] = true
		}
	}
	if len(unavailable) == 0 {
		return capabilities
	}
	kinds := make([]string, 0, len(capabilities.KindVocabulary))
	for _, kind := range capabilities.KindVocabulary {
		if !unavailable[normalizeTypedTableKind(kind)] {
			kinds = append(kinds, kind)
		}
	}
	capabilities.KindVocabulary = kinds
	return capabilities
}
