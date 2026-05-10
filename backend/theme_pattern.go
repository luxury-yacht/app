package backend

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

type themeClusterPatternErrorKind string

const (
	themeClusterPatternMissingClosingBracket themeClusterPatternErrorKind = "missing-closing-bracket"
	themeClusterPatternTrailingEscape        themeClusterPatternErrorKind = "trailing-escape"
)

type themeClusterPatternError struct {
	pattern string
	kind    themeClusterPatternErrorKind
}

func (e *themeClusterPatternError) Error() string {
	switch e.kind {
	case themeClusterPatternMissingClosingBracket:
		return fmt.Sprintf("invalid theme cluster pattern %q: missing closing bracket", e.pattern)
	case themeClusterPatternTrailingEscape:
		return fmt.Sprintf("invalid theme cluster pattern %q: trailing escape", e.pattern)
	default:
		return fmt.Sprintf("invalid theme cluster pattern %q", e.pattern)
	}
}

func themeClusterPatternRegexp(pattern string) (*regexp.Regexp, error) {
	var b strings.Builder
	b.WriteString("^")

	for i := 0; i < len(pattern); {
		r, size := utf8.DecodeRuneInString(pattern[i:])
		switch r {
		case '*':
			b.WriteString(".*")
			i += size
		case '?':
			b.WriteByte('.')
			i += size
		case '[':
			j := i + size
			if j < len(pattern) && pattern[j] == '!' {
				j++
			}
			if j < len(pattern) && pattern[j] == '^' {
				j++
			}
			if j < len(pattern) && pattern[j] == ']' {
				j++
			}
			for j < len(pattern) && pattern[j] != ']' {
				j++
			}
			if j >= len(pattern) {
				return nil, &themeClusterPatternError{
					pattern: pattern,
					kind:    themeClusterPatternMissingClosingBracket,
				}
			}
			if i+size < len(pattern) && pattern[i+size] == '!' {
				b.WriteString("[^")
				b.WriteString(pattern[i+size+1 : j+1])
			} else {
				b.WriteString(pattern[i : j+1])
			}
			i = j + 1
		case '\\':
			nextIndex := i + size
			if nextIndex >= len(pattern) {
				return nil, &themeClusterPatternError{
					pattern: pattern,
					kind:    themeClusterPatternTrailingEscape,
				}
			}
			next, nextSize := utf8.DecodeRuneInString(pattern[nextIndex:])
			b.WriteString(regexp.QuoteMeta(string(next)))
			i = nextIndex + nextSize
		default:
			b.WriteString(regexp.QuoteMeta(string(r)))
			i += size
		}
	}

	b.WriteString("$")
	return regexp.Compile(b.String())
}

func themeClusterPatternValidationMessage(err error) string {
	var patternErr *themeClusterPatternError
	if errors.As(err, &patternErr) {
		switch patternErr.kind {
		case themeClusterPatternMissingClosingBracket:
			return "Invalid cluster pattern: missing closing bracket."
		case themeClusterPatternTrailingEscape:
			return "Invalid cluster pattern: trailing escape."
		}
	}
	return "Invalid cluster pattern."
}

func matchThemeClusterPattern(pattern, contextName string) (bool, error) {
	if pattern == "" {
		pattern = "*"
	}
	re, err := themeClusterPatternRegexp(pattern)
	if err != nil {
		return false, err
	}
	return re.MatchString(contextName), nil
}

func validateThemeClusterPattern(pattern string) error {
	if pattern == "" {
		return nil
	}
	if _, err := themeClusterPatternRegexp(pattern); err != nil {
		return fmt.Errorf("invalid cluster pattern: %w", err)
	}
	return nil
}
