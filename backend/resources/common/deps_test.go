/*
 * backend/resources/common/deps_test.go
 *
 * Tests for Shared dependency bundle for resource services.
 * - Covers Shared dependency bundle for resource services behavior and edge cases.
 */

package common

import (
	"context"
	"testing"
)

type testContextKey string

func TestCloneWithContext(t *testing.T) {
	original := Dependencies{Context: context.Background()}
	newCtx := context.WithValue(context.Background(), testContextKey("k"), "v")

	clone := original.CloneWithContext(newCtx)
	if clone.Context != newCtx {
		t.Fatalf("expected context to be replaced")
	}
	if original.Context == newCtx {
		t.Fatalf("expected original context to remain unchanged")
	}
}
