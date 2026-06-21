import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const isProd = true;


const API_TARGET = isProd
  ? 'https://wheelttt.xyz'
  : 'http://localhost:8000'

const WS_TARGET = isProd
  ? 'wss://wheelttt.xyz'
  : 'ws://localhost:8000'


export default defineConfig({
  base: isProd ? '/' : '/',
  plugins: [react()],
  server: {
    proxy: {
      '/api':     { target: API_TARGET, changeOrigin: true },
      '/upload':  { target: API_TARGET, changeOrigin: true,
        bypass: (req) => {
          if (req.headers.accept?.includes('text/html')) return req.url
        }
      },
      '/status':  { target: API_TARGET, changeOrigin: true },
      '/frames':  { target: API_TARGET, changeOrigin: true },
      '/results': { target: API_TARGET, changeOrigin: true },
      '/physics': { target: API_TARGET, changeOrigin: true },
      '/download':{ target: API_TARGET, changeOrigin: true },
      '/csv':     { target: API_TARGET, changeOrigin: true },
      '/auth':    { target: API_TARGET, changeOrigin: true },
      '/master':  { target: API_TARGET, changeOrigin: true,
        bypass: (req) => {
          if (req.headers.accept?.includes('text/html')) return req.url
        }
      },
      '/bar-data':{ target: API_TARGET, changeOrigin: true },
      '/stripe':  { target: API_TARGET, changeOrigin: true },
      '/stream':  { target: WS_TARGET, changeOrigin: true, ws: true },
    }
  }
})