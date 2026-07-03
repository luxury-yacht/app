- Go through all views. Check logs, domains, and the network tab. Make sure there are no unexpected logs, domain states, or network calls.

- Allow the user to manually add namespaces they have permission to access.
  Context: the namespaces domain now fails fast when the user lacks `list
  namespaces` RBAC — the sidebar shows "You do not have permission to list
  namespaces." and there is deliberately no catalog-based namespace inference.
  Future work: let the user type/select known namespace names so restricted
  clusters remain usable.

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
