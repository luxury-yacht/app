package podlogs

import "regexp"

// LineFilter applies optional include/exclude regex checks to a log line body.
type LineFilter struct {
	include *regexp.Regexp
	exclude *regexp.Regexp
}

func NewLineFilter(includePattern, excludePattern string) (LineFilter, error) {
	var filter LineFilter

	if includePattern != "" {
		expr, err := regexp.Compile(includePattern)
		if err != nil {
			return LineFilter{}, err
		}
		filter.include = expr
	}

	if excludePattern != "" {
		expr, err := regexp.Compile(excludePattern)
		if err != nil {
			return LineFilter{}, err
		}
		filter.exclude = expr
	}

	return filter, nil
}

func (f LineFilter) Matches(line string) bool {
	if f.include != nil && !f.include.MatchString(line) {
		return false
	}
	if f.exclude != nil && f.exclude.MatchString(line) {
		return false
	}
	return true
}
