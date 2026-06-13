/*
 * backend/resources/common/copy_test.go
 *
 * Tests for shared copy helpers.
 * - Covers nil/empty handling and copy independence.
 */

package common

import "testing"

func TestCopyStringMapReturnsNilForEmptyInput(t *testing.T) {
	if got := CopyStringMap(nil); got != nil {
		t.Fatalf("expected nil for nil input, got %v", got)
	}
	if got := CopyStringMap(map[string]string{}); got != nil {
		t.Fatalf("expected nil for empty input, got %v", got)
	}
}

func TestCopyStringMapCopiesEntriesIndependently(t *testing.T) {
	src := map[string]string{"a": "1", "b": "2"}

	got := CopyStringMap(src)

	if len(got) != 2 || got["a"] != "1" || got["b"] != "2" {
		t.Fatalf("unexpected copy: %v", got)
	}

	src["a"] = "changed"
	if got["a"] != "1" {
		t.Fatalf("copy aliases source map")
	}
}
