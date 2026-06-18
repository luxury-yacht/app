- Can't copy data from errors. Need to be able to select/copy and also need a "copy error" button

- Show time of last modified in Obj Panel Details

- Ingress/service/gateway hostnames should be clickable links
- Make Impossible States Impossible

  ┌───────────────────────────────┬───────────────────────────────────────┐
  │ What │ Where │
  ├───────────────────────────────┼───────────────────────────────────────┤
  │ identity │ resourcecontract/...json │
  ├───────────────────────────────┼───────────────────────────────────────┤
  │ model + facts │ resourcemodel/statefulset.go │
  ├───────────────────────────────┼───────────────────────────────────────┤
  │ DTO │ resources/types/types.go │
  ├───────────────────────────────┼───────────────────────────────────────┤
  │ detail builder │ resources/workloads/statefulsets.go │
  ├───────────────────────────────┼───────────────────────────────────────┤
  │ object-map collector + status │ refresh/snapshot/object_map.go │
  ├───────────────────────────────┼───────────────────────────────────────┤
  │ stream summary │ refresh/snapshot/streaming_helpers.go │
  ├───────────────────────────────┼───────────────────────────────────────┤
  │ App binding │ resource_details_generated.go │
  └───────────────────────────────┴───────────────────────────────────────┘

  Plus per-kind code in objectcatalog, domainpermissions, resourcestream. That is exactly "scattered across multiple places," and it is not achieved.
