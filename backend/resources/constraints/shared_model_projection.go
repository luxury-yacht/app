package constraints

import (
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/types"
)

func limitRangeItemsFromFacts(facts []resourcemodel.LimitRangeItemFacts) []types.LimitRangeItem {
	if len(facts) == 0 {
		return nil
	}
	result := make([]types.LimitRangeItem, 0, len(facts))
	for _, fact := range facts {
		result = append(result, types.LimitRangeItem{
			Kind:                 fact.Kind,
			Max:                  quantityMapStrings(fact.Max),
			Min:                  quantityMapStrings(fact.Min),
			Default:              quantityMapStrings(fact.Default),
			DefaultRequest:       quantityMapStrings(fact.DefaultRequest),
			MaxLimitRequestRatio: quantityMapStrings(fact.MaxLimitRequestRatio),
		})
	}
	return result
}

func scopeSelectorFromFacts(facts *resourcemodel.ScopeSelectorFacts) *types.ScopeSelector {
	if facts == nil {
		return nil
	}
	selector := &types.ScopeSelector{}
	for _, expr := range facts.MatchExpressions {
		selector.MatchExpressions = append(selector.MatchExpressions, types.ScopeSelectorRequirement{
			ScopeName: expr.ScopeName,
			Operator:  expr.Operator,
			Values:    append([]string(nil), expr.Values...),
		})
	}
	return selector
}

func quantityMapStrings(values resourcemodel.ResourceQuantityMapFacts) map[string]string {
	if len(values) == 0 {
		return nil
	}
	result := make(map[string]string, len(values))
	for key, value := range values {
		result[key] = value.String()
	}
	return result
}

func copyIntMap(values map[string]int) map[string]int {
	if len(values) == 0 {
		return nil
	}
	result := make(map[string]int, len(values))
	for key, value := range values {
		result[key] = value
	}
	return result
}
