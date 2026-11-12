package testsupport

// SampleCaseUnderRace reports whether one case of an exhaustive case product
// runs. Plain builds run every case. The race detector slows single-goroutine
// oracle products several-fold without adding concurrency coverage, so race
// builds run a sample:
//
//   - A case whose filter indices are all 0 always runs. Index 0 of each filter
//     dimension must be its match-all value, so every combination of the other
//     dimensions (sort, direction, seed, page size) is still checked against the
//     whole fixture. A narrow filter can leave only rows that tie on the sort key.
//   - Any other case runs when all its indices sum to a multiple of keepOneIn
//     (about one in keepOneIn).
//
// Every value of a dimension still runs while the other dimensions' (len-1)
// counts sum to at least keepOneIn-1; every pair of values from two dimensions
// still runs under the same condition on the remaining dimensions.
func SampleCaseUnderRace(keepOneIn int, filters, others []int) bool {
	return sampleCase(RaceDetectorEnabled, keepOneIn, filters, others)
}

func sampleCase(raceEnabled bool, keepOneIn int, filters, others []int) bool {
	if !raceEnabled || keepOneIn <= 1 {
		return true
	}
	filtered, sum := false, 0
	for _, index := range filters {
		filtered = filtered || index != 0
		sum += index
	}
	if !filtered {
		return true
	}
	for _, index := range others {
		sum += index
	}
	return sum%keepOneIn == 0
}
