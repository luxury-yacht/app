package querypage

import (
	"bytes"
	"encoding/binary"
	"encoding/gob"
	"fmt"
	"math"
	"os"
	"reflect"
	"sync"
	"unsafe"
)

// columnstore_mmap.go is the Tier 2.6 dual-mode SERVING path: it serializes a Store's INTERNED
// columns (the columnStore's per-field id/scalar columns + string dictionaries + the live
// arena) to an aligned on-disk format, and reopens it as a READ-ONLY Store whose scalar columns
// and dictionary strings ALIAS the memory mapping — so a Cold cluster serves queries with its
// column data in off-heap, OS-reclaimable page cache, never on the Go heap.
//
// Only the column DATA is off-heap. The query indexes (sort b-trees), the match cache, and the
// uid→rowID map are rebuilt on open from the aliased columns (heap, but far smaller than the
// rows). The irreducibly-dynamic "fallback" fields (maps/slices) can't be mmap'd, so they are
// gob-decoded onto the heap. The store is read-only (Store.readOnly) so it is never mutated.
// Callers use a heap fallback (RestoreColumnsFromFile) when OpenInternedColumnStore errors, so a
// bad/incompatible file is never a correctness risk.
//
// Aligned scalar sections (8-byte for int64/uint64/float64, 4-byte for uint32) let the reader
// reinterpret the mapped bytes as native integer slices via unsafe.Slice; strings alias the
// mapping via unsafe.String. The mmap base is page-aligned and every supported target is
// little-endian, so the native-order reinterpretation matches the on-disk encoding.

// internedColumnMagic is the spill-file format tag. Bump it on any encoding change so a stale
// file from a prior build is rejected (and the caller falls back to a full re-sync) rather than
// misread. QCM3 added the per-value presence flag to the gob fallback column.
const internedColumnMagic = "QCM3"

// SpillInternedColumns writes the store's interned columns to path in the mmap-aliasable format.
func (s *Store[R]) SpillInternedColumns(path string) error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	cs := s.rows
	arenaLen := len(cs.live)

	var w internedWriter
	w.put(internedColumnMagic)
	w.u32(uint32(arenaLen))
	w.u32(uint32(cs.count))
	w.u32(uint32(len(cs.codec.fields)))
	for i := 0; i < arenaLen; i++ {
		if cs.live[i] {
			w.buf = append(w.buf, 1)
		} else {
			w.buf = append(w.buf, 0)
		}
	}
	for _, fc := range cs.codec.fields {
		w.u8(uint8(fc.kind))
		w.u8(uint8(fc.elemKind))
		if fc.promoted {
			w.u8(1)
		} else {
			w.u8(0)
		}
		writeInternedField(&w, fc, cs.dicts, cs.codec.typ, arenaLen)
	}
	return os.WriteFile(path, w.buf, 0o644)
}

func writeInternedField(w *internedWriter, fc *fieldCodec, dicts *codecDicts, typ reflect.Type, n int) {
	switch fc.kind {
	case fieldString:
		if fc.promoted {
			w.strsec(fc.plainStr)
		} else {
			w.u32col(fc.strCol, n)
			w.strsec(dicts.dict(fc).vals)
		}
	case fieldInt:
		w.i64col(fc.intCol, n)
	case fieldUint:
		w.u64col(fc.uintCol, n)
	case fieldFloat:
		w.u64colFromFloat(fc.floatCol, n)
	case fieldBool:
		w.boolcol(fc.boolCol, n)
	case fieldPtrScalar:
		w.boolcol(fc.present, n)
		switch fc.elemKind {
		case fieldString:
			w.u32col(fc.strCol, n)
			w.strsec(dicts.dict(fc).vals)
		case fieldInt:
			w.i64col(fc.intCol, n)
		case fieldUint:
			w.u64col(fc.uintCol, n)
		case fieldFloat:
			w.u64colFromFloat(fc.floatCol, n)
		case fieldBool:
			w.boolcol(fc.boolCol, n)
		}
	case fieldFallback:
		ft := fieldGoType(typ, fc.index)
		var gbuf bytes.Buffer
		enc := gob.NewEncoder(&gbuf)
		for i := 0; i < n; i++ {
			rv := reflect.Zero(ft)
			if i < len(fc.fallback) && fc.fallback[i].IsValid() {
				rv = fc.fallback[i]
			}
			// gob cannot encode a top-level nil pointer/interface, so record a presence flag and
			// only encode the value when present. A nil pointer-to-struct field (e.g. a nil
			// *resourcemodel.ResourceLink) then round-trips as nil instead of panicking the spill.
			present := true
			switch rv.Kind() {
			case reflect.Ptr, reflect.Interface:
				present = !rv.IsNil()
			}
			_ = enc.Encode(present)
			if present {
				_ = enc.Encode(rv.Interface())
			}
		}
		w.u64(uint64(gbuf.Len()))
		w.bytes(gbuf.Bytes())
	}
}

// OpenInternedColumnStore reopens a file written by SpillInternedColumns as a read-only Store
// whose scalar columns and dictionary strings alias the mapping (off-heap), rebuilding the
// uid→rowID map, sort indexes, and match cache from the aliased columns. Rows decoded from
// the store clone string fields before returning, so Page/Snapshot rows can outlive the
// mapping closer while the bulk columns stay off-heap. A bad magic / field-shape mismatch /
// truncation returns an error so the caller falls back to the heap path.
func OpenInternedColumnStore[R any](path string, schema Schema[R]) (*Store[R], func() error, error) {
	mf, err := openMmap(path)
	if err != nil {
		return nil, nil, err
	}
	r := &internedReader{b: mf.bytes()}
	if string(r.take(4)) != internedColumnMagic {
		_ = mf.close()
		return nil, nil, fmt.Errorf("querypage: %q is not an interned column file", path)
	}
	arenaLen := int(r.u32())
	_ = r.u32() // count (recomputed from the live bitmap)
	nFields := int(r.u32())

	s := NewStore(schema)
	cs := s.rows
	if nFields != len(cs.codec.fields) {
		_ = mf.close()
		return nil, nil, fmt.Errorf("querypage: interned file %q has %d fields, codec has %d", path, nFields, len(cs.codec.fields))
	}
	live := r.take(arenaLen)

	for _, fc := range cs.codec.fields {
		kind := fieldKind(r.u8())
		elemKind := fieldKind(r.u8())
		fc.promoted = r.u8() == 1
		if kind != fc.kind || (kind == fieldPtrScalar && elemKind != fc.elemKind) {
			_ = mf.close()
			return nil, nil, fmt.Errorf("querypage: interned file %q field kind mismatch", path)
		}
		readInternedField(r, fc, cs.dicts, cs.codec.typ, arenaLen)
	}
	if r.err != nil {
		_ = mf.close()
		return nil, nil, fmt.Errorf("querypage: interned file %q truncated: %w", path, r.err)
	}
	cs.cloneStringsOnDecode = true

	// Rebuild the arena bookkeeping + indexes + match cache from the aliased columns. The
	// column DATA stays in the mapping; only these (smaller) derived structures are heap.
	cs.live = make([]bool, arenaLen)
	for i := 0; i < arenaLen; i++ {
		if i < len(live) && live[i] == 1 {
			cs.live[i] = true
			cs.count++
			row := cs.getByRowID(uint32(i))
			uid := schema.UID(row)
			cs.rowByUID[uid] = uint32(i)
			s.match[uint32(i)] = extractMatchValues(schema, row)
			s.reindex(uid, row)
		} else {
			cs.freeRows = append(cs.freeRows, uint32(i))
		}
	}
	// A read-only (mmap-aliased, Cold) store holds no trigram index: it would put heap
	// back on a store whose whole point is off-heap column data. The search path falls
	// back to a linear scan (Cold is not the hot search path). NewStore built one above;
	// drop it before marking the store read-only.
	s.tri = nil
	s.readOnly = true
	return s, mf.close, nil
}

// ReopenInternedColumnsInPlace spills this store's interned columns to path, then swaps the
// store's internals (columns, indexes, match cache) to a read-only, mmap-aliased view of that
// file — so the SAME *Store pointer keeps serving queries (callers holding it via a maintained
// store need no rewiring) but with its column data off-heap. Returned Page/Snapshot rows clone
// decoded strings, so the closer can run after the store is discarded or re-warmed without
// invalidating already-returned rows. On any error the store is left unchanged (safe-degrade:
// the caller keeps serving from heap). This is the Tier 2.6 Cold-serving transition at the
// store level.
func (s *Store[R]) ReopenInternedColumnsInPlace(path string) (func() error, error) {
	if err := s.SpillInternedColumns(path); err != nil {
		return nil, err
	}
	repl, closer, err := OpenInternedColumnStore(path, s.schema)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.rows = repl.rows
	s.match = repl.match
	s.idx = repl.idx
	s.facets = repl.facets
	// Drop the (now-stale) heap trigram index: this store is going read-only / off-heap,
	// and repl (from OpenInternedColumnStore) already holds none. Search falls back to the
	// linear scan, matching a fresh OpenInternedColumnStore store.
	s.tri = nil
	s.readOnly = true
	return s.lockSafeCloser(closer), nil
}

// lockSafeCloser wraps the raw unmap closer so it is safe-by-construction against an
// in-flight Query: Query reconstructs rows while holding s.mu.RLock (store.go), so the
// mapping must stay live until the in-flight read finishes. The wrapper takes s.mu.Lock
// first, which serializes after every in-flight read lock, so the unmap can never race a
// reader still touching the columns. It also unmaps at most once: a second call (a
// re-warm/teardown double-close) is a no-op, never a double-unmap.
func (s *Store[R]) lockSafeCloser(unmap func() error) func() error {
	var once sync.Once
	var err error
	return func() error {
		once.Do(func() {
			s.mu.Lock()
			defer s.mu.Unlock()
			err = unmap()
		})
		return err
	}
}

func readInternedField(r *internedReader, fc *fieldCodec, dicts *codecDicts, typ reflect.Type, n int) {
	switch fc.kind {
	case fieldString:
		if fc.promoted {
			fc.plainStr = r.strsec()
		} else {
			fc.strCol = r.u32col(n)
			dicts.dict(fc).vals = r.strsec()
		}
	case fieldInt:
		fc.intCol = r.i64col(n)
	case fieldUint:
		fc.uintCol = r.u64col(n)
	case fieldFloat:
		fc.floatCol = r.f64col(n)
	case fieldBool:
		fc.boolCol = r.boolcol(n)
	case fieldPtrScalar:
		fc.present = r.boolcol(n)
		switch fc.elemKind {
		case fieldString:
			fc.strCol = r.u32col(n)
			dicts.dict(fc).vals = r.strsec()
		case fieldInt:
			fc.intCol = r.i64col(n)
		case fieldUint:
			fc.uintCol = r.u64col(n)
		case fieldFloat:
			fc.floatCol = r.f64col(n)
		case fieldBool:
			fc.boolCol = r.boolcol(n)
		}
	case fieldFallback:
		blob := int(r.u64())
		dec := gob.NewDecoder(bytes.NewReader(r.take(blob)))
		ft := fieldGoType(typ, fc.index)
		fc.fallback = make([]reflect.Value, n)
		for i := 0; i < n; i++ {
			// Mirror the writer: a presence flag precedes each value; an absent value (a nil
			// pointer/interface the writer could not gob-encode) decodes back to the zero value.
			var present bool
			if err := dec.Decode(&present); err != nil {
				r.fail(err)
				return
			}
			if !present {
				fc.fallback[i] = reflect.Zero(ft)
				continue
			}
			np := reflect.New(ft)
			if err := dec.Decode(np.Interface()); err != nil {
				r.fail(err)
				return
			}
			fc.fallback[i] = np.Elem()
		}
	}
}

// fieldGoType returns the Go type of the leaf field reached by idx within struct type typ.
func fieldGoType(typ reflect.Type, idx []int) reflect.Type {
	return reflect.New(typ).Elem().FieldByIndex(idx).Type()
}

// internedWriter builds the on-disk byte buffer, padding before each scalar section so the
// reader can alias it at a matching aligned offset.
type internedWriter struct{ buf []byte }

func (w *internedWriter) put(s string)   { w.buf = append(w.buf, s...) }
func (w *internedWriter) u8(v uint8)     { w.buf = append(w.buf, v) }
func (w *internedWriter) u32(v uint32)   { w.buf = binary.LittleEndian.AppendUint32(w.buf, v) }
func (w *internedWriter) u64(v uint64)   { w.buf = binary.LittleEndian.AppendUint64(w.buf, v) }
func (w *internedWriter) bytes(b []byte) { w.buf = append(w.buf, b...) }
func (w *internedWriter) align(a int) {
	for len(w.buf)%a != 0 {
		w.buf = append(w.buf, 0)
	}
}

func (w *internedWriter) i64col(c []int64, n int) {
	w.align(8)
	for i := 0; i < n; i++ {
		var v int64
		if i < len(c) {
			v = c[i]
		}
		w.buf = binary.LittleEndian.AppendUint64(w.buf, uint64(v))
	}
}

func (w *internedWriter) u64col(c []uint64, n int) {
	w.align(8)
	for i := 0; i < n; i++ {
		var v uint64
		if i < len(c) {
			v = c[i]
		}
		w.buf = binary.LittleEndian.AppendUint64(w.buf, v)
	}
}

func (w *internedWriter) u64colFromFloat(c []float64, n int) {
	w.align(8)
	for i := 0; i < n; i++ {
		var v float64
		if i < len(c) {
			v = c[i]
		}
		w.buf = binary.LittleEndian.AppendUint64(w.buf, math.Float64bits(v))
	}
}

func (w *internedWriter) u32col(c []uint32, n int) {
	w.align(4)
	for i := 0; i < n; i++ {
		var v uint32
		if i < len(c) {
			v = c[i]
		}
		w.buf = binary.LittleEndian.AppendUint32(w.buf, v)
	}
}

func (w *internedWriter) boolcol(c []bool, n int) {
	for i := 0; i < n; i++ {
		var b byte
		if i < len(c) && c[i] {
			b = 1
		}
		w.buf = append(w.buf, b)
	}
}

func (w *internedWriter) strsec(vals []string) {
	w.u32(uint32(len(vals)))
	w.align(8)
	off := uint64(0)
	for _, s := range vals {
		w.buf = binary.LittleEndian.AppendUint64(w.buf, off)
		off += uint64(len(s))
	}
	w.buf = binary.LittleEndian.AppendUint64(w.buf, off)
	for _, s := range vals {
		w.buf = append(w.buf, s...)
	}
}

// internedReader is a bounds-checked, alignment-aware cursor that aliases scalar columns and
// dictionary strings to the mapping (zero-copy). On any out-of-bounds read it latches err and
// returns zero-filled results so a truncated/corrupt file fails cleanly rather than panicking.
type internedReader struct {
	b   []byte
	off int
	err error
}

func (r *internedReader) fail(err error) {
	if r.err == nil {
		r.err = err
	}
}

func (r *internedReader) take(n int) []byte {
	if r.err != nil || n < 0 || r.off+n > len(r.b) {
		r.fail(fmt.Errorf("unexpected end of interned data at offset %d (need %d)", r.off, n))
		return make([]byte, max(n, 0))
	}
	out := r.b[r.off : r.off+n]
	r.off += n
	return out
}

func (r *internedReader) u8() uint8   { return r.take(1)[0] }
func (r *internedReader) u32() uint32 { return binary.LittleEndian.Uint32(r.take(4)) }
func (r *internedReader) u64() uint64 { return binary.LittleEndian.Uint64(r.take(8)) }

func (r *internedReader) align(a int) {
	for r.off%a != 0 {
		if r.off >= len(r.b) {
			r.fail(fmt.Errorf("alignment past end of interned data at offset %d", r.off))
			return
		}
		r.off++
	}
}

func (r *internedReader) i64col(n int) []int64 {
	r.align(8)
	if n == 0 {
		return nil
	}
	if r.err != nil || r.off+n*8 > len(r.b) {
		r.fail(fmt.Errorf("int64 column past end at offset %d", r.off))
		return make([]int64, n)
	}
	s := unsafe.Slice((*int64)(unsafe.Pointer(&r.b[r.off])), n)
	r.off += n * 8
	return s
}

func (r *internedReader) u64col(n int) []uint64 {
	r.align(8)
	if n == 0 {
		return nil
	}
	if r.err != nil || r.off+n*8 > len(r.b) {
		r.fail(fmt.Errorf("uint64 column past end at offset %d", r.off))
		return make([]uint64, n)
	}
	s := unsafe.Slice((*uint64)(unsafe.Pointer(&r.b[r.off])), n)
	r.off += n * 8
	return s
}

func (r *internedReader) f64col(n int) []float64 {
	r.align(8)
	if n == 0 {
		return nil
	}
	if r.err != nil || r.off+n*8 > len(r.b) {
		r.fail(fmt.Errorf("float64 column past end at offset %d", r.off))
		return make([]float64, n)
	}
	s := unsafe.Slice((*float64)(unsafe.Pointer(&r.b[r.off])), n)
	r.off += n * 8
	return s
}

func (r *internedReader) u32col(n int) []uint32 {
	r.align(4)
	if n == 0 {
		return nil
	}
	if r.err != nil || r.off+n*4 > len(r.b) {
		r.fail(fmt.Errorf("uint32 column past end at offset %d", r.off))
		return make([]uint32, n)
	}
	s := unsafe.Slice((*uint32)(unsafe.Pointer(&r.b[r.off])), n)
	r.off += n * 4
	return s
}

func (r *internedReader) boolcol(n int) []bool {
	if n == 0 {
		return nil
	}
	if r.err != nil || r.off+n > len(r.b) {
		r.fail(fmt.Errorf("bool column past end at offset %d", r.off))
		return make([]bool, n)
	}
	s := unsafe.Slice((*bool)(unsafe.Pointer(&r.b[r.off])), n)
	r.off += n
	return s
}

func (r *internedReader) strsec() []string {
	count := int(r.u32())
	r.align(8)
	if r.err != nil || count < 0 || r.off+(count+1)*8 > len(r.b) {
		r.fail(fmt.Errorf("string offset table past end at offset %d", r.off))
		return nil
	}
	offs := make([]uint64, count+1)
	for i := range offs {
		offs[i] = binary.LittleEndian.Uint64(r.b[r.off+i*8:])
	}
	r.off += (count + 1) * 8
	dataOff := r.off
	dataLen := int(offs[count])
	if dataOff+dataLen > len(r.b) {
		r.fail(fmt.Errorf("string data past end at offset %d", dataOff))
		return nil
	}
	out := make([]string, count)
	for i := 0; i < count; i++ {
		n := int(offs[i+1] - offs[i])
		if n == 0 {
			continue
		}
		out[i] = unsafe.String(&r.b[dataOff+int(offs[i])], n)
	}
	r.off += dataLen
	return out
}
