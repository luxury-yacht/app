/**
 * frontend/src/utils/inputAssistPolicy.ts
 *
 * Enforces a global "no typing assistance" policy across the app so inputs do
 * not enable autocomplete, autocorrect, autocapitalization, or spellcheck.
 */

const INPUT_ASSIST_SELECTOR = 'input, textarea, [contenteditable]:not([contenteditable="false"])';

const disableTypingAssists = (element: Element): void => {
  if (!(element instanceof HTMLElement)) {
    return;
  }

  element.setAttribute('autocapitalize', 'off');
  element.setAttribute('autocomplete', 'off');
  element.setAttribute('autocorrect', 'off');
  element.spellcheck = false;

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    element.autocapitalize = 'off';
    element.autocomplete = 'off';
  }
};

const applyTypingAssistPolicyToNode = (node: Node): void => {
  if (!(node instanceof Element)) {
    return;
  }

  if (node.matches(INPUT_ASSIST_SELECTOR)) {
    disableTypingAssists(node);
  }

  node.querySelectorAll(INPUT_ASSIST_SELECTOR).forEach(disableTypingAssists);
};

export const applyTypingAssistPolicy = (root: ParentNode = document): void => {
  root.querySelectorAll(INPUT_ASSIST_SELECTOR).forEach(disableTypingAssists);
};

export const installTypingAssistPolicyObserver = (
  root: ParentNode = document.body
): (() => void) => {
  applyTypingAssistPolicy(root);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach(applyTypingAssistPolicyToNode);
        continue;
      }
      if (mutation.type === 'attributes' && mutation.target instanceof Element) {
        applyTypingAssistPolicyToNode(mutation.target);
      }
    }
  });

  observer.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['contenteditable'],
  });

  return () => observer.disconnect();
};
