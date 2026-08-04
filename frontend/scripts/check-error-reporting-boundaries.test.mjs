import { describe, expect, it } from 'vitest';
import { findInlineErrorBoundaryViolations } from './check-error-reporting-boundaries.mjs';

const violationsFor = (source) => findInlineErrorBoundaryViolations(source, '/repo/src/View.tsx');
const withErrorSurfaceImport = (source) =>
  `import { ErrorSurface } from '@shared/components/errors/ErrorSurface'; ${source}`;
const withReportingImports = (source) =>
  `import { errorHandler } from '@utils/errorHandler'; ${withErrorSurfaceImport(source)}`;

describe('error reporting presentation boundary', () => {
  it.each([
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
  ])('rejects %s', (_caseName, source) => {
    expect(violationsFor(source)).toEqual([
      expect.objectContaining({
        message: expect.stringContaining('ErrorSurface'),
      }),
    ]);
  });

  it.each([
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
  ])('allows %s', (_caseName, source) => {
    expect(violationsFor(source)).toEqual([]);
  });

  it('still rejects an unclassified conditional branch next to ErrorSurface', () => {
    const violations = violationsFor(
      'const failure = new Error("failed"); const View = ({ expected }) => <>{expected ? <ErrorSurface kind="reported" message="known" /> : failure.message}</>;'
    );

    expect(violations).toEqual([
      expect.objectContaining({ message: expect.stringContaining('ErrorSurface') }),
    ]);
  });

  it('rejects relabeling an unreported exception as already reported text', () => {
    const violations = violationsFor(
      'const failure = new Error("failed"); const View = () => <ErrorSurface kind="reported" message={failure.message} />;'
    );

    expect(violations).toEqual([
      expect.objectContaining({ message: expect.stringContaining('ErrorSurface') }),
    ]);
  });

  it('does not accept an ErrorSurface-shaped prop contract on another component', () => {
    const violations = violationsFor(
      'const failure = new Error("failed"); const View = () => <Banner kind="operational" error={failure} />;'
    );

    expect(violations).toEqual([
      expect.objectContaining({ message: expect.stringContaining('ErrorSurface') }),
    ]);
  });

  it('does not accept a namespaced ErrorSurface lookalike', () => {
    const violations = violationsFor(
      'const failure = new Error("failed"); const View = () => <Fake.ErrorSurface kind="operational" error={failure} />;'
    );

    expect(violations).toEqual([
      expect.objectContaining({ message: expect.stringContaining('ErrorSurface') }),
    ]);
  });

  it('does not accept a locally shadowed ErrorSurface', () => {
    const violations = violationsFor(
      'const ErrorSurface = Banner; const failure = new Error("failed"); const View = () => <ErrorSurface kind="operational" error={failure} />;'
    );

    expect(violations).toEqual([
      expect.objectContaining({ message: expect.stringContaining('ErrorSurface') }),
    ]);
  });

  it('does not accept a locally shadowed errorHandler as a reporting boundary', () => {
    const violations = violationsFor(
      withErrorSurfaceImport(
        'const errorHandler = { handle: (failure) => ({ message: failure.message }) }; const failure = new Error("failed"); const details = errorHandler.handle(failure); const View = () => <ErrorSurface kind="reported" message={details.message} />;'
      )
    );

    expect(violations).toEqual([
      expect.objectContaining({ message: expect.stringContaining('ErrorSurface') }),
    ]);
  });
});
