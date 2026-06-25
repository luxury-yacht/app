package querypage

import (
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestColumnFileRoundTrip proves the mmap column-file mechanism: a set of int64/uint32/string
// columns written to disk and mmap-read back yields the same values via per-value accessors
// (which decode straight from the file-backed mapping, off the Go heap). Values are chosen to
// exercise negatives, >2^31, empty strings, and unicode.
func TestColumnFileRoundTrip(t *testing.T) {
	ints := []int64{0, 1, -3, 1 << 40, -(1 << 50)}
	uints := []uint32{0, 7, 1 << 20, 4_000_000_000}
	strs := []string{"a", "", "héllo", "z", "a longer value with spaces"}

	path := filepath.Join(t.TempDir(), "cols.bin")
	require.NoError(t, writeColumnFile(path, ints, uints, strs))

	cf, err := openColumnFile(path)
	require.NoError(t, err)
	defer cf.Close()

	require.Equal(t, len(ints), cf.Int64Len())
	for i, want := range ints {
		require.Equal(t, want, cf.Int64At(i), "int64 column index %d", i)
	}

	require.Equal(t, len(uints), cf.Uint32Len())
	for i, want := range uints {
		require.Equal(t, want, cf.Uint32At(i), "uint32 column index %d", i)
	}

	require.Equal(t, len(strs), cf.StringLen())
	for i, want := range strs {
		require.Equal(t, want, cf.StringAt(i), "string column index %d", i)
	}
}

// TestColumnFileEmpty proves empty columns round-trip cleanly (no panic, zero lengths).
func TestColumnFileEmpty(t *testing.T) {
	path := filepath.Join(t.TempDir(), "empty.bin")
	require.NoError(t, writeColumnFile(path, nil, nil, nil))

	cf, err := openColumnFile(path)
	require.NoError(t, err)
	defer cf.Close()

	require.Equal(t, 0, cf.Int64Len())
	require.Equal(t, 0, cf.Uint32Len())
	require.Equal(t, 0, cf.StringLen())
}
