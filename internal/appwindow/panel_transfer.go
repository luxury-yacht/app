package appwindow

import "github.com/luxury-yacht/app/internal/panelwindow"

const PanelGroupSchemaVersion = panelwindow.GroupSchemaVersion
const PanelTabKindObject = panelwindow.TabKindObject

type PanelTabKind = panelwindow.TabKind
type PanelObjectReference = panelwindow.ObjectReference
type PanelTabSnapshot = panelwindow.TabSnapshot
type PanelGroupSnapshot = panelwindow.GroupSnapshot

const PanelWindowOpenedEventName = panelwindow.WindowOpenedEventName
const PanelWindowDockRequestedEventName = panelwindow.WindowDockRequestedEventName
const PanelWindowObjectOpenRequestedEventName = panelwindow.ObjectOpenRequestedEventName

type PanelWindowObjectOpenRequestEvent = panelwindow.ObjectOpenRequestEvent

func ValidatePanelGroupSnapshot(snapshot PanelGroupSnapshot) error {
	return panelwindow.ValidateGroupSnapshot(snapshot)
}
