package testsupport

// SampleCaseUnderRace reports whether one case of an exhaustive case product
// runs. Plain builds run every case. The race detector slows single-goroutine
// oracle products several-fold without adding concurrency coverage, so race
// builds keep only the cases whose dimension indices sum to a multiple of
// keepOneIn (about one in keepOneIn).
//
// Every value of a dimension still runs while the other dimensions' (len-1)
// counts sum to at least keepOneIn-1; every pair of values from two dimensions
// still runs under the same condition on the remaining dimensions.
func SampleCaseUnderRace(keepOneIn int, indices ...int) bool {
	if !RaceDetectorEnabled || keepOneIn <= 1 {
		return true
	}
	sum := 0
	for _, index := range indices {
		sum += index
	}
	return sum%keepOneIn == 0
}
