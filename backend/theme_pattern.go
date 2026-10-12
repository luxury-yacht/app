package backend

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/luxury-yacht/app/backend/internal/errorstatus"
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
		next, err := appendThemePatternToken(&b, pattern, i, r, size)
		if err != nil {
			return nil, err
		}
		i = next
	}
	b.WriteString("$")
	return regexp.Compile(b.String())
}

func appendThemePatternToken(builder *strings.Builder, pattern string, index int, token rune, size int) (int, error) {
	switch token {
	case '*':
		builder.WriteString(".*")
	case '?':
		builder.WriteByte('.')
	case '[':
		return appendThemePatternClass(builder, pattern, index, size)
	case '\\':
		return appendEscapedThemePatternRune(builder, pattern, index+size)
	default:
		builder.WriteString(regexp.QuoteMeta(string(token)))
	}
	return index + size, nil
}

func appendThemePatternClass(builder *strings.Builder, pattern string, start, size int) (int, error) {
	end := start + size
	if end < len(pattern) && pattern[end] == '!' {
		end++
	}
	if end < len(pattern) && pattern[end] == '^' {
		end++
	}
	if end < len(pattern) && pattern[end] == ']' {
		end++
	}
	for end < len(pattern) && pattern[end] != ']' {
		end++
	}
	if end >= len(pattern) {
		return 0, &themeClusterPatternError{pattern: pattern, kind: themeClusterPatternMissingClosingBracket}
	}
	if pattern[start+size] == '!' {
		builder.WriteString("[^")
		builder.WriteString(pattern[start+size+1 : end+1])
	} else {
		builder.WriteString(pattern[start : end+1])
	}
	return end + 1, nil
}

func appendEscapedThemePatternRune(builder *strings.Builder, pattern string, index int) (int, error) {
	if index >= len(pattern) {
		return 0, &themeClusterPatternError{pattern: pattern, kind: themeClusterPatternTrailingEscape}
	}
	next, size := utf8.DecodeRuneInString(pattern[index:])
	builder.WriteString(regexp.QuoteMeta(string(next)))
	return index + size, nil
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
		return errorstatus.BadRequest(fmt.Errorf("invalid cluster pattern: %w", err))
	}
	return nil
}
