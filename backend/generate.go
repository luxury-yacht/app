package backend

// Standard App.Get<Kind> resource-detail bindings and the object-panel
// detail-fetcher dispatch map are both generated from the binding descriptor in
// internal/genappbindings. Regenerate with `go generate ./backend` after adding a
// kind (one descriptor row + its typed service method/DTO).
//go:generate go run ./internal/genappbindings/cmd -out resources_generated.go -fetchers-out object_detail_fetchers_generated.go
