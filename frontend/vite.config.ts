import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173
  },
  envPrefix: ['VITE_', 'ENABLE_', 'ERROR_'],
  build: {
    outDir: 'dist'
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),

      // Module aliases
      '@modules': path.resolve(__dirname, './src/modules'),
      '@modules/cluster': path.resolve(__dirname, './src/modules/cluster'),
      '@modules/namespace': path.resolve(__dirname, './src/modules/namespace'),
      '@modules/kubernetes': path.resolve(__dirname, './src/modules/kubernetes'),
      '@modules/object-panel': path.resolve(__dirname, './src/modules/object-panel'),

      // UI aliases
      '@ui': path.resolve(__dirname, './src/ui'),
      '@ui/layout': path.resolve(__dirname, './src/ui/layout'),
      '@ui/navigation': path.resolve(__dirname, './src/ui/navigation'),
      '@ui/command-palette': path.resolve(__dirname, './src/ui/command-palette'),
      '@ui/shortcuts': path.resolve(__dirname, './src/ui/shortcuts'),

      // Shared aliases (NEW location)
      '@shared': path.resolve(__dirname, './src/shared'),
      '@shared/components': path.resolve(__dirname, './src/shared/components'),
      '@shared/hooks': path.resolve(__dirname, './src/shared/hooks'),
      '@shared/utils': path.resolve(__dirname, './src/shared/utils'),

      // Styles alias
      '@styles': path.resolve(__dirname, './styles'),

      // Core aliases
      '@core': path.resolve(__dirname, './src/core'),
      '@core/contexts': path.resolve(__dirname, './src/core/contexts'),

      // Remaining aliases
      '@hooks': path.resolve(__dirname, './src/hooks'),
      '@types': path.resolve(__dirname, './src/types'),
      '@utils': path.resolve(__dirname, './src/utils'),
      '@components': path.resolve(__dirname, './src/components'),
      '@contexts': path.resolve(__dirname, './src/core/contexts'),
      '@assets': path.resolve(__dirname, './src/assets'),
      '@wailsjs': path.resolve(__dirname, './wailsjs'),
    }
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './vitest.setup.ts',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: 'coverage',
      exclude: ['**/*.css']
    }
  }
})
