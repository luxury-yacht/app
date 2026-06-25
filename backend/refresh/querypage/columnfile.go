package querypage

import (
	"encoding/binary"
	"fmt"
	"os"
	"unsafe"
)

// columnfile.go is the Tier 2.6 mmap'd on-disk column format. It writes a kind's interned
// columns (int64 / uint32 / string sections) to a flat little-endian file and reads them back
// through a memory mapping, so a Cold cluster's column data lives off the Go heap in
// OS-reclaimable page cache (on unix; the other-platform fallback reads into heap).
//
// Reads decode per value with encoding/binary (no `unsafe` pointer casts and no alignment
// requirement) — the column DATA stays in the mapping; only the small accessed value (an int,
// or a copied string) is materialised. Native little-endian is used because the spill is local
// same-machine cache. This slice is the mechanism; serializing a full columnStore and wiring
// the governor's Cold path onto it are later slices.

const columnFileMagic = "QPC1"

// writeColumnFile serializes the three column sections to path: a fixed 16-byte header
// (magic + the three counts), then the int64 values, the uint32 values, the string offset
// table (count+1 offsets into the data blob), and finally the concatenated string bytes.
func writeColumnFile(path string, ints []int64, uints []uint32, strs []string) error {
	out := make([]byte, 0, 16+len(ints)*8+len(uints)*4+(len(strs)+1)*8)
	out = append(out, columnFileMagic...)
	out = binary.LittleEndian.AppendUint32(out, uint32(len(ints)))
	out = binary.LittleEndian.AppendUint32(out, uint32(len(uints)))
	out = binary.LittleEndian.AppendUint32(out, uint32(len(strs)))

	for _, v := range ints {
		out = binary.LittleEndian.AppendUint64(out, uint64(v))
	}
	for _, v := range uints {
		out = binary.LittleEndian.AppendUint32(out, v)
	}
	// String offset table: offsets[i]..offsets[i+1] bound string i in the data blob.
	off := uint64(0)
	for _, s := range strs {
		out = binary.LittleEndian.AppendUint64(out, off)
		off += uint64(len(s))
	}
	out = binary.LittleEndian.AppendUint64(out, off)
	for _, s := range strs {
		out = append(out, s...)
	}
	return os.WriteFile(path, out, 0o644)
}

// columnFile is a mmap-backed reader over a file written by writeColumnFile.
type columnFile struct {
	mf         *mmapFile
	intCount   int
	uintCount  int
	strCount   int
	intOff     int // byte offset of the int64 section
	uintOff    int // byte offset of the uint32 section
	strOffOff  int // byte offset of the string offset table
	strDataOff int // byte offset of the string data blob
}

// openColumnFile maps path and parses its header, validating the magic and that the file is
// large enough for the declared sections (so a truncated/corrupt file errors rather than
// reading out of bounds).
func openColumnFile(path string) (*columnFile, error) {
	mf, err := openMmap(path)
	if err != nil {
		return nil, err
	}
	b := mf.bytes()
	if len(b) < 16 || string(b[0:4]) != columnFileMagic {
		_ = mf.close()
		return nil, fmt.Errorf("querypage: %q is not a column file", path)
	}
	ic := int(binary.LittleEndian.Uint32(b[4:]))
	uc := int(binary.LittleEndian.Uint32(b[8:]))
	sc := int(binary.LittleEndian.Uint32(b[12:]))
	cf := &columnFile{mf: mf, intCount: ic, uintCount: uc, strCount: sc}
	cf.intOff = 16
	cf.uintOff = cf.intOff + ic*8
	cf.strOffOff = cf.uintOff + uc*4
	cf.strDataOff = cf.strOffOff + (sc+1)*8
	if cf.strDataOff > len(b) {
		_ = mf.close()
		return nil, fmt.Errorf("querypage: column file %q truncated (need %d bytes, have %d)", path, cf.strDataOff, len(b))
	}
	return cf, nil
}

func (c *columnFile) Int64Len() int { return c.intCount }

// Int64At decodes one int64 from the mapping (no heap retention of the column).
func (c *columnFile) Int64At(i int) int64 {
	return int64(binary.LittleEndian.Uint64(c.mf.bytes()[c.intOff+i*8:]))
}

func (c *columnFile) Uint32Len() int { return c.uintCount }

func (c *columnFile) Uint32At(i int) uint32 {
	return binary.LittleEndian.Uint32(c.mf.bytes()[c.uintOff+i*4:])
}

func (c *columnFile) StringLen() int { return c.strCount }

// StringAt returns string i. Go strings are immutable and must not alias the mapping (it may
// be unmapped on Close), so the bytes are copied — the only materialisation; the rest of the
// string data stays in the off-heap mapping until accessed.
func (c *columnFile) StringAt(i int) string {
	b := c.mf.bytes()
	start := binary.LittleEndian.Uint64(b[c.strOffOff+i*8:])
	end := binary.LittleEndian.Uint64(b[c.strOffOff+(i+1)*8:])
	return string(b[c.strDataOff+int(start) : c.strDataOff+int(end)])
}

// Int64Column returns the int64 column as a slice ALIASING the mapping — zero-copy, with no
// heap copy of the column (the plan's "zero-copy page-cache reads"). The int64 section starts
// at offset 16 and the mmap base is page-aligned, so the cast is 8-byte aligned. The values
// are interpreted in NATIVE byte order, which matches the little-endian on-disk encoding on
// every supported host (amd64/arm64 darwin/linux/windows are all little-endian); the portable
// per-value accessors (Int64At) use explicit little-endian and work on any host.
//
// LIFETIME: the returned slice points into the mapping and is valid only until Close — the
// caller (a Cold-cluster columnStore) must hold the columnFile for as long as it uses the
// slice and must not retain it past Close.
func (c *columnFile) Int64Column() []int64 {
	if c.intCount == 0 {
		return nil
	}
	return unsafe.Slice((*int64)(unsafe.Pointer(&c.mf.bytes()[c.intOff])), c.intCount)
}

// Uint32Column returns the uint32 column zero-copy, aliasing the mapping. The uint32 section
// follows the 8-aligned int64 section, so it is at least 4-byte aligned. Same native-order and
// lifetime contract as Int64Column.
func (c *columnFile) Uint32Column() []uint32 {
	if c.uintCount == 0 {
		return nil
	}
	return unsafe.Slice((*uint32)(unsafe.Pointer(&c.mf.bytes()[c.uintOff])), c.uintCount)
}

// StringColumnAliased returns the string column with each element ALIASING the mapping via
// unsafe.String — zero-copy, so the string BYTES stay in off-heap page cache (only the
// []string and its string headers are heap). It is the string counterpart of
// Int64Column/Uint32Column for the dual-mode serving path. Same lifetime contract: the
// returned strings point into the mapping and are invalid after Close, so the caller must
// hold the columnFile for as long as it uses them.
func (c *columnFile) StringColumnAliased() []string {
	out := make([]string, c.strCount)
	b := c.mf.bytes()
	for i := 0; i < c.strCount; i++ {
		start := binary.LittleEndian.Uint64(b[c.strOffOff+i*8:])
		end := binary.LittleEndian.Uint64(b[c.strOffOff+(i+1)*8:])
		n := int(end - start)
		if n == 0 {
			out[i] = ""
			continue
		}
		out[i] = unsafe.String(&b[c.strDataOff+int(start)], n)
	}
	return out
}

// Close unmaps the file. Values already read (ints, copied strings) remain valid; any
// zero-copy slice returned by Int64Column/Uint32Column/StringColumnAliased does NOT — it
// aliases the now unmapped region and must be dropped before Close.
func (c *columnFile) Close() error { return c.mf.close() }
