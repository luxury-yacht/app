package types

import "github.com/luxury-yacht/app/backend/resourcemodel"

func ObjectRefFromResourceRef(ref resourcemodel.ResourceRef) ObjectRef {
	return ObjectRef{
		ClusterID: ref.ClusterID,
		Group:     ref.Group,
		Version:   ref.Version,
		Kind:      ref.Kind,
		Namespace: ref.Namespace,
		Name:      ref.Name,
	}
}

func DisplayRefFromResourceDisplay(ref resourcemodel.DisplayRef) DisplayRef {
	return DisplayRef{
		ClusterID: ref.ClusterID,
		Group:     ref.Group,
		Kind:      ref.Kind,
		Namespace: ref.Namespace,
		Name:      ref.Name,
	}
}

func RefOrDisplayFromResourceLink(link resourcemodel.ResourceLink) RefOrDisplay {
	if link.Ref != nil {
		ref := ObjectRefFromResourceRef(*link.Ref)
		return RefOrDisplay{Ref: &ref}
	}
	if link.Display != nil {
		display := DisplayRefFromResourceDisplay(*link.Display)
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
