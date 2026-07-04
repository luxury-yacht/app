- Need a restricted-permissions pass to make the app behave better when the user is missing important permissions.
  - Allow the user to manually add namespaces if they don't have list namespaces permissions
    ([#243](https://github.com/luxury-yacht/app/issues/243), plan: `docs/plans/namespace-scope.md`)
  - Fail fast instead of attempting loads (ex: Nodes shows loading spinner that will never work)

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
