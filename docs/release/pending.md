### Added

- A new cluster view, API Resources, lists every object kind the cluster serves, built-in and custom. Similar to using `kubectl api-resources`.
  - Shows each kind's name, short names, API version, and scope, with filters for built-in or custom and for scope. Search also matches short names and API groups.
  - Opening a kind shows its details and a new Explain tab.
    - The Explain tab shows the kind's fields as a tree, with the `kubectl explain` description of the field you select and its allowed values.
    - Custom kinds open their CustomResourceDefinition, which gains the same Explain tab.
- The previous CRDs view has been removed as custom resource definitions are now listed in the API Resources view.
