package updatetemp

func ownerSIDCanBeMigrated(pathOwnerSID, tokenUserSID, tokenDefaultOwnerSID string) bool {
	return pathOwnerSID != "" && (pathOwnerSID == tokenUserSID || pathOwnerSID == tokenDefaultOwnerSID)
}
