# Completion evidence

For behavior changes, define observable acceptance criteria before editing.
Include related actions that share the changed lifecycle or state: success,
failure, cancellation, readiness, cleanup, and relevant concurrent operations.
Scale the record to the change; apply the [testing standard](testing.md).
Test-only pruning needs no native interaction checks for unchanged production
code. For work spanning sessions, keep the record in the task's existing plan
under `docs/plans` rather than creating a second plan.

For each criterion, record its status (`pending`, `passed`, `failed`, or
`blocked`) and the evidence establishing that status. Identify what each test
replaces with a mock.

Before reporting completion:

1. Compare the implementation and evidence with the user's complete request,
   including accepted corrections and affected adjacent workflows.
2. Exercise the actual runtime for behavior that depends on it. Native dragging,
   placement, focus, and window destruction require native app validation;
   browser previews and registry tests are separate evidence.
3. Resolve every failed or pending required item. Pursue available ways to
   unblock a required check; if external access or user input is essential,
   state the exact blocker and leave the task unfinished. Elapsed effort and
   passing test counts do not waive an acceptance criterion.
4. Report the outcome with evidence and remaining limitations.

Durable regression tests belong in the required suites. The completion record
complements those tests; it cannot turn an unexecuted check into a passing one.
