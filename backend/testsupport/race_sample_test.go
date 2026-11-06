package testsupport

import "testing"

// A narrow filter can leave only rows that tie on the sort key, so the release
// gate's race run must still check every sort and direction unfiltered while
// sampling, not dropping, the filtered cases.
func TestRaceSampleKeepsUnfilteredBaselines(t *testing.T) {
	const sorts, directions, filters = 8, 2, 6 // the nodes equivalence matrix
	runsPerFilter := make([]int, filters)
	kept := 0
	for sortIndex := range sorts {
		for dirIndex := range directions {
			for filterIndex := range filters {
				if sampleCase(true, 4, []int{filterIndex}, []int{sortIndex, dirIndex}) {
					kept++
					runsPerFilter[filterIndex]++
				}
			}
		}
	}
	if runsPerFilter[0] != sorts*directions {
		t.Errorf("%d of %d sort/direction pairs run unfiltered", runsPerFilter[0], sorts*directions)
	}
	for filterIndex, runs := range runsPerFilter {
		if runs == 0 {
			t.Errorf("filter %d never runs", filterIndex)
		}
	}
	if kept == sorts*directions*filters {
		t.Error("race builds run the whole product instead of a sample")
	}
}
