package domain

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/refresh"
)

// ParseDomainScope decodes raw against domainName's authored scope grammar
// (scopeContract in refresh-domain-contract.json).
func ParseDomainScope(domainName, raw string) (refresh.Scope, error) {
	policy, ok := authoredDomainPolicyByName[domainName]
	if !ok {
		return refresh.Scope{}, fmt.Errorf("unknown refresh domain %q", domainName)
	}
	scope, err := refresh.ParseScope(raw, policy.Scope)
	if err != nil {
		return refresh.Scope{}, fmt.Errorf("%s scope: %w", domainName, err)
	}
	return scope, nil
}

// ParseDomainScopeTail decodes the part of a scope after "<clusterId>|" against
// domainName's grammar. Snapshot builders use it; the refresh API has already
// validated the complete scope with ParseDomainScope.
func ParseDomainScopeTail(domainName, tail string) (refresh.ScopeSelector, string, error) {
	policy, ok := authoredDomainPolicyByName[domainName]
	if !ok {
		return refresh.ScopeSelector{}, "", fmt.Errorf("unknown refresh domain %q", domainName)
	}
	return parseTail(domainName, tail, policy.Scope)
}

// ParseDomainSelector decodes a scope tail that carries no query (a stream
// subscription or a typed-table base scope) against domainName's selectors.
func ParseDomainSelector(domainName, tail string) (refresh.ScopeSelector, error) {
	policy, ok := authoredDomainPolicyByName[domainName]
	if !ok {
		return refresh.ScopeSelector{}, fmt.Errorf("unknown refresh domain %q", domainName)
	}
	grammar := refresh.ScopeGrammar{Selectors: policy.Scope.Selectors, Query: refresh.ScopeQueryNone}
	selector, _, err := parseTail(domainName, tail, grammar)
	return selector, err
}

func parseTail(domainName, tail string, grammar refresh.ScopeGrammar) (refresh.ScopeSelector, string, error) {
	selector, query, err := refresh.ParseScopeTail(tail, grammar)
	if err != nil {
		return refresh.ScopeSelector{}, "", fmt.Errorf("%s scope: %w", domainName, err)
	}
	return selector, query, nil
}
