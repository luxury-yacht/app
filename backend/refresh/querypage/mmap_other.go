//go:build !darwin && !linux

package querypage

import "os"

// mmapFile is the portable fallback for platforms without the unix mmap build (e.g. Windows):
// it reads the whole file into a heap buffer. This is CORRECT but not off-heap — the Tier 2.6
// page-cache reclaim is a unix property; elsewhere the column format still round-trips, just
// without the memory benefit. The interface matches the mmap implementation exactly.
type mmapFile struct {
	data []byte
}

func openMmap(path string) (*mmapFile, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return &mmapFile{data: data}, nil
}

func (m *mmapFile) bytes() []byte { return m.data }

func (m *mmapFile) close() error {
	m.data = nil
	return nil
}
