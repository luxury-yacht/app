# Large Data Architecture

## Intent

This note captures the durable architecture and validation rules for large data
views in Luxury Yacht after the large-dataset hardening work completed.

## Product Model

Large data views now assume:

- no user-visible pagination
- capped table result sets
- virtualization for large tables
- users narrow oversized views with filters instead of loading unlimited rows

This model does **not** try to restore the older "always load the full active
dataset" approach.

## Durable Rules

### Canonical identity

Every Kubernetes object row must use canonical identity:

- `clusterId`
- `group`
- `version`
- `kind`
- `namespace`
- `name`

Use empty `namespace` for cluster-scoped objects.

`uid` remains important for lifecycle-sensitive workflows, but it is not the
primary row key.

### Metadata sourcing

Metadata-driven controls must use explicit metadata sources where required.

- filter and sidebar metadata should not be rebuilt from whatever rows happened
  to be loaded most recently
- row-derived metadata is allowed only where the exception is explicit and
  intentional

### Interaction ownership

Table families must declare where search, filter, and sort truth lives.

- `local`: operates on the loaded row set
- `query`: upstream query shapes the result set before it reaches the table
- `live`: frequent row changes are expected because key fields are time-varying

These modes are part of diagnostics semantics as well as UI interpretation.

### Diagnostics semantics

Performance diagnostics should be interpreted by table mode, not as one
universal meaning.

- `local` churn is usually suspicious
- `query` tables should explain upstream result semantics
- `live` churn is expected unless sort/render cost or user-visible jank says
  otherwise

### Generic object workflows

Generic object workflows should align to catalog identity without forcing a
catalog-only UI model.

- catalog identity/existence remains canonical
- typed views can keep typed payloads
- typed payloads must not become competing identity systems for open/diff/
  navigation/action flows

## Performance Expectations

Large-data work should continue to optimize for:

- stable row identity
- bounded metadata derivation
- incremental update paths
- explicit recomputation boundaries
- virtualized rendering
- measured improvements instead of guesswork

Heavy live families such as Pods should be evaluated after the shared
groundwork, not before it.

## Validation

Validation should include both real and synthetic datasets.

### Minimum real-cluster surfaces

- Cluster Browse
- All Namespaces Browse
- representative all-namespaces typed views
- representative cluster typed views

### Synthetic targets

Probe beyond current real-cluster sizes where practical:

- `25k` rows
- `50k` rows
- `100k` rows for the heaviest generic table paths

### Validation checks

- filter stability
- count/cap correctness
- responsiveness during refresh churn
- stable object actions and object opening
- multi-cluster-safe object identity behavior

### Performance bar

- no user-visible pagination
- smooth scrolling
- responsive sorting and filtering
- no obvious UI stalls during ordinary updates
