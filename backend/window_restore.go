package backend

const (
	defaultWindowWidth          = 1200
	defaultWindowHeight         = 800
	minimumReachableTitleWidth  = 64
	minimumReachableTitleHeight = 24
	windowTitleHeight           = 40
)

type windowRect struct {
	x      int
	y      int
	width  int
	height int
}

func resolveWindowRestore(saved WindowSettings, workAreas []WindowWorkArea) (WindowGeometry, bool) {
	geometry := WindowGeometry{
		X:      saved.X,
		Y:      saved.Y,
		Width:  saved.Width,
		Height: saved.Height,
	}
	if geometry.Width <= 0 {
		geometry.Width = defaultWindowWidth
	}
	if geometry.Height <= 0 {
		geometry.Height = defaultWindowHeight
	}

	validAreas := make([]WindowWorkArea, 0, len(workAreas))
	for _, area := range workAreas {
		if area.Width > 0 && area.Height > 0 {
			validAreas = append(validAreas, area)
		}
	}
	if len(validAreas) == 0 {
		return geometry, false
	}

	savedRect := windowRect{x: saved.X, y: saved.Y, width: geometry.Width, height: geometry.Height}
	target, overlapsCurrentScreen := selectRestoreWorkArea(savedRect, validAreas)
	sizeChanged := geometry.Width > target.Width || geometry.Height > target.Height
	geometry.Width = min(geometry.Width, target.Width)
	geometry.Height = min(geometry.Height, target.Height)

	if !overlapsCurrentScreen {
		geometry.X = target.X + (target.Width-geometry.Width)/2
		geometry.Y = target.Y + (target.Height-geometry.Height)/2
		return geometry, true
	}

	restoredRect := windowRect{x: geometry.X, y: geometry.Y, width: geometry.Width, height: geometry.Height}
	if sizeChanged || !hasReachableTitleBar(restoredRect, target) {
		geometry.X = clamp(geometry.X, target.X, target.X+target.Width-geometry.Width)
		geometry.Y = clamp(geometry.Y, target.Y, target.Y+target.Height-geometry.Height)
	}
	return geometry, true
}

func selectRestoreWorkArea(saved windowRect, areas []WindowWorkArea) (WindowWorkArea, bool) {
	target := areas[0]
	for _, area := range areas {
		if area.Primary {
			target = area
			break
		}
	}

	bestIntersection := 0
	for _, area := range areas {
		intersection := intersectionArea(saved, workAreaRect(area))
		if intersection > bestIntersection {
			bestIntersection = intersection
			target = area
		}
	}
	return target, bestIntersection > 0
}

func hasReachableTitleBar(window windowRect, area WindowWorkArea) bool {
	titleHeight := min(window.height, windowTitleHeight)
	title := windowRect{x: window.x, y: window.y, width: window.width, height: titleHeight}
	intersection := intersect(title, workAreaRect(area))
	return intersection.width >= min(minimumReachableTitleWidth, title.width) &&
		intersection.height >= min(minimumReachableTitleHeight, title.height)
}

func workAreaRect(area WindowWorkArea) windowRect {
	return windowRect{x: area.X, y: area.Y, width: area.Width, height: area.Height}
}

func intersectionArea(a, b windowRect) int {
	intersection := intersect(a, b)
	return intersection.width * intersection.height
}

func intersect(a, b windowRect) windowRect {
	left := max(a.x, b.x)
	top := max(a.y, b.y)
	right := min(a.x+a.width, b.x+b.width)
	bottom := min(a.y+a.height, b.y+b.height)
	if right <= left || bottom <= top {
		return windowRect{}
	}
	return windowRect{x: left, y: top, width: right - left, height: bottom - top}
}

func clamp(value, lower, upper int) int {
	return min(max(value, lower), upper)
}
