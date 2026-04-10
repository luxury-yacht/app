package podlogs

import "regexp"

// PodNameFilter applies optional include/exclude regex checks to pod names.
type PodNameFilter struct {
	include *regexp.Regexp
	exclude *regexp.Regexp
}

func NewPodNameFilter(includePattern, excludePattern string) (PodNameFilter, error) {
	filter := PodNameFilter{}

	if includePattern != "" {
		expr, err := regexp.Compile(includePattern)
		if err != nil {
			return PodNameFilter{}, err
		}
		filter.include = expr
	}

	if excludePattern != "" {
		expr, err := regexp.Compile(excludePattern)
		if err != nil {
			return PodNameFilter{}, err
		}
		filter.exclude = expr
	}

	return filter, nil
}

func (f PodNameFilter) Match(podName string) bool {
	if f.include != nil && !f.include.MatchString(podName) {
		return false
	}
	if f.exclude != nil && f.exclude.MatchString(podName) {
		return false
	}
	return true
}

func (f PodNameFilter) IsZero() bool {
	return f.include == nil && f.exclude == nil
}
