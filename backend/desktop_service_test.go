package backend

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type recordingDesktopLifecycle struct {
	startupContext context.Context
	startupOptions application.ServiceOptions
	shutdowns      int
}

type desktopServiceContextKey struct{}

func (l *recordingDesktopLifecycle) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	l.startupContext = ctx
	l.startupOptions = options
	return nil
}

func (l *recordingDesktopLifecycle) ServiceShutdown() error {
	l.shutdowns++
	return nil
}

type recordingFavoritesCommands struct {
	added Favorite
}

func (f *recordingFavoritesCommands) AddFavorite(favorite Favorite) (Favorite, error) {
	f.added = favorite
	return favorite, nil
}

func (*recordingFavoritesCommands) DeleteFavorite(string) error       { return nil }
func (*recordingFavoritesCommands) GetFavorites() ([]Favorite, error) { return nil, nil }
func (*recordingFavoritesCommands) SetFavoriteOrder([]string) error   { return nil }
func (*recordingFavoritesCommands) UpdateFavorite(Favorite) error     { return nil }

func TestDesktopServiceDelegatesLifecycleHTTPAndCommands(t *testing.T) {
	lifecycle := &recordingDesktopLifecycle{}
	favorites := &recordingFavoritesCommands{}
	requestedPath := ""
	service := NewDesktopService(DesktopServiceDependencies{
		Favorites: favorites,
		Lifecycle: lifecycle,
		HTTP: http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			requestedPath = request.URL.Path
			writer.WriteHeader(http.StatusNoContent)
		}),
	})

	ctx := context.WithValue(context.Background(), desktopServiceContextKey{}, "startup")
	options := application.ServiceOptions{Route: "/api/v2"}
	require.NoError(t, service.ServiceStartup(ctx, options))
	require.Same(t, ctx, lifecycle.startupContext)
	require.Equal(t, options, lifecycle.startupOptions)

	response := httptest.NewRecorder()
	service.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/refresh/pods", nil))
	require.Equal(t, http.StatusNoContent, response.Code)
	require.Equal(t, "/refresh/pods", requestedPath)

	favorite := Favorite{ID: "favorite-1"}
	result, err := service.AddFavorite(favorite)
	require.NoError(t, err)
	require.Equal(t, favorite, result)
	require.Equal(t, favorite, favorites.added)

	require.NoError(t, service.ServiceShutdown())
	require.Equal(t, 1, lifecycle.shutdowns)
}
