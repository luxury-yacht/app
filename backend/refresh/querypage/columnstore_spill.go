package querypage

import (
	"bytes"
	"encoding/binary"
	"encoding/gob"
	"fmt"
	"math"
	"os"
	"reflect"
)

// columnstore_spill.go is the Tier 2.6 columnar on-disk format for a Store: it writes the
// store's rows column-wise (one section per codec leaf field) to the mmap column file, and
// restores them into an equivalent store. It is a faithful drop-in for the gob Spill/RestoreStore
// — query-equivalent — but lays the rows out by column so scalar columns are flat (mmap/zero-copy
// friendly, the foundation in columnfile.go) and only the irreducibly-dynamic "fallback" fields
// (maps/slices/etc.) fall back to gob.
//
// It serializes RESOLVED field values (read via the codec's field index+kind), not the internal
// interned columns, so it is independent of the store's interning/promotion state: restore
// reconstructs each row and re-Upserts it, which rebuilds the columns, dictionaries, indexes,
// and match cache exactly as the gob path does.

const columnStoreMagic = "QPS1"

// SpillColumns writes the store's rows to path in the columnar format.
func (s *Store[R]) SpillColumns(path string) error {
	s.mu.RLock()
	rows := make([]R, 0, s.rows.len())
	s.rows.forEach(func(_ string, r R) bool { rows = append(rows, r); return true })
	codec := s.rows.codec
	s.mu.RUnlock()

	vals := make([]reflect.Value, len(rows))
	for i, r := range rows {
		vals[i] = reflect.ValueOf(r)
	}

	out := make([]byte, 0, 4096)
	out = append(out, columnStoreMagic...)
	out = binary.LittleEndian.AppendUint32(out, uint32(len(rows)))
	out = binary.LittleEndian.AppendUint32(out, uint32(len(codec.fields)))
	for _, fc := range codec.fields {
		out = append(out, byte(fc.kind), byte(fc.elemKind))
		out = appendFieldColumn(out, fc, vals)
	}
	return os.WriteFile(path, out, 0o644)
}

// appendFieldColumn appends field fc's column (the value of fc for every row) by kind.
func appendFieldColumn(out []byte, fc *fieldCodec, vals []reflect.Value) []byte {
	switch fc.kind {
	case fieldFallback:
		var buf bytes.Buffer
		enc := gob.NewEncoder(&buf)
		for _, v := range vals {
			// One stream carries the field type info once, then each row's value.
			_ = enc.Encode(fc.fieldValue(v).Interface())
		}
		out = binary.LittleEndian.AppendUint64(out, uint64(buf.Len()))
		return append(out, buf.Bytes()...)
	case fieldPtrScalar:
		for _, v := range vals {
			fv := fc.fieldValue(v)
			if fv.IsNil() {
				out = append(out, 0)
				out = appendScalar(out, fc.elemKind, reflect.Value{})
			} else {
				out = append(out, 1)
				out = appendScalar(out, fc.elemKind, fv.Elem())
			}
		}
		return out
	default:
		for _, v := range vals {
			out = appendScalar(out, fc.kind, fc.fieldValue(v))
		}
		return out
	}
}

// appendScalar appends one scalar value of the given kind. An invalid value (a nil
// pointer-to-scalar's absent element) writes the zero encoding, which decode ignores.
func appendScalar(out []byte, kind fieldKind, v reflect.Value) []byte {
	switch kind {
	case fieldString:
		s := ""
		if v.IsValid() {
			s = v.String()
		}
		out = binary.LittleEndian.AppendUint32(out, uint32(len(s)))
		return append(out, s...)
	case fieldInt:
		var n int64
		if v.IsValid() {
			n = v.Int()
		}
		return binary.LittleEndian.AppendUint64(out, uint64(n))
	case fieldUint:
		var n uint64
		if v.IsValid() {
			n = v.Uint()
		}
		return binary.LittleEndian.AppendUint64(out, n)
	case fieldFloat:
		var f float64
		if v.IsValid() {
			f = v.Float()
		}
		return binary.LittleEndian.AppendUint64(out, math.Float64bits(f))
	case fieldBool:
		b := byte(0)
		if v.IsValid() && v.Bool() {
			b = 1
		}
		return append(out, b)
	default:
		return out
	}
}

// RestoreColumnsFromFile reads a columnar file written by SpillColumns and rebuilds a NEW
// equivalent Store (reconstruct each row + Upsert — rebuilding columns, dicts, indexes, match
// cache). A bad magic, a field-shape mismatch against the schema's codec, or a truncated file
// returns an error so the caller can fall back to the gob path.
func RestoreColumnsFromFile[R any](path string, schema Schema[R]) (*Store[R], error) {
	s := NewStore(schema)
	if err := s.RestoreColumnsFromFileInto(path); err != nil {
		return nil, err
	}
	return s, nil
}

// RestoreColumnsFromFileInto reads a columnar file written by SpillColumns and Upserts its
// rows INTO this store (using the store's own schema/codec), for restoring into a
// freshly-built maintained store in place. Same validation + error contract as
// RestoreColumnsFromFile; the store is left partially populated only if a per-row Upsert
// follows a successful parse (parse errors happen before any Upsert).
func (s *Store[R]) RestoreColumnsFromFileInto(path string) error {
	mf, err := openMmap(path)
	if err != nil {
		return err
	}
	defer mf.close()

	rd := &colReader{b: mf.bytes()}
	if string(rd.take(4)) != columnStoreMagic {
		return fmt.Errorf("querypage: %q is not a columnar store file", path)
	}
	nRows := int(rd.u32())
	nFields := int(rd.u32())

	codec := s.rows.codec
	if nFields != len(codec.fields) {
		return fmt.Errorf("querypage: columnar file %q has %d fields, schema codec has %d", path, nFields, len(codec.fields))
	}

	recon := make([]reflect.Value, nRows)
	for i := range recon {
		recon[i] = reflect.New(codec.typ).Elem()
	}

	for _, fc := range codec.fields {
		kind := fieldKind(rd.u8())
		elemKind := fieldKind(rd.u8())
		if kind != fc.kind || (kind == fieldPtrScalar && elemKind != fc.elemKind) {
			return fmt.Errorf("querypage: columnar file %q field kind mismatch (got %d/%d, want %d/%d)", path, kind, elemKind, fc.kind, fc.elemKind)
		}
		if err := readFieldColumn(rd, fc, recon); err != nil {
			return fmt.Errorf("querypage: columnar file %q: %w", path, err)
		}
	}
	if rd.err != nil {
		return fmt.Errorf("querypage: columnar file %q truncated: %w", path, rd.err)
	}

	for _, rv := range recon {
		s.Upsert(rv.Interface().(R))
	}
	return nil
}

// readFieldColumn reads field fc's column from rd and sets it on every reconstructed row.
func readFieldColumn(rd *colReader, fc *fieldCodec, recon []reflect.Value) error {
	switch fc.kind {
	case fieldFallback:
		n := int(rd.u64())
		dec := gob.NewDecoder(bytes.NewReader(rd.take(n)))
		for i := range recon {
			fv := fc.fieldValue(recon[i])
			if err := dec.Decode(fv.Addr().Interface()); err != nil {
				return err
			}
		}
	case fieldPtrScalar:
		for i := range recon {
			present := rd.u8() == 1
			fv := fc.fieldValue(recon[i])
			// Always create the pointee and consume the scalar bytes (they are always
			// written, zero when absent); only assign the pointer when the value is present.
			ptr := reflect.New(fv.Type().Elem())
			readScalarInto(rd, fc.elemKind, ptr.Elem())
			if present {
				fv.Set(ptr)
			}
		}
	default:
		for i := range recon {
			readScalarInto(rd, fc.kind, fc.fieldValue(recon[i]))
		}
	}
	return rd.err
}

// readScalarInto reads one scalar of the given kind from rd and sets it into dst via
// SetInt/SetUint/SetFloat/SetBool/SetString, which width-convert into dst's concrete field
// type (e.g. a uint64 on disk into a uint32 field) — exactly as the codec's decode does. dst
// must be addressable/settable.
func readScalarInto(rd *colReader, kind fieldKind, dst reflect.Value) {
	switch kind {
	case fieldString:
		n := int(rd.u32())
		dst.SetString(string(rd.take(n)))
	case fieldInt:
		dst.SetInt(int64(rd.u64()))
	case fieldUint:
		dst.SetUint(rd.u64())
	case fieldFloat:
		dst.SetFloat(math.Float64frombits(rd.u64()))
	case fieldBool:
		dst.SetBool(rd.u8() == 1)
	}
}

// colReader is a bounds-checked cursor over the file bytes; once a read runs past the end it
// latches err and subsequent reads return zero, so a truncated file fails cleanly.
type colReader struct {
	b   []byte
	off int
	err error
}

func (r *colReader) take(n int) []byte {
	if r.err != nil || n < 0 || r.off+n > len(r.b) {
		if r.err == nil {
			r.err = fmt.Errorf("unexpected end of column data at offset %d (need %d bytes)", r.off, n)
		}
		return make([]byte, max(n, 0))
	}
	out := r.b[r.off : r.off+n]
	r.off += n
	return out
}

func (r *colReader) u8() uint8   { return r.take(1)[0] }
func (r *colReader) u32() uint32 { return binary.LittleEndian.Uint32(r.take(4)) }
func (r *colReader) u64() uint64 { return binary.LittleEndian.Uint64(r.take(8)) }
