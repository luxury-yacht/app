- Go through all views. Check logs, domains, and the network tab. Make sure there are no unexpected logs, domain states, or network calls.

- Delete namespace does not remove it from browse view

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
