package appwindow

import "github.com/luxury-yacht/app/internal/panelwindow"

const NativeWindowDescriptorSchemaVersion = panelwindow.NativeDescriptorSchemaVersion

const (
	NativeWindowRoleWorkspace = panelwindow.NativeRoleWorkspace
	NativeWindowRolePanel     = panelwindow.NativeRolePanel
)

type NativeWindowRole = panelwindow.NativeRole
type WorkspaceWindowDescriptor = panelwindow.WorkspaceDescriptor
type NativeWindowDescriptor = panelwindow.NativeDescriptor
