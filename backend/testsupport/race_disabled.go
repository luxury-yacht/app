//go:build !race

package testsupport

// RaceDetectorEnabled reports whether the test binary was built with -race.
const RaceDetectorEnabled = false
