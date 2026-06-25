//go:build darwin || linux

package querypage

import (
	"fmt"
	"os"
	"syscall"
)

// mmapFile is a read-only memory mapping of a file. On unix the column data lives in the
// file-backed page cache (PROT_READ, MAP_SHARED), so it is OFF the Go heap and the OS can
// reclaim its clean pages under memory pressure — the whole point of the Tier 2.6 column
// format for Cold clusters.
type mmapFile struct {
	data []byte
	f    *os.File
}

// openMmap memory-maps path read-only. A zero-length file maps to an empty (nil) mapping
// rather than failing (mmap of 0 bytes is an error on some kernels).
func openMmap(path string) (*mmapFile, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	fi, err := f.Stat()
	if err != nil {
		_ = f.Close()
		return nil, err
	}
	size := int(fi.Size())
	if size == 0 {
		_ = f.Close()
		return &mmapFile{}, nil
	}
	data, err := syscall.Mmap(int(f.Fd()), 0, size, syscall.PROT_READ, syscall.MAP_SHARED)
	if err != nil {
		_ = f.Close()
		return nil, fmt.Errorf("querypage: mmap %q: %w", path, err)
	}
	return &mmapFile{data: data, f: f}, nil
}

func (m *mmapFile) bytes() []byte { return m.data }

// close unmaps the region and closes the backing file. After close the bytes() slice must
// not be read — any value previously decoded from it (an int, a copied string) remains valid.
func (m *mmapFile) close() error {
	var err error
	if m.data != nil {
		err = syscall.Munmap(m.data)
		m.data = nil
	}
	if m.f != nil {
		_ = m.f.Close()
		m.f = nil
	}
	return err
}
