import { readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript/unstable/ast';
import { API as TypeScriptAPI } from 'typescript/unstable/sync';

const ERROR_CONSTRUCTORS = new Set(['AggregateError', 'DOMException', 'Error']);
const ERROR_HANDLER_MODULES = new Set(['@/utils/errorHandler', '@utils/errorHandler']);
const ERROR_SURFACE = 'ErrorSurface';
const ERROR_SURFACE_MODULE = '@shared/components/errors/ErrorSurface';
const REPORTING_BOUNDARY_METHODS = new Set(['handle', 'handleInline', 'handleOperational']);
const REACT_STATE_HOOKS = new Set(['useReducer', 'useState']);
const REJECTION_HANDLER_INDEXES = new Map([
  ['catch', 0],
  ['then', 1],
]);
const virtualSources = new Map();
let analysisSequence = 0;
let typescriptAPI;

const isErrorOwner = (fileName) => {
  const normalized = fileName.replaceAll('\\', '/');
  return (
    normalized.includes('/src/shared/components/errors/') || normalized.includes('/src/ui/errors/')
  );
};

const isProductionTsx = (fileName) => {
  const normalized = fileName.replaceAll('\\', '/');
  return (
    normalized.endsWith('.tsx') &&
    !normalized.includes('.test.') &&
    !normalized.includes('.stories.') &&
    !isErrorOwner(normalized)
  );
};

const isFunctionLikeNode = (node) =>
  ts.isArrowFunction(node) ||
  ts.isConstructorDeclaration(node) ||
  ts.isFunctionDeclaration(node) ||
  ts.isFunctionExpression(node) ||
  ts.isGetAccessorDeclaration(node) ||
  ts.isMethodDeclaration(node) ||
  ts.isSetAccessorDeclaration(node);

const isJsxOpeningLikeElement = (node) =>
  ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node);

const visitDescendants = (root, visitor) => {
  const visit = (node) => {
    visitor(node);
    node.forEachChild(visit);
  };
  visit(root);
};

const getMemberName = (node) => {
  if (ts.isPropertyAccessExpression(node)) {
    return node.name.text;
  }
  if (ts.isElementAccessExpression(node) && node.argumentExpression) {
    const property = node.argumentExpression;
    if (ts.isStringLiteralLikeNode(property)) {
      return property.text;
    }
  }
  return null;
};

const getMemberOwner = (node) => {
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    return node.expression;
  }
  return null;
};

const typeContainsError = (node) => {
  if (!node) {
    return false;
  }
  let found = false;
  visitDescendants(node, (descendant) => {
    if (ts.isIdentifier(descendant) && ERROR_CONSTRUCTORS.has(descendant.text)) {
      found = true;
    }
  });
  return found;
};

const getTypeScriptAPI = () => {
  if (!typescriptAPI) {
    typescriptAPI = new TypeScriptAPI({
      cwd: process.cwd(),
      fs: {
        fileExists: (candidate) => (virtualSources.has(path.resolve(candidate)) ? true : undefined),
        readFile: (candidate) => virtualSources.get(path.resolve(candidate)),
      },
    });
  }
  return typescriptAPI;
};

process.once('exit', () => typescriptAPI?.close());

const parseTsx = (source, fileName) => {
  analysisSequence += 1;
  const virtualFileName = path.resolve(
    process.cwd(),
    'src',
    `__error_reporting_boundary_${process.pid}_${analysisSequence}.tsx`
  );
  virtualSources.set(virtualFileName, source);
  const api = getTypeScriptAPI();
  const snapshot = api.updateSnapshot({
    fileChanges: { created: [virtualFileName] },
    openFiles: [virtualFileName],
  });
  const project = snapshot.getDefaultProjectForFile(virtualFileName);
  const sourceFile = project?.program.getSourceFile(virtualFileName);
  if (!project || !sourceFile) {
    snapshot.dispose();
    virtualSources.delete(virtualFileName);
    throw new Error(`Unable to parse ${fileName} with the TypeScript project`);
  }
  const diagnostics = project.program.getSyntacticDiagnostics(virtualFileName);
  if (diagnostics.length > 0) {
    snapshot.dispose();
    virtualSources.delete(virtualFileName);
    const message = String(diagnostics[0].messageText ?? 'unknown syntax error');
    throw new Error(`Unable to parse ${fileName}: ${message}`);
  }
  return {
    checker: project.checker,
    dispose: () => {
      snapshot.dispose();
      api
        .updateSnapshot({
          closeFiles: [virtualFileName],
          fileChanges: { deleted: [virtualFileName] },
        })
        .dispose();
      virtualSources.delete(virtualFileName);
    },
    project,
    sourceFile,
  };
};

const importModuleForSymbol = (symbol, project) => {
  for (const handle of symbol?.declarations ?? []) {
    const declaration = handle.resolve(project);
    if (!declaration) {
      continue;
    }
    if (!ts.isImportSpecifier(declaration)) {
      continue;
    }
    let parent = declaration.parent;
    while (parent && !ts.isImportDeclaration(parent)) {
      parent = parent.parent;
    }
    if (parent && ts.isStringLiteralLikeNode(parent.moduleSpecifier)) {
      return parent.moduleSpecifier.text;
    }
  }
  return null;
};

const unwrap = (rawNode) => {
  let node = rawNode;
  while (
    node &&
    (ts.isAsExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isParenthesizedExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isTypeAssertion(node))
  ) {
    node = node.expression;
  }
  return node;
};

const isAssignmentExpression = (node) =>
  ts.isBinaryExpression(node) &&
  node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
  node.operatorToken.kind <= ts.SyntaxKind.LastAssignment;

const createTaintAnalysis = ({ checker, project }) => ({
  checker,
  project,
  stateBySetter: new Map(),
  taintedBindings: new Set(),
  taintedFunctions: new Set(),
});

const getBinding = (analysis, node) =>
  ts.isIdentifier(node) ? analysis.checker.getSymbolAtLocation(node) : null;

const addBinding = (analysis, binding) => {
  if (!binding || analysis.taintedBindings.has(binding)) {
    return false;
  }
  analysis.taintedBindings.add(binding);
  return true;
};

const addBindingsFromNodes = (analysis, nodes) => {
  let changed = false;
  for (const node of nodes) {
    if (node && addBindingsFromPattern(analysis, node)) {
      changed = true;
    }
  }
  return changed;
};

const objectPropertyValue = (property) => {
  if (ts.isPropertyAssignment(property)) {
    return property.initializer;
  }
  if (ts.isShorthandPropertyAssignment(property)) {
    return property.name;
  }
  return ts.isSpreadAssignment(property) ? property.expression : null;
};

const addBindingsFromPattern = (analysis, rawNode) => {
  const node = unwrap(rawNode);
  if (!node) {
    return false;
  }
  if (ts.isIdentifier(node)) {
    return addBinding(analysis, getBinding(analysis, node));
  }
  if (ts.isBindingElement(node)) {
    return addBindingsFromPattern(analysis, node.name);
  }
  if (ts.isArrayBindingPattern(node) || ts.isArrayLiteralExpression(node)) {
    return addBindingsFromNodes(
      analysis,
      node.elements.filter((element) => !ts.isOmittedExpression(element))
    );
  }
  if (ts.isObjectBindingPattern(node)) {
    return addBindingsFromNodes(
      analysis,
      node.elements.map((element) => element.name)
    );
  }
  if (ts.isObjectLiteralExpression(node)) {
    return addBindingsFromNodes(analysis, node.properties.map(objectPropertyValue));
  }
  if (ts.isSpreadElement(node) || ts.isSpreadAssignment(node)) {
    return addBindingsFromPattern(analysis, node.expression);
  }
  return false;
};

const bindingFromFunction = (analysis, node) => {
  if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.name) {
    return getBinding(analysis, node.name);
  }
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return getBinding(analysis, parent.name);
  }
  if (parent && isAssignmentExpression(parent) && ts.isIdentifier(parent.left)) {
    return getBinding(analysis, parent.left);
  }
  return null;
};

const functionFromBinding = (analysis, binding) => {
  for (const handle of binding?.declarations ?? []) {
    const declaration = handle.resolve(analysis.project);
    if (!declaration) {
      continue;
    }
    if (ts.isFunctionDeclaration(declaration) || ts.isFunctionExpression(declaration)) {
      return declaration;
    }
    const initializer = ts.isVariableDeclaration(declaration) ? declaration.initializer : null;
    if (initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) {
      return initializer;
    }
  }
  return null;
};

const isReportingBoundaryCall = (analysis, node) => {
  const callee = node.expression;
  const owner = getMemberOwner(callee);
  if (!owner || !ts.isIdentifier(owner) || owner.text !== 'errorHandler') {
    return false;
  }
  return (
    ERROR_HANDLER_MODULES.has(
      importModuleForSymbol(getBinding(analysis, owner), analysis.project)
    ) && REPORTING_BOUNDARY_METHODS.has(getMemberName(callee))
  );
};

const identifierIsTainted = (analysis, node) =>
  analysis.taintedBindings.has(getBinding(analysis, node));

const newExpressionIsTainted = (analysis, node, seen) => {
  const constructsError =
    ts.isIdentifier(node.expression) && ERROR_CONSTRUCTORS.has(node.expression.text);
  return (
    constructsError ||
    (node.arguments ?? []).some((argument) => expressionIsTainted(analysis, argument, seen))
  );
};

const memberExpressionIsTainted = (analysis, node, seen) =>
  expressionIsTainted(analysis, node.expression, seen);

const identifierCallIsTainted = (analysis, callee, arguments_, seen) => {
  if (analysis.taintedFunctions.has(getBinding(analysis, callee))) {
    return true;
  }
  return (
    callee.text === 'String' &&
    arguments_.some((argument) => expressionIsTainted(analysis, argument, seen))
  );
};

const callExpressionIsTainted = (analysis, node, seen) => {
  if (isReportingBoundaryCall(analysis, node)) {
    return false;
  }
  const callee = node.expression;
  if (ts.isIdentifier(callee) && identifierCallIsTainted(analysis, callee, node.arguments, seen)) {
    return true;
  }
  const owner = getMemberOwner(callee);
  if (owner && expressionIsTainted(analysis, owner, seen)) {
    return true;
  }
  return node.arguments.some((argument) => expressionIsTainted(analysis, argument, seen));
};

const conditionalExpressionIsTainted = (analysis, node, seen) =>
  expressionIsTainted(analysis, node.whenTrue, seen) ||
  expressionIsTainted(analysis, node.whenFalse, seen);

const binaryExpressionIsTainted = (analysis, node, seen) =>
  expressionIsTainted(analysis, node.left, seen) || expressionIsTainted(analysis, node.right, seen);

const templateExpressionIsTainted = (analysis, node, seen) =>
  node.templateSpans.some((span) => expressionIsTainted(analysis, span.expression, seen));

const arrayExpressionIsTainted = (analysis, node, seen) =>
  node.elements.some((element) => expressionIsTainted(analysis, element, seen));

const objectExpressionIsTainted = (analysis, node, seen) =>
  node.properties
    .map(objectPropertyValue)
    .some((expression) => expression && expressionIsTainted(analysis, expression, seen));

const wrappedExpressionIsTainted = (analysis, node, seen) =>
  node.expression ? expressionIsTainted(analysis, node.expression, seen) : false;

const EXPRESSION_TAINT_CHECKERS = new Map([
  [ts.SyntaxKind.Identifier, identifierIsTainted],
  [ts.SyntaxKind.NewExpression, newExpressionIsTainted],
  [ts.SyntaxKind.PropertyAccessExpression, memberExpressionIsTainted],
  [ts.SyntaxKind.ElementAccessExpression, memberExpressionIsTainted],
  [ts.SyntaxKind.CallExpression, callExpressionIsTainted],
  [ts.SyntaxKind.ConditionalExpression, conditionalExpressionIsTainted],
  [ts.SyntaxKind.BinaryExpression, binaryExpressionIsTainted],
  [ts.SyntaxKind.TemplateExpression, templateExpressionIsTainted],
  [ts.SyntaxKind.ArrayLiteralExpression, arrayExpressionIsTainted],
  [ts.SyntaxKind.ObjectLiteralExpression, objectExpressionIsTainted],
  [ts.SyntaxKind.AwaitExpression, wrappedExpressionIsTainted],
  [ts.SyntaxKind.PrefixUnaryExpression, wrappedExpressionIsTainted],
  [ts.SyntaxKind.PostfixUnaryExpression, wrappedExpressionIsTainted],
  [ts.SyntaxKind.YieldExpression, wrappedExpressionIsTainted],
  [ts.SyntaxKind.SpreadElement, wrappedExpressionIsTainted],
]);

const expressionIsTainted = (analysis, rawNode, seen = new Set()) => {
  const node = unwrap(rawNode);
  if (!node || seen.has(node)) {
    return false;
  }
  seen.add(node);
  const checkTaint = EXPRESSION_TAINT_CHECKERS.get(node.kind);
  return checkTaint ? checkTaint(analysis, node, seen) : false;
};

const seedCatchBinding = (analysis, node) => {
  if (ts.isCatchClause(node) && node.variableDeclaration) {
    addBindingsFromPattern(analysis, node.variableDeclaration.name);
  }
};

const seedTypedErrorParameters = (analysis, node) => {
  if (!isFunctionLikeNode(node)) {
    return;
  }
  for (const parameter of node.parameters) {
    if (typeContainsError(parameter.type)) {
      addBindingsFromPattern(analysis, parameter.name);
    }
  }
};

const rejectionHandlerForCall = (node) => {
  if (!ts.isCallExpression(node)) {
    return null;
  }
  const handlerIndex = REJECTION_HANDLER_INDEXES.get(getMemberName(node.expression));
  if (handlerIndex === undefined) {
    return null;
  }
  const handler = node.arguments[handlerIndex];
  return handler && isFunctionLikeNode(handler) ? handler : null;
};

const seedRejectionHandler = (analysis, node) => {
  const firstParameter = rejectionHandlerForCall(node)?.parameters[0];
  if (firstParameter) {
    addBindingsFromPattern(analysis, firstParameter.name);
  }
};

const stateHookElements = (node) => {
  if (!ts.isVariableDeclaration(node) || !ts.isArrayBindingPattern(node.name)) {
    return null;
  }
  if (!node.initializer || !ts.isCallExpression(node.initializer)) {
    return null;
  }
  const callee = node.initializer.expression;
  const hookName = ts.isIdentifier(callee) ? callee.text : getMemberName(callee);
  return hookName && REACT_STATE_HOOKS.has(hookName) ? node.name.elements : null;
};

const bindingElementIdentifier = (element) => {
  if (!element || ts.isOmittedExpression(element)) {
    return null;
  }
  const name = element.name;
  return name && ts.isIdentifier(name) ? name : null;
};

const seedReactStateHook = (analysis, node) => {
  const elements = stateHookElements(node);
  if (!elements) {
    return;
  }
  const state = bindingElementIdentifier(elements[0]);
  const setter = bindingElementIdentifier(elements[1]);
  if (!state || !setter) {
    return;
  }
  const stateBinding = getBinding(analysis, state);
  const setterBinding = getBinding(analysis, setter);
  if (stateBinding && setterBinding) {
    analysis.stateBySetter.set(setterBinding, stateBinding);
  }
};

const seedTaintSources = (analysis, sourceFile) => {
  visitDescendants(sourceFile, (node) => {
    seedCatchBinding(analysis, node);
    seedTypedErrorParameters(analysis, node);
    seedRejectionHandler(analysis, node);
    seedReactStateHook(analysis, node);
  });
};

const getFunctionParent = (node) => {
  let parent = node.parent;
  while (parent) {
    if (isFunctionLikeNode(parent)) {
      return parent;
    }
    parent = parent.parent;
  }
  return null;
};

const propagateExpressionArrow = (analysis, node) => {
  if (!ts.isArrowFunction(node) || ts.isBlock(node.body)) {
    return false;
  }
  const binding = bindingFromFunction(analysis, node);
  if (
    !binding ||
    analysis.taintedFunctions.has(binding) ||
    !expressionIsTainted(analysis, node.body)
  ) {
    return false;
  }
  analysis.taintedFunctions.add(binding);
  return true;
};

const propagateStateSetterAlias = (analysis, left, right) => {
  if (!ts.isIdentifier(left) || !ts.isIdentifier(right)) {
    return false;
  }
  const stateBinding = analysis.stateBySetter.get(getBinding(analysis, right));
  const aliasBinding = getBinding(analysis, left);
  if (!stateBinding || !aliasBinding || analysis.stateBySetter.has(aliasBinding)) {
    return false;
  }
  analysis.stateBySetter.set(aliasBinding, stateBinding);
  return true;
};

const assignmentBindingTarget = (left) =>
  ts.isPropertyAccessExpression(left) || ts.isElementAccessExpression(left)
    ? left.expression
    : left;

const propagateAssignment = (analysis, node) => {
  if (!isAssignmentExpression(node)) {
    return false;
  }
  const aliasChanged = propagateStateSetterAlias(analysis, node.left, node.right);
  const bindingChanged = expressionIsTainted(analysis, node.right)
    ? addBindingsFromPattern(analysis, assignmentBindingTarget(node.left))
    : false;
  return aliasChanged || bindingChanged;
};

const propagateStateSetterCall = (analysis, binding, arguments_) => {
  const stateBinding = analysis.stateBySetter.get(binding);
  if (!stateBinding || !arguments_.some((argument) => expressionIsTainted(analysis, argument))) {
    return false;
  }
  return addBinding(analysis, stateBinding);
};

const propagateFunctionArguments = (analysis, binding, arguments_) => {
  const targetFunction = functionFromBinding(analysis, binding);
  if (!targetFunction) {
    return false;
  }
  let changed = false;
  for (const [index, argument] of arguments_.entries()) {
    const parameter = targetFunction.parameters[index];
    if (
      parameter &&
      expressionIsTainted(analysis, argument) &&
      addBindingsFromPattern(analysis, parameter.name)
    ) {
      changed = true;
    }
  }
  return changed;
};

const propagateCall = (analysis, node) => {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) {
    return false;
  }
  const binding = getBinding(analysis, node.expression);
  const stateChanged = propagateStateSetterCall(analysis, binding, node.arguments);
  const argumentsChanged = propagateFunctionArguments(analysis, binding, node.arguments);
  return stateChanged || argumentsChanged;
};

const propagateReturn = (analysis, node) => {
  if (!ts.isReturnStatement(node) || !node.expression) {
    return false;
  }
  const functionNode = getFunctionParent(node);
  const binding = functionNode ? bindingFromFunction(analysis, functionNode) : null;
  if (
    !binding ||
    analysis.taintedFunctions.has(binding) ||
    !expressionIsTainted(analysis, node.expression)
  ) {
    return false;
  }
  analysis.taintedFunctions.add(binding);
  return true;
};

const propagateVariable = (analysis, node) => {
  if (!ts.isVariableDeclaration(node) || !node.initializer) {
    return false;
  }
  const aliasChanged = propagateStateSetterAlias(analysis, node.name, node.initializer);
  const bindingChanged = expressionIsTainted(analysis, node.initializer)
    ? addBindingsFromPattern(analysis, node.name)
    : false;
  return aliasChanged || bindingChanged;
};

const TAINT_PROPAGATORS = [
  propagateExpressionArrow,
  propagateAssignment,
  propagateCall,
  propagateReturn,
  propagateVariable,
];

const propagateTaintPass = (analysis, sourceFile) => {
  let changed = false;
  visitDescendants(sourceFile, (node) => {
    for (const propagate of TAINT_PROPAGATORS) {
      if (propagate(analysis, node)) {
        changed = true;
      }
    }
  });
  return changed;
};

const propagateTaintToFixedPoint = (analysis, sourceFile, fileName) => {
  let changed = true;
  let iterations = 0;
  while (changed && iterations < 100) {
    changed = propagateTaintPass(analysis, sourceFile);
    iterations += 1;
  }
  if (changed) {
    throw new Error(`Error-reporting boundary analysis did not converge for ${fileName}`);
  }
};

const isOperationalKindAttribute = (property) =>
  ts.isJsxAttribute(property) &&
  ts.isIdentifier(property.name) &&
  property.name.text === 'kind' &&
  property.initializer &&
  ts.isStringLiteral(property.initializer) &&
  property.initializer.text === 'operational';

const isTaintedErrorAttribute = (property, isExpressionTainted) =>
  ts.isJsxAttribute(property) &&
  ts.isIdentifier(property.name) &&
  property.name.text === 'error' &&
  property.initializer &&
  ts.isJsxExpression(property.initializer) &&
  property.initializer.expression &&
  isExpressionTainted(property.initializer.expression);

const analyzeInlineErrorBoundaryViolations = ({ checker, project, sourceFile }, fileName) => {
  const analysis = createTaintAnalysis({ checker, project });
  seedTaintSources(analysis, sourceFile);
  propagateTaintToFixedPoint(analysis, sourceFile, fileName);

  const expressionIsTaintedInAnalysis = (node) => expressionIsTainted(analysis, node);
  const getBindingInAnalysis = (node) => getBinding(analysis, node);

  const isCanonicalErrorSurface = (openingElement) => {
    if (!isJsxOpeningLikeElement(openingElement)) {
      return false;
    }
    const tag = openingElement.tagName;
    return (
      ts.isIdentifier(tag) &&
      tag.text === ERROR_SURFACE &&
      importModuleForSymbol(getBindingInAnalysis(tag), project) === ERROR_SURFACE_MODULE
    );
  };

  const isOperationalErrorSurface = (openingElement) => {
    if (!isJsxOpeningLikeElement(openingElement)) {
      return false;
    }
    const attributes = openingElement.attributes.properties;
    return (
      attributes.some(isOperationalKindAttribute) &&
      attributes.some((property) =>
        isTaintedErrorAttribute(property, expressionIsTaintedInAnalysis)
      )
    );
  };

  const containsOperationalErrorSurface = (root) => {
    let found = false;
    visitDescendants(root, (node) => {
      if (
        !found &&
        isJsxOpeningLikeElement(node) &&
        isCanonicalErrorSurface(node) &&
        isOperationalErrorSurface(node)
      ) {
        found = true;
      }
    });
    return found;
  };

  const renderedBranchIsClassified = (rawNode) => {
    const node = unwrap(rawNode);
    if (!node || !expressionIsTaintedInAnalysis(node)) {
      return true;
    }
    if (ts.isJsxElement(node) || ts.isJsxFragment(node) || ts.isJsxSelfClosingElement(node)) {
      return containsOperationalErrorSurface(node);
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      return renderedBranchIsClassified(node.right);
    }
    if (ts.isConditionalExpression(node)) {
      return (
        renderedBranchIsClassified(node.whenTrue) && renderedBranchIsClassified(node.whenFalse)
      );
    }
    return false;
  };

  const violations = [];
  visitDescendants(sourceFile, (node) => {
    if (
      !ts.isJsxExpression(node) ||
      !node.expression ||
      !expressionIsTaintedInAnalysis(node.expression)
    ) {
      return;
    }
    if (renderedBranchIsClassified(node.expression)) {
      return;
    }
    const attribute = node.parent;
    const openingElement = ts.isJsxAttribute(attribute) ? attribute.parent.parent : null;
    if (
      openingElement &&
      isCanonicalErrorSurface(openingElement) &&
      isOperationalErrorSurface(openingElement)
    ) {
      return;
    }

    const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    violations.push({
      column: location.character + 1,
      fileName,
      line: location.line + 1,
      message:
        'Render error-derived text through ErrorSurface so the original exception crosses the reporting boundary.',
    });
  });
  return violations;
};

export const findInlineErrorBoundaryViolations = (source, fileName = 'source.tsx') => {
  if (isErrorOwner(fileName)) {
    return [];
  }
  const parsed = parseTsx(source, fileName);
  try {
    return analyzeInlineErrorBoundaryViolations(parsed, fileName);
  } finally {
    parsed.dispose();
  }
};

const collectFiles = (directory) => {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(entryPath));
    } else if (isProductionTsx(entryPath)) {
      files.push(entryPath);
    }
  }
  return files;
};

export const checkErrorReportingBoundaries = (sourceDirectory) => {
  const configFileName = path.resolve(process.cwd(), 'tsconfig.json');
  const api = getTypeScriptAPI();
  const snapshot = api.updateSnapshot({ openProjects: [configFileName] });
  try {
    const project = snapshot
      .getProjects()
      .find((candidate) => path.resolve(candidate.configFileName) === configFileName);
    if (!project) {
      throw new Error(`Unable to load the TypeScript project at ${configFileName}`);
    }
    return collectFiles(sourceDirectory).flatMap((fileName) => {
      const sourceFile = project.program.getSourceFile(path.resolve(fileName));
      if (!sourceFile) {
        throw new Error(`Unable to load ${fileName} from the TypeScript project`);
      }
      return analyzeInlineErrorBoundaryViolations(
        { checker: project.checker, project, sourceFile },
        fileName
      );
    });
  } finally {
    snapshot.dispose();
    api.updateSnapshot({ closeProjects: [configFileName] }).dispose();
  }
};

const isMain =
  process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const sourceDirectory = path.resolve(process.cwd(), 'src');
  const violations = checkErrorReportingBoundaries(sourceDirectory);
  if (violations.length > 0) {
    for (const violation of violations) {
      const relativeFile = path.relative(process.cwd(), violation.fileName);
      console.error(`${relativeFile}:${violation.line}:${violation.column} ${violation.message}`);
    }
    process.exitCode = 1;
  }
}
