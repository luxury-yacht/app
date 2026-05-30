# Architecture Docs

Architecture docs are agent contracts. They should define ownership,
invariants, starting points, and validation. They should not duplicate full code
structure or describe completed migrations.

Use [../README.md](../README.md) as the router. If an architecture detail becomes
enforced by code, prefer a test or shared contract artifact and leave only the
rule here.
