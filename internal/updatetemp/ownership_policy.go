package updatetemp

func ownerSIDIsCurrentUser(pathOwnerSID, tokenUserSID string) bool {
	return pathOwnerSID != "" && pathOwnerSID == tokenUserSID
}
