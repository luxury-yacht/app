package backend

import (
	"fmt"
	"strings"
)

// kubeconfigSelection captures a parsed kubeconfig path/context selection.
type kubeconfigSelection struct {
	Path    string
	Context string
	Raw     string
}

// splitSelectionParts separates a selection into path/context, preserving Windows drive letters.
func splitSelectionParts(selection string) (string, string) {
	trimmed := strings.TrimSpace(selection)
	if trimmed == "" {
		return "", ""
	}

	delimiter := selectionDelimiterIndex(trimmed)
	if delimiter == -1 {
		return trimmed, ""
	}

	return trimmed[:delimiter], trimmed[delimiter+1:]
}

// selectionDelimiterIndex finds the path/context delimiter while skipping Windows drive prefixes.
func selectionDelimiterIndex(value string) int {
	if value == "" {
		return -1
	}
	start := 0
	if len(value) >= 2 && isAlpha(value[0]) && value[1] == ':' {
		if len(value) == 2 || (len(value) > 2 && value[2] != ':') {
			start = 2
		}
	}
	idx := strings.Index(value[start:], ":")
	if idx == -1 {
		return -1
	}
	return start + idx
}

func isAlpha(b byte) bool {
	return (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z')
}

// String renders the selection in "path:context" form when a context is present.
func (s kubeconfigSelection) String() string {
	if s.Context == "" {
		return s.Path
	}
	return fmt.Sprintf("%s:%s", s.Path, s.Context)
}

// parseKubeconfigSelection splits "path:context" into its components.
func parseKubeconfigSelection(selection string) (kubeconfigSelection, error) {
	trimmed := strings.TrimSpace(selection)
	if trimmed == "" {
		return kubeconfigSelection{}, fmt.Errorf("kubeconfig selection is empty")
	}

	path, ctx := splitSelectionParts(trimmed)
	parsed := kubeconfigSelection{Path: path, Context: ctx, Raw: selection}
	if strings.TrimSpace(parsed.Path) == "" {
		return kubeconfigSelection{}, fmt.Errorf("kubeconfig selection missing path")
	}
	return parsed, nil
}
