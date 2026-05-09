package backend

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMatchThemeClusterPattern(t *testing.T) {
	tests := []struct {
		name        string
		pattern     string
		contextName string
		want        bool
	}{
		{
			name:        "empty pattern matches any context",
			pattern:     "",
			contextName: "arn:aws:eks:us-east-1:123456789012:cluster/prod",
			want:        true,
		},
		{
			name:        "star crosses slash boundaries",
			pattern:     "*prod*",
			contextName: "arn:aws:eks:us-east-1:123456789012:cluster/prod",
			want:        true,
		},
		{
			name:        "question mark matches one slash",
			pattern:     "team?prod",
			contextName: "team/prod",
			want:        true,
		},
		{
			name:        "question mark matches exactly one rune",
			pattern:     "stg-?",
			contextName: "stg-12",
			want:        false,
		},
		{
			name:        "character class matches",
			pattern:     "prod-[a-c]",
			contextName: "prod-b",
			want:        true,
		},
		{
			name:        "character class non-match",
			pattern:     "prod-[a-c]",
			contextName: "prod-z",
			want:        false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := matchThemeClusterPattern(tt.pattern, tt.contextName)
			require.NoError(t, err)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestMatchThemeClusterPatternInvalidPattern(t *testing.T) {
	_, err := matchThemeClusterPattern("prod-[", "prod-a")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "missing closing bracket")
}
