import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, '/')

          if (!normalizedId.includes('node_modules')) {
            return undefined
          }

          if (normalizedId.includes('@fullcalendar')) return 'fullcalendar'
          if (normalizedId.includes('recharts')) return 'recharts'
          if (normalizedId.includes('@fortawesome') || normalizedId.includes('react-icons') || normalizedId.includes('lucide-react')) return 'icons'
          if (normalizedId.includes('qrcode.react') || normalizedId.includes('react-qr-code')) return 'qr-code'
          if (normalizedId.includes('/react/') || normalizedId.includes('/react-dom/') || normalizedId.includes('/scheduler/')) return 'react-vendor'

          return 'vendor'
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  }
})
