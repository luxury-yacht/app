package backend

import "testing"

func TestCompareVersions(t *testing.T) {
	t.Run("detects older current version", func(t *testing.T) {
		result, err := compareVersions("1.2.3", "1.3.0")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if result >= 0 {
			t.Fatalf("expected current version to be older, got %d", result)
		}
	})

	t.Run("treats v-prefixed tags as equal", func(t *testing.T) {
		result, err := compareVersions("1.2.3", "v1.2.3")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if result != 0 {
			t.Fatalf("expected versions to be equal, got %d", result)
		}
	})
}

func TestParseVersionParts(t *testing.T) {
	parts, err := parseVersionParts("1.2.3-beta+build.7")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(parts) < 3 || parts[0] != 1 || parts[1] != 2 || parts[2] != 3 {
		t.Fatalf("unexpected parts: %#v", parts)
	}

	_, err = parseVersionParts("dev")
	if err == nil {
		t.Fatalf("expected parse error for dev version")
	}
}

func TestIsDevVersion(t *testing.T) {
	cases := map[string]bool{
		"dev":        true,
		"1.0.0":      false,
		"1.0.0 (dev)": true,
		"":           true,
	}

	for value, expected := range cases {
		if got := isDevVersion(value); got != expected {
			t.Fatalf("isDevVersion(%q) = %v, want %v", value, got, expected)
		}
	}
}
