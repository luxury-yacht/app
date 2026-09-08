# Completion evidence

For behavior changes, define observable acceptance criteria before editing.
Include related actions that share the changed lifecycle or state: success,
failure, cancellation, readiness, cleanup, and relevant concurrent operations.
Scale the record to the change; wording and mechanical edits do not need behavior
tests. For work spanning sessions, keep the record in the task's existing plan
under `docs/plans` rather than creating a second plan.

For each criterion, record its status (`pending`, `passed`, `failed`, or `blocked`)
and the evidence establishing that status. Identify what a test replaces with a
mock. A producer test does not prove its consumer, and a native-call stub does
not prove native interaction. Add regression cases at the seam that reproduces
the user-visible failure and run them red before fixing the behavior.

Before reporting completion:

1. Compare the implementation and evidence with the user's complete request,
   including accepted corrections and affected adjacent workflows.
2. Exercise the actual runtime for behavior that depends on it. Native dragging,
   placement, focus, and window destruction require native app validation;
   browser previews and registry tests provide separate evidence.
3. Run the required focused, coverage, complexity, and final repository checks
   on the final worktree. Inspect formatting changes made by the final gate.
4. Resolve every failed or pending required item. Pursue available ways to unblock
   a required check; if external access or user input is essential, state the
   exact blocker and preserve the task as unfinished. Elapsed effort and passing
   test counts do not waive an acceptance criterion.
5. Report the outcome with evidence and any remaining limitations. Do not label
   the task complete while required verification remains outstanding.

Durable regression tests belong in the required suites. The completion record
complements those tests; it cannot turn an unexecuted check into a passing one.
