package backend

func (s *DesktopShell) presentExpiredBetaPrompt(prompt expiredBetaPrompt) {
	if s == nil || s.application == nil {
		return
	}
	dialog := s.application.Dialog.Question().SetTitle(prompt.Title).SetMessage(prompt.Message)
	download := dialog.AddButton(prompt.DownloadLabel).SetAsDefault().OnClick(prompt.OnDownload)
	quit := dialog.AddButton(prompt.QuitLabel).SetAsCancel().OnClick(prompt.OnQuit)
	dialog.SetDefaultButton(download).SetCancelButton(quit)
	if window, err := s.workspaceWindow(prompt.WindowName); err == nil {
		dialog.AttachToWindow(window)
	}
	dialog.Show()
}
