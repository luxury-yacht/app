I asked for metrics to be a separate fetch path so they could be updated on a different frequency from the main table data. All of the tables that carry metrics data (nodes, workloads, pods) should be instantly updated via stream whenever the status changes, but metrics data should update on a timer. They have different requirements and therefore should have different update mechanisms. Why didn't you do this?

- Build a plugin architecture
  - AI
    - Conversational support to perform functions of the app
  - ArgoCD
    - Make ArgoCD CRDs built-in objects
    - Show Argo status of supported objects
  - Helm
    - Make Helm CRDs built-in objects
    - Lift the helm-specific features out of the core app
  - Karpenter
    - Make Karpenter CRDs built-in objects
