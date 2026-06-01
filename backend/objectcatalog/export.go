package objectcatalog

import (
	"bytes"
	"encoding/csv"
	"fmt"
	"io"
)

// ExportQueryCSV exports all rows matching a catalog query from the backend.
// It pages through the same keyset cursor contract used by Browse so the
// frontend never needs to materialize every matching row.
func (s *Service) ExportQueryCSV(opts QueryOptions) (string, error) {
	var out bytes.Buffer
	if err := s.WriteQueryCSV(&out, opts); err != nil {
		return "", err
	}
	return out.String(), nil
}

// WriteQueryCSV streams all rows matching a catalog query to a writer. CSV is
// an adapter over catalog page iteration, so cursor handling stays in one place.
func (s *Service) WriteQueryCSV(out io.Writer, opts QueryOptions) error {
	if s == nil {
		return fmt.Errorf("catalog service is unavailable")
	}
	if out == nil {
		return fmt.Errorf("catalog CSV writer is unavailable")
	}

	queryOpts := opts
	queryOpts.Continue = ""
	limit := clampQueryLimit(queryOpts.Limit)

	writer := csv.NewWriter(out)
	if err := writer.Write([]string{
		"clusterId",
		"kind",
		"namespace",
		"name",
		"group",
		"version",
		"resource",
		"uid",
	}); err != nil {
		return err
	}

	for {
		queryOpts.Limit = limit
		result := s.Query(queryOpts)
		if result.CursorInvalid {
			return fmt.Errorf("catalog query cursor became invalid during export")
		}
		for _, item := range result.Items {
			if err := writer.Write([]string{
				item.ClusterID,
				item.Kind,
				item.Namespace,
				item.Name,
				item.Group,
				item.Version,
				item.Resource,
				item.UID,
			}); err != nil {
				return err
			}
		}
		if result.ContinueToken == "" {
			break
		}
		queryOpts.Continue = result.ContinueToken
	}

	writer.Flush()
	if err := writer.Error(); err != nil {
		return err
	}
	return nil
}
