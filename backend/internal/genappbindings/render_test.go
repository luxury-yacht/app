package genappbindings

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
)

// The object panel narrows each object-details payload on its detail type. The
// generated fetcher names the DTO it tags, so a service that returns another
// type fails to compile instead of reaching the panel under the wrong
// TypeScript type.
func TestRenderDetailFetchersTagEveryDetailWithItsDTO(t *testing.T) {
	source, err := RenderDetailFetchers()
	require.NoError(t, err)

	for _, detailType := range DetailTypes() {
		if detailType.Tag == CustomResourceDetailType {
			continue
		}
		require.Contains(t, string(source), fmt.Sprintf("tagObjectDetail[*%s](%q, detail, err)", detailType.GoType(), detailType.Tag))
	}
	require.Contains(t, string(source), fmt.Sprintf("const customResourceDetailType = %q", CustomResourceDetailType))
}

// Each tag names one DTO. Discovered custom resources have their own tag, so
// they never borrow a built-in kind's TypeScript type.
func TestDetailTypesNameOneDTOPerTag(t *testing.T) {
	seen := map[string]bool{}
	for _, detailType := range DetailTypes() {
		require.False(t, seen[detailType.Tag], "duplicate detail type %q", detailType.Tag)
		seen[detailType.Tag] = true
		require.NotEmpty(t, detailType.DTOName, detailType.Tag)
		require.NotEmpty(t, detailType.DTOImport, detailType.Tag)
	}
	require.Len(t, seen, len(Bindings)+len(detailExtras)+1)
	require.True(t, seen[CustomResourceDetailType])
}
