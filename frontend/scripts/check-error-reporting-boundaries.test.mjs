import { describe, expect, it } from 'vitest';
import { findInlineErrorBoundaryViolations } from './check-error-reporting-boundaries.mjs';

const violationsFor = (source) => findInlineErrorBoundaryViolations(source, '/repo/src/View.tsx');
const withErrorSurfaceImport = (source) =>
  `import { ErrorSurface } from '@shared/components/errors/ErrorSurface'; ${source}`;
const withReportingImports = (source) =>
  `import { errorHandler } from '@utils/errorHandler'; ${withErrorSurfaceImport(source)}`;

describe('error reporting presentation boundary', () => {
  it('rejects every error-derived presentation shape', () => {
    for (const [caseName, source] of [
      [
        'a renamed Error.message value',
        'const failure = new Error("failed"); const notice = failure.message; const View = () => <div>{notice}</div>;',
      ],
      [
        'a transitive alias',
        'const failure = new Error("failed"); const first = failure.message; const second = first; const View = () => <div>{second}</div>;',
      ],
      [
        'a caught value stored in React state',
        'const View = () => { const [notice, setNotice] = useState(""); try { work(); } catch (failure) { setNotice(String(failure)); } return <div>{notice}</div>; };',
      ],
      [
        'a caught value stored through an aliased React state setter',
        'const View = () => { const [notice, setNotice] = useState(""); const writeNotice = setNotice; try { work(); } catch (failure) { writeNotice(String(failure)); } return <div>{notice}</div>; };',
      ],
      [
        'a Promise rejection stored in React state',
        'const View = () => { const [notice, setNotice] = useState(""); work().catch((failure) => setNotice(failure.message)); return <div>{notice}</div>; };',
      ],
      [
        'a caught value stored through a React reducer',
        'const View = () => { const [state, dispatch] = useReducer(reducer, {}); try { work(); } catch (failure) { dispatch({ notice: failure.message }); } return <div>{state.notice}</div>; };',
      ],
      [
        'a typed Error prop renamed before rendering',
        'const View = ({ failure }: { failure: Error }) => { const notice = failure.message; return <div>{notice}</div>; };',
      ],
      [
        'an error-derived helper result',
        'const describe = (failure) => failure.message; const View = () => { const notice = describe(new Error("failed")); return <div>{notice}</div>; };',
      ],
      [
        'an error passed through an imported formatter',
        'const failure = new Error("failed"); const notice = formatForDisplay(failure); const View = () => <div>{notice}</div>;',
      ],
      [
        'an error-derived component prop',
        'const failure = new Error("failed"); const notice = failure.message; const View = () => <Banner text={notice} />;',
      ],
      [
        'an error-derived object binding',
        'const { message: notice } = new Error("failed"); const View = () => <div>{notice}</div>;',
      ],
      [
        'an error-derived array binding',
        'const [notice] = [new Error("failed").message]; const View = () => <div>{notice}</div>;',
      ],
      [
        'an error-derived object literal',
        'const failure = new Error("failed"); const details = { notice: failure.message }; const View = () => <div>{details.notice}</div>;',
      ],
      [
        'an error-derived object spread',
        'const failure = new Error("failed"); const source = { failure: failure.message }; const details = { ...source }; const View = () => <div>{details.failure}</div>;',
      ],
      [
        'an error-derived template expression',
        'const failure = new Error("failed"); const notice = `Failure: $' +
          '{failure.message}`; const View = () => <div>{notice}</div>;',
      ],
      [
        'an error-derived property assignment',
        'const state = { notice: "" }; state.notice = new Error("failed").message; const View = () => <div>{state.notice}</div>;',
      ],
      [
        'an error-derived conditional expression',
        'const failure = new Error("failed"); const notice = ready ? "Ready" : failure.message; const View = () => <div>{notice}</div>;',
      ],
      [
        'a Promise then rejection handler',
        'const View = () => { work().then(undefined, (failure) => <div>{failure.message}</div>); return null; };',
      ],
      [
        'an error-derived function declaration result',
        'function describe(failure) { return failure.message; } const View = () => <div>{describe(new Error("failed"))}</div>;',
      ],
      [
        'an error-derived function expression result',
        'const describe = function showFailure(failure) { return failure.message; }; const View = () => <div>{describe(new Error("failed"))}</div>;',
      ],
    ]) {
      expect(violationsFor(source), caseName).toEqual([
        expect.objectContaining({
          message: expect.stringContaining('ErrorSurface'),
        }),
      ]);
    }
  }, 15_000);

  it('allows every approved presentation shape', () => {
    for (const [caseName, source] of [
      [
        'an operational ErrorSurface',
        withErrorSurfaceImport(
          'const failure = new Error("failed"); const View = () => <ErrorSurface kind="operational" error={failure} />;'
        ),
      ],
      [
        'an explicitly classified validation surface',
        'const validationError = "Enter a valid port"; const View = () => <ErrorSurface kind="validation" message={validationError} />;',
      ],
      [
        'text returned by the reporting boundary',
        withReportingImports(
          'const failure = new Error("failed"); const details = errorHandler.handle(failure); const View = () => <ErrorSurface kind="reported" message={details.message} />;'
        ),
      ],
      [
        'a conditionally rendered ErrorSurface wrapper',
        withErrorSurfaceImport(
          'const View = () => { const [failure, setFailure] = useState(null); try { work(); } catch (caught) { setFailure(caught); } return <>{failure && <div><ErrorSurface kind="operational" error={failure} /></div>}</>; };'
        ),
      ],
      [
        'ordinary dynamic text',
        'const notice = "Connected"; const View = () => <div>{notice}</div>;',
      ],
      [
        'domain status messages that are not JavaScript errors',
        'const condition = { message: "Ready" }; const View = () => <div>{condition.message}</div>;',
      ],
      [
        'a one-element React state binding',
        'const View = () => { const [notice] = useState("Connected"); return <div>{notice}</div>; };',
      ],
    ]) {
      expect(violationsFor(source), caseName).toEqual([]);
    }
  }, 15_000);

  it('rejects every presentation-boundary lookalike and bypass', () => {
    for (const [caseName, source] of [
      [
        'an unclassified conditional branch next to ErrorSurface',
        'const failure = new Error("failed"); const View = ({ expected }) => <>{expected ? <ErrorSurface kind="reported" message="known" /> : failure.message}</>;',
      ],
      [
        'an unreported exception relabeled as reported text',
        'const failure = new Error("failed"); const View = () => <ErrorSurface kind="reported" message={failure.message} />;',
      ],
      [
        'an ErrorSurface-shaped prop contract on another component',
        'const failure = new Error("failed"); const View = () => <Banner kind="operational" error={failure} />;',
      ],
      [
        'a namespaced ErrorSurface lookalike',
        'const failure = new Error("failed"); const View = () => <Fake.ErrorSurface kind="operational" error={failure} />;',
      ],
      [
        'a locally shadowed ErrorSurface',
        'const ErrorSurface = Banner; const failure = new Error("failed"); const View = () => <ErrorSurface kind="operational" error={failure} />;',
      ],
      [
        'a locally shadowed errorHandler',
        withErrorSurfaceImport(
          'const errorHandler = { handle: (failure) => ({ message: failure.message }) }; const failure = new Error("failed"); const details = errorHandler.handle(failure); const View = () => <ErrorSurface kind="reported" message={details.message} />;'
        ),
      ],
    ]) {
      expect(violationsFor(source), caseName).toEqual([
        expect.objectContaining({
          message: expect.stringContaining('ErrorSurface'),
        }),
      ]);
    }
  });
});
