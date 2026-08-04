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

const analyzeInlineErrorBoundaryViolations = ({ checker, project, sourceFile }, fileName) => {
  const taintedBindings = new Set();
  const taintedFunctions = new Set();
  const stateBySetter = new Map();

  const getBinding = (node) => (ts.isIdentifier(node) ? checker.getSymbolAtLocation(node) : null);

  const addBinding = (binding) => {
    if (!binding || taintedBindings.has(binding)) {
      return false;
    }
    taintedBindings.add(binding);
    return true;
  };

  const addBindingsFromPattern = (rawNode) => {
    const node = unwrap(rawNode);
    if (!node) {
      return false;
    }
    if (ts.isIdentifier(node)) {
      return addBinding(getBinding(node));
    }
    if (ts.isBindingElement(node)) {
      return addBindingsFromPattern(node.name);
    }
    if (ts.isArrayBindingPattern(node) || ts.isArrayLiteralExpression(node)) {
      let changed = false;
      for (const element of node.elements) {
        if (!ts.isOmittedExpression(element) && addBindingsFromPattern(element)) {
          changed = true;
        }
      }
      return changed;
    }
    if (ts.isObjectBindingPattern(node)) {
      let changed = false;
      for (const element of node.elements) {
        if (addBindingsFromPattern(element.name)) {
          changed = true;
        }
      }
      return changed;
    }
    if (ts.isObjectLiteralExpression(node)) {
      let changed = false;
      for (const property of node.properties) {
        const target = ts.isPropertyAssignment(property)
          ? property.initializer
          : ts.isShorthandPropertyAssignment(property)
            ? property.name
            : ts.isSpreadAssignment(property)
              ? property.expression
              : null;
        if (target && addBindingsFromPattern(target)) {
          changed = true;
        }
      }
      return changed;
    }
    if (ts.isSpreadElement(node) || ts.isSpreadAssignment(node)) {
      return addBindingsFromPattern(node.expression);
    }
    return false;
  };

  const bindingFromFunction = (node) => {
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.name) {
      return getBinding(node.name);
    }
    const parent = node.parent;
    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
      return getBinding(parent.name);
    }
    if (parent && isAssignmentExpression(parent) && ts.isIdentifier(parent.left)) {
      return getBinding(parent.left);
    }
    return null;
  };

  const functionFromBinding = (binding) => {
    for (const handle of binding?.declarations ?? []) {
      const declaration = handle.resolve(project);
      if (!declaration) {
        continue;
      }
      if (ts.isFunctionDeclaration(declaration) || ts.isFunctionExpression(declaration)) {
        return declaration;
      }
      if (
        ts.isVariableDeclaration(declaration) &&
        declaration.initializer &&
        (ts.isArrowFunction(declaration.initializer) ||
          ts.isFunctionExpression(declaration.initializer))
      ) {
        return declaration.initializer;
      }
    }
    return null;
  };

  const isReportingBoundaryCall = (node) => {
    const callee = node.expression;
    const owner = getMemberOwner(callee);
    if (!owner || !ts.isIdentifier(owner) || owner.text !== 'errorHandler') {
      return false;
    }
    return (
      ERROR_HANDLER_MODULES.has(importModuleForSymbol(getBinding(owner), project)) &&
      REPORTING_BOUNDARY_METHODS.has(getMemberName(callee))
    );
  };

  const expressionIsTainted = (rawNode, seen = new Set()) => {
    const node = unwrap(rawNode);
    if (!node || seen.has(node)) {
      return false;
    }
    seen.add(node);

    if (ts.isIdentifier(node)) {
      return taintedBindings.has(getBinding(node));
    }
    if (ts.isNewExpression(node)) {
      return (
        (ts.isIdentifier(node.expression) && ERROR_CONSTRUCTORS.has(node.expression.text)) ||
        (node.arguments ?? []).some((argument) => expressionIsTainted(argument, seen))
      );
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      return expressionIsTainted(node.expression, seen);
    }
    if (ts.isCallExpression(node)) {
      if (isReportingBoundaryCall(node)) {
        return false;
      }
      const callee = node.expression;
      if (ts.isIdentifier(callee)) {
        if (taintedFunctions.has(getBinding(callee))) {
          return true;
        }
        if (
          callee.text === 'String' &&
          node.arguments.some((argument) => expressionIsTainted(argument, seen))
        ) {
          return true;
        }
      }
      const owner = getMemberOwner(callee);
      if (owner && expressionIsTainted(owner, seen)) {
        return true;
      }
      return node.arguments.some((argument) => expressionIsTainted(argument, seen));
    }
    if (ts.isConditionalExpression(node)) {
      return expressionIsTainted(node.whenTrue, seen) || expressionIsTainted(node.whenFalse, seen);
    }
    if (ts.isBinaryExpression(node)) {
      return expressionIsTainted(node.left, seen) || expressionIsTainted(node.right, seen);
    }
    if (ts.isTemplateExpression(node)) {
      return node.templateSpans.some((span) => expressionIsTainted(span.expression, seen));
    }
    if (ts.isArrayLiteralExpression(node)) {
      return node.elements.some((element) => expressionIsTainted(element, seen));
    }
    if (ts.isObjectLiteralExpression(node)) {
      return node.properties.some((property) => {
        if (ts.isSpreadAssignment(property)) {
          return expressionIsTainted(property.expression, seen);
        }
        if (ts.isPropertyAssignment(property)) {
          return expressionIsTainted(property.initializer, seen);
        }
        return ts.isShorthandPropertyAssignment(property)
          ? expressionIsTainted(property.name, seen)
          : false;
      });
    }
    if (
      ts.isAwaitExpression(node) ||
      ts.isPrefixUnaryExpression(node) ||
      ts.isPostfixUnaryExpression(node) ||
      ts.isYieldExpression(node)
    ) {
      return node.expression ? expressionIsTainted(node.expression, seen) : false;
    }
    if (ts.isSpreadElement(node)) {
      return expressionIsTainted(node.expression, seen);
    }
    return false;
  };

  visitDescendants(sourceFile, (node) => {
    if (ts.isCatchClause(node) && node.variableDeclaration) {
      addBindingsFromPattern(node.variableDeclaration.name);
    }
    if (isFunctionLikeNode(node)) {
      for (const parameter of node.parameters) {
        if (typeContainsError(parameter.type)) {
          addBindingsFromPattern(parameter.name);
        }
      }
    }
    if (ts.isCallExpression(node)) {
      const memberName = getMemberName(node.expression);
      if (memberName === 'catch' || memberName === 'then') {
        const handlerIndex = memberName === 'then' ? 1 : 0;
        const rejectionHandler = node.arguments[handlerIndex];
        if (rejectionHandler && isFunctionLikeNode(rejectionHandler)) {
          const firstParameter = rejectionHandler.parameters[0];
          if (firstParameter) {
            addBindingsFromPattern(firstParameter.name);
          }
        }
      }
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isArrayBindingPattern(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    ) {
      const callee = node.initializer.expression;
      const hookName = ts.isIdentifier(callee) ? callee.text : getMemberName(callee);
      if (hookName && REACT_STATE_HOOKS.has(hookName)) {
        const [stateElement, setterElement] = node.name.elements;
        const state =
          stateElement && !ts.isOmittedExpression(stateElement) ? stateElement.name : null;
        const setter =
          setterElement && !ts.isOmittedExpression(setterElement) ? setterElement.name : null;
        if (state && setter && ts.isIdentifier(state) && ts.isIdentifier(setter)) {
          const stateBinding = getBinding(state);
          const setterBinding = getBinding(setter);
          if (stateBinding && setterBinding) {
            stateBySetter.set(setterBinding, stateBinding);
          }
        }
      }
    }
  });

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

  let changed = true;
  let iterations = 0;
  while (changed && iterations < 100) {
    changed = false;
    iterations += 1;
    visitDescendants(sourceFile, (node) => {
      if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) {
        const binding = bindingFromFunction(node);
        if (binding && expressionIsTainted(node.body) && !taintedFunctions.has(binding)) {
          taintedFunctions.add(binding);
          changed = true;
        }
      }

      if (isAssignmentExpression(node)) {
        if (ts.isIdentifier(node.left) && ts.isIdentifier(node.right)) {
          const stateBinding = stateBySetter.get(getBinding(node.right));
          const aliasBinding = getBinding(node.left);
          if (stateBinding && aliasBinding && !stateBySetter.has(aliasBinding)) {
            stateBySetter.set(aliasBinding, stateBinding);
            changed = true;
          }
        }
        if (expressionIsTainted(node.right)) {
          const target =
            ts.isPropertyAccessExpression(node.left) || ts.isElementAccessExpression(node.left)
              ? node.left.expression
              : node.left;
          if (addBindingsFromPattern(target)) {
            changed = true;
          }
        }
      }

      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const calleeBinding = getBinding(node.expression);
        const stateBinding = stateBySetter.get(calleeBinding);
        if (
          stateBinding &&
          node.arguments.some((argument) => expressionIsTainted(argument)) &&
          addBinding(stateBinding)
        ) {
          changed = true;
        }

        const targetFunction = functionFromBinding(calleeBinding);
        if (targetFunction) {
          for (const [index, argument] of node.arguments.entries()) {
            const parameter = targetFunction.parameters[index];
            if (
              parameter &&
              expressionIsTainted(argument) &&
              addBindingsFromPattern(parameter.name)
            ) {
              changed = true;
            }
          }
        }
      }

      if (ts.isReturnStatement(node) && node.expression) {
        const functionNode = getFunctionParent(node);
        const binding = functionNode ? bindingFromFunction(functionNode) : null;
        if (binding && expressionIsTainted(node.expression) && !taintedFunctions.has(binding)) {
          taintedFunctions.add(binding);
          changed = true;
        }
      }

      if (ts.isVariableDeclaration(node) && node.initializer) {
        if (ts.isIdentifier(node.initializer) && ts.isIdentifier(node.name)) {
          const stateBinding = stateBySetter.get(getBinding(node.initializer));
          const aliasBinding = getBinding(node.name);
          if (stateBinding && aliasBinding && !stateBySetter.has(aliasBinding)) {
            stateBySetter.set(aliasBinding, stateBinding);
            changed = true;
          }
        }
        if (expressionIsTainted(node.initializer) && addBindingsFromPattern(node.name)) {
          changed = true;
        }
      }
    });
  }
  if (changed) {
    throw new Error(`Error-reporting boundary analysis did not converge for ${fileName}`);
  }

  const isCanonicalErrorSurface = (openingElement) => {
    if (!isJsxOpeningLikeElement(openingElement)) {
      return false;
    }
    const tag = openingElement.tagName;
    return (
      ts.isIdentifier(tag) &&
      tag.text === ERROR_SURFACE &&
      importModuleForSymbol(getBinding(tag), project) === ERROR_SURFACE_MODULE
    );
  };

  const isOperationalErrorSurface = (openingElement) => {
    if (!isJsxOpeningLikeElement(openingElement)) {
      return false;
    }
    let operational = false;
    let preservesOriginalError = false;
    for (const property of openingElement.attributes.properties) {
      if (!ts.isJsxAttribute(property) || !ts.isIdentifier(property.name)) {
        continue;
      }
      if (
        property.name.text === 'kind' &&
        property.initializer &&
        ts.isStringLiteral(property.initializer) &&
        property.initializer.text === 'operational'
      ) {
        operational = true;
      }
      if (
        property.name.text === 'error' &&
        property.initializer &&
        ts.isJsxExpression(property.initializer) &&
        property.initializer.expression &&
        expressionIsTainted(property.initializer.expression)
      ) {
        preservesOriginalError = true;
      }
    }
    return operational && preservesOriginalError;
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
    if (!node || !expressionIsTainted(node)) {
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
    if (!ts.isJsxExpression(node) || !node.expression || !expressionIsTainted(node.expression)) {
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
