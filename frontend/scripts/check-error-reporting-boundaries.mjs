import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
// biome-ignore lint/correctness/noUnresolvedImports: Node resolves this CommonJS package's main entry; Biome 2.5 does not.
import traverseModule from '@babel/traverse';

const traverse = traverseModule.default ?? traverseModule;
const ERROR_CONSTRUCTORS = new Set(['AggregateError', 'DOMException', 'Error']);
const ERROR_HANDLER_MODULES = new Set(['@/utils/errorHandler', '@utils/errorHandler']);
const ERROR_SURFACE = 'ErrorSurface';
const ERROR_SURFACE_MODULE = '@shared/components/errors/ErrorSurface';
const REPORTING_BOUNDARY_METHODS = new Set(['handle', 'handleInline', 'handleOperational']);
const REACT_STATE_HOOKS = new Set(['useReducer', 'useState']);

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

const getMemberName = (memberPath) => {
  const property = memberPath.get('property');
  if (property.isIdentifier() && !memberPath.node.computed) {
    return property.node.name;
  }
  if (property.isStringLiteral()) {
    return property.node.value;
  }
  return null;
};

const getBinding = (identifierPath) =>
  identifierPath.isIdentifier() ? identifierPath.scope.getBinding(identifierPath.node.name) : null;

const bindingFromFunction = (functionPath) => {
  if (functionPath.node.id && functionPath.get('id').isIdentifier()) {
    const identifier = functionPath.get('id');
    return identifier.scope.parent?.getBinding(identifier.node.name) ?? getBinding(identifier);
  }
  const parent = functionPath.parentPath;
  if (parent?.isVariableDeclarator() && parent.get('id').isIdentifier()) {
    return getBinding(parent.get('id'));
  }
  if (parent?.isAssignmentExpression() && parent.get('left').isIdentifier()) {
    return getBinding(parent.get('left'));
  }
  return null;
};

const functionFromBinding = (binding) => {
  if (!binding) {
    return null;
  }
  const bindingPath = binding.path;
  if (bindingPath.isFunctionDeclaration() || bindingPath.isFunctionExpression()) {
    return bindingPath;
  }
  if (bindingPath.parentPath?.isFunctionDeclaration()) {
    return bindingPath.parentPath;
  }
  if (bindingPath.isVariableDeclarator()) {
    const initializer = bindingPath.get('init');
    if (initializer.isArrowFunctionExpression() || initializer.isFunctionExpression()) {
      return initializer;
    }
  }
  return null;
};

const typeContainsError = (node, seen = new Set()) => {
  if (!node || typeof node !== 'object' || seen.has(node)) {
    return false;
  }
  seen.add(node);
  if (node.type === 'Identifier' && ERROR_CONSTRUCTORS.has(node.name)) {
    return true;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') {
      continue;
    }
    if (Array.isArray(value)) {
      if (value.some((item) => typeContainsError(item, seen))) {
        return true;
      }
    } else if (typeContainsError(value, seen)) {
      return true;
    }
  }
  return false;
};

const parseTsx = (source, fileName) =>
  parse(source, {
    sourceFilename: fileName,
    sourceType: 'module',
    plugins: ['jsx', 'typescript'],
  });

export const findInlineErrorBoundaryViolations = (source, fileName = 'source.tsx') => {
  if (isErrorOwner(fileName)) {
    return [];
  }

  const ast = parseTsx(source, fileName);
  const taintedBindings = new Set();
  const taintedFunctions = new Set();
  const stateBySetter = new Map();

  const addBinding = (binding) => {
    if (!binding || taintedBindings.has(binding)) {
      return false;
    }
    taintedBindings.add(binding);
    return true;
  };

  const addBindingsFromPattern = (patternPath) => {
    let changed = false;
    if (patternPath.isIdentifier()) {
      return addBinding(getBinding(patternPath));
    }
    if (patternPath.isAssignmentPattern()) {
      return addBindingsFromPattern(patternPath.get('left'));
    }
    if (patternPath.isRestElement()) {
      return addBindingsFromPattern(patternPath.get('argument'));
    }
    if (patternPath.isArrayPattern()) {
      for (const element of patternPath.get('elements')) {
        if (element.node && addBindingsFromPattern(element)) {
          changed = true;
        }
      }
      return changed;
    }
    if (patternPath.isObjectPattern()) {
      for (const property of patternPath.get('properties')) {
        const target = property.isRestElement() ? property.get('argument') : property.get('value');
        if (target?.node && addBindingsFromPattern(target)) {
          changed = true;
        }
      }
    }
    return changed;
  };

  const isReportingBoundaryCall = (callPath) => {
    const callee = callPath.get('callee');
    if (!(callee.isMemberExpression() || callee.isOptionalMemberExpression())) {
      return false;
    }
    const owner = callee.get('object');
    if (!owner.isIdentifier({ name: 'errorHandler' })) {
      return false;
    }
    const binding = owner.scope.getBinding('errorHandler');
    const importDeclaration = binding?.path.parentPath;
    return (
      binding?.path.isImportSpecifier() === true &&
      importDeclaration?.isImportDeclaration() === true &&
      ERROR_HANDLER_MODULES.has(importDeclaration.node.source.value) &&
      REPORTING_BOUNDARY_METHODS.has(getMemberName(callee))
    );
  };

  const unwrap = (expressionPath) => {
    let current = expressionPath;
    while (
      current?.node &&
      (current.isParenthesizedExpression() ||
        current.isTSAsExpression() ||
        current.isTSTypeAssertion() ||
        current.isTSNonNullExpression() ||
        current.isTSSatisfiesExpression())
    ) {
      current = current.get('expression');
    }
    return current;
  };

  const expressionIsTainted = (rawPath, seen = new Set()) => {
    const expressionPath = unwrap(rawPath);
    if (!expressionPath?.node || seen.has(expressionPath.node)) {
      return false;
    }
    seen.add(expressionPath.node);

    if (expressionPath.isIdentifier()) {
      return taintedBindings.has(getBinding(expressionPath));
    }
    if (expressionPath.isNewExpression()) {
      const callee = expressionPath.get('callee');
      return (
        (callee.isIdentifier() && ERROR_CONSTRUCTORS.has(callee.node.name)) ||
        expressionPath.get('arguments').some((argument) => expressionIsTainted(argument, seen))
      );
    }
    if (expressionPath.isMemberExpression() || expressionPath.isOptionalMemberExpression()) {
      return expressionIsTainted(expressionPath.get('object'), seen);
    }
    if (expressionPath.isCallExpression() || expressionPath.isOptionalCallExpression()) {
      const callee = expressionPath.get('callee');
      if (isReportingBoundaryCall(expressionPath)) {
        return false;
      }
      if (callee.isIdentifier()) {
        if (taintedFunctions.has(getBinding(callee))) {
          return true;
        }
        if (
          callee.node.name === 'String' &&
          expressionPath.get('arguments').some((argument) => expressionIsTainted(argument, seen))
        ) {
          return true;
        }
      }
      if (
        (callee.isMemberExpression() || callee.isOptionalMemberExpression()) &&
        expressionIsTainted(callee.get('object'), seen)
      ) {
        return true;
      }
      return expressionPath
        .get('arguments')
        .some((argument) => expressionIsTainted(argument, seen));
    }
    if (expressionPath.isConditionalExpression()) {
      return (
        expressionIsTainted(expressionPath.get('consequent'), seen) ||
        expressionIsTainted(expressionPath.get('alternate'), seen)
      );
    }
    if (expressionPath.isLogicalExpression() || expressionPath.isBinaryExpression()) {
      return (
        expressionIsTainted(expressionPath.get('left'), seen) ||
        expressionIsTainted(expressionPath.get('right'), seen)
      );
    }
    if (expressionPath.isTemplateLiteral()) {
      return expressionPath
        .get('expressions')
        .some((interpolation) => expressionIsTainted(interpolation, seen));
    }
    if (expressionPath.isArrayExpression()) {
      return expressionPath
        .get('elements')
        .some((element) => element.node && expressionIsTainted(element, seen));
    }
    if (expressionPath.isObjectExpression()) {
      return expressionPath.get('properties').some((property) => {
        if (property.isSpreadElement()) {
          return expressionIsTainted(property.get('argument'), seen);
        }
        return property.isObjectProperty() && expressionIsTainted(property.get('value'), seen);
      });
    }
    if (
      expressionPath.isAwaitExpression() ||
      expressionPath.isUnaryExpression() ||
      expressionPath.isYieldExpression()
    ) {
      const argument = expressionPath.get('argument');
      return argument?.node ? expressionIsTainted(argument, seen) : false;
    }
    if (expressionPath.isSequenceExpression()) {
      return expressionPath.get('expressions').some((item) => expressionIsTainted(item, seen));
    }
    return false;
  };

  traverse(ast, {
    CatchClause(catchPath) {
      const parameter = catchPath.get('param');
      if (parameter?.node) {
        addBindingsFromPattern(parameter);
      }
    },
    Function(functionPath) {
      for (const parameter of functionPath.get('params')) {
        if (typeContainsError(parameter.node.typeAnnotation)) {
          addBindingsFromPattern(parameter);
        }
      }
    },
    CallExpression(callPath) {
      const callee = callPath.get('callee');
      if (
        callee.isMemberExpression() &&
        (getMemberName(callee) === 'catch' || getMemberName(callee) === 'then')
      ) {
        const handlerIndex = getMemberName(callee) === 'then' ? 1 : 0;
        const rejectionHandler = callPath.get('arguments')[handlerIndex];
        if (!rejectionHandler?.isFunction()) {
          return;
        }
        const firstParameter = rejectionHandler.get('params')[0];
        if (firstParameter?.node) {
          addBindingsFromPattern(firstParameter);
        }
      }
    },
    VariableDeclarator(declarationPath) {
      const initializer = declarationPath.get('init');
      const identifier = declarationPath.get('id');
      const callee = initializer.isCallExpression() ? initializer.get('callee') : null;
      const hookName = callee?.isIdentifier()
        ? callee.node.name
        : callee?.isMemberExpression()
          ? getMemberName(callee)
          : null;
      if (
        identifier.isArrayPattern() &&
        initializer.isCallExpression() &&
        hookName !== null &&
        REACT_STATE_HOOKS.has(hookName)
      ) {
        const [state, setter] = identifier.get('elements');
        if (state?.isIdentifier() && setter?.isIdentifier()) {
          const setterBinding = getBinding(setter);
          const stateBinding = getBinding(state);
          if (setterBinding && stateBinding) {
            stateBySetter.set(setterBinding, stateBinding);
          }
        }
      }
    },
  });

  let changed = true;
  let iterations = 0;
  while (changed && iterations < 100) {
    changed = false;
    iterations += 1;
    traverse(ast, {
      ArrowFunctionExpression(functionPath) {
        const body = functionPath.get('body');
        const functionBinding = bindingFromFunction(functionPath);
        if (
          !body.isBlockStatement() &&
          functionBinding &&
          expressionIsTainted(body) &&
          !taintedFunctions.has(functionBinding)
        ) {
          taintedFunctions.add(functionBinding);
          changed = true;
        }
      },
      AssignmentExpression(assignmentPath) {
        const left = assignmentPath.get('left');
        const right = assignmentPath.get('right');
        if (left.isIdentifier() && right.isIdentifier()) {
          const stateBinding = stateBySetter.get(getBinding(right));
          const aliasBinding = getBinding(left);
          if (stateBinding && aliasBinding && !stateBySetter.has(aliasBinding)) {
            stateBySetter.set(aliasBinding, stateBinding);
            changed = true;
          }
        }
        if (expressionIsTainted(right)) {
          const target = left.isMemberExpression() ? left.get('object') : left;
          if (addBindingsFromPattern(target)) {
            changed = true;
          }
        }
      },
      CallExpression(callPath) {
        const callee = callPath.get('callee');
        if (callee.isIdentifier()) {
          const calleeBinding = getBinding(callee);
          const stateBinding = stateBySetter.get(calleeBinding);
          if (
            stateBinding &&
            callPath.get('arguments').some((argument) => expressionIsTainted(argument)) &&
            addBinding(stateBinding)
          ) {
            changed = true;
          }

          const targetFunction = functionFromBinding(calleeBinding);
          if (targetFunction) {
            const parameters = targetFunction.get('params');
            for (const [index, argument] of callPath.get('arguments').entries()) {
              if (
                parameters[index]?.node &&
                expressionIsTainted(argument) &&
                addBindingsFromPattern(parameters[index])
              ) {
                changed = true;
              }
            }
          }
        }
      },
      ReturnStatement(returnPath) {
        const argument = returnPath.get('argument');
        const functionPath = returnPath.getFunctionParent();
        const functionBinding = functionPath ? bindingFromFunction(functionPath) : null;
        if (
          argument?.node &&
          functionBinding &&
          expressionIsTainted(argument) &&
          !taintedFunctions.has(functionBinding)
        ) {
          taintedFunctions.add(functionBinding);
          changed = true;
        }
      },
      VariableDeclarator(declarationPath) {
        const initializer = declarationPath.get('init');
        const identifier = declarationPath.get('id');
        if (initializer?.isIdentifier() && identifier.isIdentifier()) {
          const stateBinding = stateBySetter.get(getBinding(initializer));
          const aliasBinding = getBinding(identifier);
          if (stateBinding && aliasBinding && !stateBySetter.has(aliasBinding)) {
            stateBySetter.set(aliasBinding, stateBinding);
            changed = true;
          }
        }
        if (
          initializer?.node &&
          expressionIsTainted(initializer) &&
          addBindingsFromPattern(identifier)
        ) {
          changed = true;
        }
      },
    });
  }
  if (changed) {
    throw new Error(`Error-reporting boundary analysis did not converge for ${fileName}`);
  }

  const isOperationalErrorSurface = (openingPath) => {
    if (!openingPath?.isJSXOpeningElement()) {
      return false;
    }
    let operational = false;
    let preservesOriginalError = false;
    for (const attribute of openingPath.get('attributes')) {
      if (!attribute.isJSXAttribute() || !attribute.get('name').isJSXIdentifier()) {
        continue;
      }
      const attributeName = attribute.get('name').node.name;
      const value = attribute.get('value');
      if (attributeName === 'kind' && value.isStringLiteral({ value: 'operational' })) {
        operational = true;
      }
      if (
        attributeName === 'error' &&
        value.isJSXExpressionContainer() &&
        expressionIsTainted(value.get('expression'))
      ) {
        preservesOriginalError = true;
      }
    }
    return operational && preservesOriginalError;
  };

  const isCanonicalErrorSurface = (openingPath) => {
    if (!openingPath?.isJSXOpeningElement()) {
      return false;
    }
    const tag = openingPath.get('name');
    if (!tag.isJSXIdentifier({ name: ERROR_SURFACE })) {
      return false;
    }
    const binding = openingPath.scope.getBinding(ERROR_SURFACE);
    const importDeclaration = binding?.path.parentPath;
    return (
      binding?.path.isImportSpecifier() === true &&
      importDeclaration?.isImportDeclaration() === true &&
      importDeclaration.node.source.value === ERROR_SURFACE_MODULE
    );
  };

  const containsOperationalErrorSurface = (rootPath) => {
    if (!rootPath?.node) {
      return false;
    }
    if (rootPath.isJSXElement()) {
      const openingElement = rootPath.get('openingElement');
      if (isCanonicalErrorSurface(openingElement) && isOperationalErrorSurface(openingElement)) {
        return true;
      }
    }
    let found = false;
    rootPath.traverse({
      JSXOpeningElement(openingPath) {
        if (isCanonicalErrorSurface(openingPath) && isOperationalErrorSurface(openingPath)) {
          found = true;
          openingPath.stop();
        }
      },
    });
    return found;
  };

  const renderedBranchIsClassified = (rawPath) => {
    const branchPath = unwrap(rawPath);
    if (!branchPath?.node || !expressionIsTainted(branchPath)) {
      return true;
    }
    if (branchPath.isJSXElement() || branchPath.isJSXFragment()) {
      return containsOperationalErrorSurface(branchPath);
    }
    if (branchPath.isLogicalExpression() && branchPath.node.operator === '&&') {
      return renderedBranchIsClassified(branchPath.get('right'));
    }
    if (branchPath.isConditionalExpression()) {
      return (
        renderedBranchIsClassified(branchPath.get('consequent')) &&
        renderedBranchIsClassified(branchPath.get('alternate'))
      );
    }
    return false;
  };

  const violations = [];
  traverse(ast, {
    JSXExpressionContainer(containerPath) {
      const expression = containerPath.get('expression');
      if (!expression?.node || !expressionIsTainted(expression)) {
        return;
      }

      if (renderedBranchIsClassified(expression)) {
        return;
      }

      const attribute = containerPath.parentPath;
      if (attribute?.isJSXAttribute()) {
        const openingElement = attribute.parentPath;
        if (
          openingElement?.isJSXOpeningElement() &&
          isCanonicalErrorSurface(openingElement) &&
          isOperationalErrorSurface(openingElement)
        ) {
          return;
        }
      }

      const location = containerPath.node.loc?.start ?? { line: 1, column: 0 };
      violations.push({
        column: location.column + 1,
        fileName,
        line: location.line,
        message:
          'Render error-derived text through ErrorSurface so the original exception crosses the reporting boundary.',
      });
    },
  });
  return violations;
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

export const checkErrorReportingBoundaries = (sourceDirectory) =>
  collectFiles(sourceDirectory).flatMap((fileName) =>
    findInlineErrorBoundaryViolations(readFileSync(fileName, 'utf8'), fileName)
  );

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
