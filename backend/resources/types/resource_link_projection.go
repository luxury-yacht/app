package types

import "github.com/luxury-yacht/app/backend/resourcemodel"

func RefOrDisplayFromResourceLink(link resourcemodel.ResourceLink) RefOrDisplay {
	if link.Ref != nil {
		ref := *link.Ref
		return RefOrDisplay{Ref: &ref}
	}
	if link.Display != nil {
		display := *link.Display
		return RefOrDisplay{Display: &display}
	}
	return RefOrDisplay{}
}

func RefOrDisplaySliceFromResourceLinks(links []resourcemodel.ResourceLink) []RefOrDisplay {
	if len(links) == 0 {
		return nil
	}
	refs := make([]RefOrDisplay, 0, len(links))
	for _, link := range links {
		refs = append(refs, RefOrDisplayFromResourceLink(link))
	}
	return refs
}

func ObjectRefsFromResourceLinks(links []resourcemodel.ResourceLink) []ObjectRef {
	if len(links) == 0 {
		return nil
	}
	refs := make([]ObjectRef, 0, len(links))
	for _, link := range links {
		if link.Ref == nil {
			continue
		}
		refs = append(refs, *link.Ref)
	}
	if len(refs) == 0 {
		return nil
	}
	return refs
}
