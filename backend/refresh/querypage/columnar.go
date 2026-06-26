package querypage

import (
	"reflect"
	"strings"
	"unsafe"
)

// columnar.go replaces the store's `map[string]R` row storage with an interned,
// columnar (structure-of-arrays) representation while preserving byte-identical
// behavior. A reflection-built rowCodec maps R's struct fields onto columns:
// string fields are dictionary-interned to uint32 ids, numeric/bool fields go to
// typed columns, and anything that cannot be faithfully columnarized falls back to
// a stored copy. The codec's contract is absolute: Decode(Encode(R)) deep-equals R
// for every R. Interning is best-effort; round-trip fidelity is not.
//
// Rows live in a recycled rowId arena: a deleted row's id is reused by the next
// insert, so the columns stay dense without per-delete compaction.

// ---- Dictionary interning ----

// stringDict interns strings to dense uint32 ids. id 0 is always the empty string
// so a zero-valued column slot decodes to "" without any explicit write.
type stringDict struct {
	ids  map[string]uint32
	vals []string
}

func newStringDict() *stringDict {
	return &stringDict{ids: map[string]uint32{"": 0}, vals: []string{""}}
}

func (d *stringDict) intern(v string) uint32 {
	if id, ok := d.ids[v]; ok {
		return id
	}
	id := uint32(len(d.vals))
	d.vals = append(d.vals, v)
	d.ids[v] = id
	return id
}

func (d *stringDict) value(id uint32) string { return d.vals[id] }

// ---- Field codecs ----

// fieldKind classifies how one struct field is stored.
type fieldKind int

const (
	fieldString    fieldKind = iota // dictionary-interned uint32 id column
	fieldInt                        // int/int8..int64 -> int64 column
	fieldUint                       // uint/uint8..uint64/uintptr -> uint64 column
	fieldFloat                      // float32/float64 -> float64 column
	fieldBool                       // bool column
	fieldPtrScalar                  // pointer to a scalar leaf -> non-nil flag + scalar column
	fieldFallback                   // anything else (slice/map/iface/ptr-to-struct/…) -> faithful stored copy
)

// fieldCodec holds both the immutable shape of one LEAF struct field (its index path
// and kind) and the per-store mutable column data for it (a fresh codec is built per
// store, so this co-location is safe). Nested/embedded structs are flattened to
// leaves at build time. For scalar kinds it owns one column slice; for the fallback
// it owns a copy column. Pointer-to-scalar reuses the scalar column plus a
// presence-flag column.
//
// String columns are dictionary-interned by default (dict in codecDicts; ids in
// strCol). A column that turns out to be (near-)unique — where the dict costs more
// than it saves — is PROMOTED in place to a plain []string column (plainStr), the
// dict and id column released. Promotion never changes a decoded value: the same
// string is returned either way, so behavior stays byte-identical; it only changes
// the storage layout, recovering the prototype's win on unique columns (uid, name)
// while keeping interning's win on repeated columns (kind, namespace, status, …).
type fieldCodec struct {
	index []int // field index path from the root struct value (for embedded/nested)
	kind  fieldKind

	// scalar columns (only the one matching kind is used)
	strCol   []uint32 // interned string ids (fieldString / fieldPtrScalar(string)), nil once promoted
	plainStr []string // raw strings, populated only after promotion
	promoted bool     // true once this string column switched to plainStr
	intCol   []int64
	uintCol  []uint64
	floatCol []float64
	boolCol  []bool

	// pointer-to-scalar: presence flag + the underlying scalar kind.
	present  []bool
	elemKind fieldKind // scalar kind of the pointee (for fieldPtrScalar)

	// fallback: a faithful copy of the original value per row. A nil (invalid) slot
	// reconstructs as the field's zero value, which is already present in the freshly
	// allocated output struct, so no per-field type needs to be retained here.
	fallback []reflect.Value
}

// rowCodec encodes/decodes a whole R into/out of column slices. It is built once
// from R's type and is immutable thereafter.
type rowCodec[R any] struct {
	typ    reflect.Type
	fields []*fieldCodec // top-level leaf codecs (nested structs are flattened to leaves)
}

// scalarKind reports the fieldKind for a leaf (non-pointer, non-aggregate) type, or
// (_, false) if it is not a faithfully columnarizable scalar.
func scalarKind(t reflect.Type) (fieldKind, bool) {
	switch t.Kind() {
	case reflect.String:
		return fieldString, true
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return fieldInt, true
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uintptr:
		return fieldUint, true
	case reflect.Float32, reflect.Float64:
		return fieldFloat, true
	case reflect.Bool:
		return fieldBool, true
	default:
		return 0, false
	}
}

// newRowCodec builds the codec for R by reflecting over its (struct) type. If R is
// not a struct it is handled entirely by a single fallback field, so the contract
// holds for any R.
func newRowCodec[R any]() *rowCodec[R] {
	var zero R
	t := reflect.TypeOf(&zero).Elem()
	c := &rowCodec[R]{typ: t}
	if t.Kind() == reflect.Struct {
		c.fields = buildStructCodecs(t, nil)
	} else {
		c.fields = []*fieldCodec{{index: nil, kind: fieldFallback}}
	}
	return c
}

// buildStructCodecs walks a struct type and returns a flat list of leaf field
// codecs. Embedded and named struct fields are recursed into and flattened so the
// column set is a flat structure-of-arrays; only exported fields are columnarized
// (an unexported field cannot be read/set via reflection without unsafe, so it goes
// to the fallback, which copies the whole reflect.Value faithfully).
func buildStructCodecs(t reflect.Type, prefix []int) []*fieldCodec {
	var out []*fieldCodec
	for i := 0; i < t.NumField(); i++ {
		f := t.Field(i)
		idx := append(append([]int{}, prefix...), i)
		if f.PkgPath != "" {
			// Unexported field: cannot be set via reflection -> fallback copy. (None
			// of the production row types have unexported fields, but the codec must
			// stay total.)
			out = append(out, &fieldCodec{index: idx, kind: fieldFallback})
			continue
		}
		out = append(out, buildFieldCodec(f.Type, idx)...)
	}
	return out
}

// buildFieldCodec returns the leaf codec(s) for one exported field of type ft at
// index path idx.
func buildFieldCodec(ft reflect.Type, idx []int) []*fieldCodec {
	if k, ok := scalarKind(ft); ok {
		return []*fieldCodec{{index: idx, kind: k}}
	}
	switch ft.Kind() {
	case reflect.Ptr:
		if ek, ok := scalarKind(ft.Elem()); ok {
			return []*fieldCodec{{index: idx, kind: fieldPtrScalar, elemKind: ek}}
		}
		// pointer-to-struct / pointer-to-aggregate -> fallback (faithful copy).
		return []*fieldCodec{{index: idx, kind: fieldFallback}}
	case reflect.Struct:
		// Recurse into the nested/embedded struct, flattening its leaves. The codec
		// only descends when EVERY leaf is itself columnarizable-or-fallback (always
		// true, since buildStructCodecs is total), so the whole struct is reconstructed
		// field-by-field with no aggregate copy.
		return buildStructCodecs(ft, idx)
	default:
		// slices, maps, interfaces, channels, arrays, funcs -> faithful fallback copy.
		return []*fieldCodec{{index: idx, kind: fieldFallback}}
	}
}

// growTo ensures every column in the codec has length >= n (appending zero values).
// Called when the arena grows by one row.
func (c *rowCodec[R]) growTo(n int, dicts *codecDicts) {
	for _, fc := range c.fields {
		fc.grow(n, dicts)
	}
}

func (fc *fieldCodec) grow(n int, dicts *codecDicts) {
	switch fc.kind {
	case fieldString:
		if fc.promoted {
			for len(fc.plainStr) < n {
				fc.plainStr = append(fc.plainStr, "")
			}
		} else {
			for len(fc.strCol) < n {
				fc.strCol = append(fc.strCol, 0)
			}
		}
	case fieldInt:
		for len(fc.intCol) < n {
			fc.intCol = append(fc.intCol, 0)
		}
	case fieldUint:
		for len(fc.uintCol) < n {
			fc.uintCol = append(fc.uintCol, 0)
		}
	case fieldFloat:
		for len(fc.floatCol) < n {
			fc.floatCol = append(fc.floatCol, 0)
		}
	case fieldBool:
		for len(fc.boolCol) < n {
			fc.boolCol = append(fc.boolCol, false)
		}
	case fieldPtrScalar:
		for len(fc.present) < n {
			fc.present = append(fc.present, false)
		}
		switch fc.elemKind {
		case fieldString:
			for len(fc.strCol) < n {
				fc.strCol = append(fc.strCol, 0)
			}
		case fieldInt:
			for len(fc.intCol) < n {
				fc.intCol = append(fc.intCol, 0)
			}
		case fieldUint:
			for len(fc.uintCol) < n {
				fc.uintCol = append(fc.uintCol, 0)
			}
		case fieldFloat:
			for len(fc.floatCol) < n {
				fc.floatCol = append(fc.floatCol, 0)
			}
		case fieldBool:
			for len(fc.boolCol) < n {
				fc.boolCol = append(fc.boolCol, false)
			}
		}
	case fieldFallback:
		for len(fc.fallback) < n {
			fc.fallback = append(fc.fallback, reflect.Value{})
		}
	}
}

// codecDicts holds the per-field string dictionaries. They are owned by the column
// store, not the (immutable) codec, so a fresh store starts with empty dicts.
type codecDicts struct {
	byField map[*fieldCodec]*stringDict
}

func (d *codecDicts) dict(fc *fieldCodec) *stringDict {
	sd, ok := d.byField[fc]
	if !ok {
		sd = newStringDict()
		d.byField[fc] = sd
	}
	return sd
}

// drop releases a field's dictionary (after the column was promoted to plain
// strings), so the interning map's memory is reclaimed.
func (d *codecDicts) drop(fc *fieldCodec) { delete(d.byField, fc) }

// Promotion thresholds. A string column promotes to plain []string once it holds a
// meaningful number of rows AND its dictionary is (near-)unique — i.e. interning is
// not deduplicating, so the dict's map is pure overhead. Below promoteMinRows the
// overhead is negligible, so we keep the simpler interned path.
const (
	promoteMinRows     = 1024 // don't promote tiny columns; the dict is cheap there
	promoteUniqueNumer = 9    // promote when distinct/rows > 9/10 (≥90% unique)
	promoteUniqueDenom = 10
)

// promote converts an interned string column to a plain []string column in place,
// using the (still-present) dict to recover each live row's string, then drops the
// dict. Decoded values are unchanged — only the storage layout differs. arenaLen is
// the current column length (live + freed slots); freed slots decode to "" via id 0,
// which maps to "" in plainStr too, so freed slots stay consistent.
func (fc *fieldCodec) promote(dicts *codecDicts, arenaLen int) {
	if fc.kind != fieldString || fc.promoted {
		return
	}
	sd := dicts.dict(fc)
	plain := make([]string, arenaLen)
	for i := 0; i < arenaLen && i < len(fc.strCol); i++ {
		plain[i] = sd.value(fc.strCol[i])
	}
	fc.plainStr = plain
	fc.strCol = nil
	fc.promoted = true
	dicts.drop(fc)
}

// shouldPromote reports whether an interned string column has become unique enough
// that its dictionary is net overhead and it should switch to a plain column.
func (fc *fieldCodec) shouldPromote(dicts *codecDicts, liveRows int) bool {
	if fc.kind != fieldString || fc.promoted || liveRows < promoteMinRows {
		return false
	}
	distinct := len(dicts.dict(fc).vals) - 1 // exclude the always-present "" entry
	return distinct*promoteUniqueDenom > liveRows*promoteUniqueNumer
}

// fieldValue resolves the reflect.Value of fc's field within the root struct value
// v, returning a value that is BOTH readable and settable even when the field (or an
// intermediate embedded field) is unexported. The root v must be addressable
// (encode/decode pass an addressable struct), which lets us rebuild an exported,
// settable handle to an unexported field via its address. This keeps the codec total
// over any struct, including the test rows whose fields are all unexported.
func (fc *fieldCodec) fieldValue(v reflect.Value) reflect.Value {
	cur := v
	for _, i := range fc.index {
		cur = cur.Field(i)
		if !cur.CanSet() && cur.CanAddr() {
			cur = reflect.NewAt(cur.Type(), unsafe.Pointer(cur.UnsafeAddr())).Elem()
		}
	}
	return cur
}

// encode writes field fc of row value v into row slot rowID.
func (fc *fieldCodec) encode(v reflect.Value, rowID int, dicts *codecDicts) {
	fv := fc.fieldValue(v)
	switch fc.kind {
	case fieldString:
		if fc.promoted {
			fc.plainStr[rowID] = fv.String()
		} else {
			fc.strCol[rowID] = dicts.dict(fc).intern(fv.String())
		}
	case fieldInt:
		fc.intCol[rowID] = fv.Int()
	case fieldUint:
		fc.uintCol[rowID] = fv.Uint()
	case fieldFloat:
		fc.floatCol[rowID] = fv.Float()
	case fieldBool:
		fc.boolCol[rowID] = fv.Bool()
	case fieldPtrScalar:
		if fv.IsNil() {
			fc.present[rowID] = false
			// Leave the scalar slot at zero; decode ignores it when !present.
			return
		}
		fc.present[rowID] = true
		el := fv.Elem()
		switch fc.elemKind {
		case fieldString:
			fc.strCol[rowID] = dicts.dict(fc).intern(el.String())
		case fieldInt:
			fc.intCol[rowID] = el.Int()
		case fieldUint:
			fc.uintCol[rowID] = el.Uint()
		case fieldFloat:
			fc.floatCol[rowID] = el.Float()
		case fieldBool:
			fc.boolCol[rowID] = el.Bool()
		}
	case fieldFallback:
		// Store a faithful copy so a later in-place mutation of the column or the
		// caller's value cannot alter what we hand back. deepCopyValue makes the copy
		// independent of the source's backing arrays/maps.
		fc.fallback[rowID] = deepCopyValue(fv)
	}
}

// decode reconstructs field fc of row slot rowID into the root struct value out.
func (fc *fieldCodec) decode(out reflect.Value, rowID int, dicts *codecDicts, cloneStrings bool) {
	fv := fc.fieldValue(out)
	switch fc.kind {
	case fieldString:
		if fc.promoted {
			fv.SetString(cloneDecodedString(fc.plainStr[rowID], cloneStrings))
		} else {
			fv.SetString(cloneDecodedString(dicts.dict(fc).value(fc.strCol[rowID]), cloneStrings))
		}
	case fieldInt:
		fv.SetInt(fc.intCol[rowID])
	case fieldUint:
		fv.SetUint(fc.uintCol[rowID])
	case fieldFloat:
		fv.SetFloat(fc.floatCol[rowID])
	case fieldBool:
		fv.SetBool(fc.boolCol[rowID])
	case fieldPtrScalar:
		if !fc.present[rowID] {
			// fv is already the zero (nil) pointer for a freshly-allocated out.
			return
		}
		ptr := reflect.New(fv.Type().Elem())
		el := ptr.Elem()
		switch fc.elemKind {
		case fieldString:
			el.SetString(cloneDecodedString(dicts.dict(fc).value(fc.strCol[rowID]), cloneStrings))
		case fieldInt:
			el.SetInt(fc.intCol[rowID])
		case fieldUint:
			el.SetUint(fc.uintCol[rowID])
		case fieldFloat:
			el.SetFloat(fc.floatCol[rowID])
		case fieldBool:
			el.SetBool(fc.boolCol[rowID])
		}
		fv.Set(ptr)
	case fieldFallback:
		stored := fc.fallback[rowID]
		if !stored.IsValid() {
			// Freed/never-written slot: leave the zero value already in out.
			return
		}
		// Hand back an independent copy so the store's retained value is never aliased
		// by (and thus never mutated through) the returned row.
		fv.Set(deepCopyValue(stored))
	}
}

func cloneDecodedString(value string, clone bool) string {
	if clone {
		return strings.Clone(value)
	}
	return value
}

// deepCopyValue returns a deep, independent copy of v so neither the stored value
// nor the returned value can be mutated through the other. It recurses through
// pointers, slices, arrays, maps, structs, and interfaces — the categories a
// fallback column can hold — and copies scalars by value. This is what guarantees
// the fallback's round-trip is exact AND isolated.
func deepCopyValue(v reflect.Value) reflect.Value {
	if !v.IsValid() {
		return v
	}
	switch v.Kind() {
	case reflect.Ptr:
		if v.IsNil() {
			return v
		}
		cp := reflect.New(v.Type().Elem())
		cp.Elem().Set(deepCopyValue(v.Elem()))
		return cp
	case reflect.Interface:
		if v.IsNil() {
			return v
		}
		return deepCopyValue(v.Elem())
	case reflect.Slice:
		if v.IsNil() {
			return v // preserve nil vs empty distinction
		}
		cp := reflect.MakeSlice(v.Type(), v.Len(), v.Cap())
		for i := 0; i < v.Len(); i++ {
			cp.Index(i).Set(deepCopyValue(v.Index(i)))
		}
		return cp
	case reflect.Array:
		cp := reflect.New(v.Type()).Elem()
		for i := 0; i < v.Len(); i++ {
			cp.Index(i).Set(deepCopyValue(v.Index(i)))
		}
		return cp
	case reflect.Map:
		if v.IsNil() {
			return v // preserve nil vs empty distinction
		}
		cp := reflect.MakeMapWithSize(v.Type(), v.Len())
		for _, k := range v.MapKeys() {
			cp.SetMapIndex(deepCopyValue(k), deepCopyValue(v.MapIndex(k)))
		}
		return cp
	case reflect.Struct:
		cp := reflect.New(v.Type()).Elem()
		for i := 0; i < v.NumField(); i++ {
			src := v.Field(i)
			dst := cp.Field(i)
			if !dst.CanSet() {
				// Unexported field: rebuild exported, settable handles to both source and
				// destination via their addresses so the bytes are preserved deeply. The
				// destination is always addressable (cp came from reflect.New). The source
				// is addressable when v is; when v is a non-addressable read-only value we
				// fall back to a shallow byte copy of the field, which is exact for the
				// scalar/leaf fields these represent.
				dst = reflect.NewAt(dst.Type(), unsafe.Pointer(dst.UnsafeAddr())).Elem()
				if src.CanAddr() {
					src = reflect.NewAt(src.Type(), unsafe.Pointer(src.UnsafeAddr())).Elem()
					dst.Set(deepCopyValue(src))
				} else {
					dst.Set(src)
				}
				continue
			}
			dst.Set(deepCopyValue(src))
		}
		return cp
	default:
		// Scalars and any other directly-copyable kind: copy by value.
		cp := reflect.New(v.Type()).Elem()
		cp.Set(v)
		return cp
	}
}

// ---- Column store ----

// matchValues is the precomputed, by-rowId match cache: the interned facet ids and
// the lowercased search text, both extracted ONCE at put time so Query can match on
// columns without reconstructing the full row.
type matchValues struct {
	facets     map[string]string // facet name -> raw facet value (as the schema extractor returns)
	searchText string            // lowercased SearchText(row)
}

// columnStore holds rows for one kind in interned columnar form.
type columnStore[R any] struct {
	codec                *rowCodec[R]
	dicts                *codecDicts
	rowByUID             map[string]uint32
	freeRows             []uint32
	count                int // live row count (== len(rowByUID))
	live                 []bool
	cloneStringsOnDecode bool
}

func newColumnStore[R any](codec *rowCodec[R]) *columnStore[R] {
	return &columnStore[R]{
		codec:    codec,
		dicts:    &codecDicts{byField: map[*fieldCodec]*stringDict{}},
		rowByUID: map[string]uint32{},
	}
}

// allocRow returns a free rowId (reusing a freed one) or grows the arena by one.
func (cs *columnStore[R]) allocRow() uint32 {
	if n := len(cs.freeRows); n > 0 {
		id := cs.freeRows[n-1]
		cs.freeRows = cs.freeRows[:n-1]
		return id
	}
	id := uint32(len(cs.live))
	cs.live = append(cs.live, false)
	cs.codec.growTo(len(cs.live), cs.dicts)
	return id
}

// put inserts or replaces the row for uid, encoding it into the columns. Returns the
// assigned rowId so the caller can maintain its by-rowId match cache.
func (cs *columnStore[R]) put(uid string, r R) uint32 {
	rowID, existed := cs.rowByUID[uid]
	if !existed {
		rowID = cs.allocRow()
		cs.rowByUID[uid] = rowID
		cs.live[rowID] = true
		cs.count++
	}
	// Encode from an addressable copy so the codec can read/copy unexported fields via
	// their address (reflect cannot read an unexported field of a non-addressable value).
	v := reflect.New(cs.codec.typ).Elem()
	v.Set(reflect.ValueOf(r))
	for _, fc := range cs.codec.fields {
		fc.encode(v, int(rowID), cs.dicts)
	}
	// After encoding, promote any string column that has become (near-)unique: its
	// dictionary stopped deduplicating, so it switches to a plain []string column and
	// the dict's map memory is reclaimed. This is the generic equivalent of the
	// prototype keeping its known-unique `name` column un-interned — recovering the
	// memory win without per-kind knowledge. Promotion is one-way and value-preserving.
	for _, fc := range cs.codec.fields {
		if fc.shouldPromote(cs.dicts, cs.count) {
			fc.promote(cs.dicts, len(cs.live))
		}
	}
	return rowID
}

// get reconstructs the row for uid from the columns.
func (cs *columnStore[R]) get(uid string) (R, bool) {
	rowID, ok := cs.rowByUID[uid]
	if !ok {
		var zero R
		return zero, false
	}
	return cs.getByRowID(rowID), true
}

// getByRowID reconstructs the row at a known live rowId.
func (cs *columnStore[R]) getByRowID(rowID uint32) R {
	out := reflect.New(cs.codec.typ).Elem()
	for _, fc := range cs.codec.fields {
		fc.decode(out, int(rowID), cs.dicts, cs.cloneStringsOnDecode)
	}
	return out.Interface().(R)
}

// delete marks uid's row free, recycling its rowId. Fallback slots are cleared so a
// recycled row never resurrects a prior row's stored value, and the GC can reclaim
// the held aggregate. Returns the freed rowId (for the caller's match-cache eviction)
// and whether a row existed.
func (cs *columnStore[R]) delete(uid string) (uint32, bool) {
	rowID, ok := cs.rowByUID[uid]
	if !ok {
		return 0, false
	}
	delete(cs.rowByUID, uid)
	cs.live[rowID] = false
	cs.count--
	cs.freeRows = append(cs.freeRows, rowID)
	for _, fc := range cs.codec.fields {
		if fc.kind == fieldFallback {
			fc.fallback[rowID] = reflect.Value{}
		}
	}
	return rowID, true
}

// len reports the number of live rows.
func (cs *columnStore[R]) len() int { return cs.count }

// rowID returns the arena rowId backing uid, and whether it is present. Query uses
// it to reach a row's cached match values without reconstructing the row.
func (cs *columnStore[R]) rowID(uid string) (uint32, bool) {
	id, ok := cs.rowByUID[uid]
	return id, ok
}

// forEach reconstructs every live row and invokes fn; iteration stops early if fn
// returns false. Order is by rowId, which is unspecified (Snapshot is documented as
// unordered), matching the prior map iteration's lack of order guarantee.
func (cs *columnStore[R]) forEach(fn func(uid string, r R) bool) {
	for uid, rowID := range cs.rowByUID {
		if !fn(uid, cs.getByRowID(rowID)) {
			return
		}
	}
}

// extractMatchValues computes the by-rowId match cache for a row using the schema
// extractors — the facet values and the lowercased search text — so Query never
// reconstructs a row just to test a filter or search.
func extractMatchValues[R any](schema Schema[R], r R) matchValues {
	mv := matchValues{}
	if len(schema.Facets) > 0 {
		mv.facets = make(map[string]string, len(schema.Facets))
		for name, get := range schema.Facets {
			mv.facets[name] = get(r)
		}
	}
	if schema.SearchText != nil {
		mv.searchText = strings.ToLower(schema.SearchText(r))
	}
	return mv
}
