package containerlogs

// PodNameFilter applies optional include/exclude regex checks to pod names.
type PodNameFilter LineFilter

func NewPodNameFilter(includePattern, excludePattern string) (PodNameFilter, error) {
	filter, err := NewLineFilter(includePattern, excludePattern)
	return PodNameFilter(filter), err
}

func (f PodNameFilter) Match(podName string) bool {
	return LineFilter(f).Matches(podName)
}

func (f PodNameFilter) IsZero() bool {
	return f.include == nil && f.exclude == nil
}
