import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Explicit '0.0.0.0' rather than `true` — on Windows, Vite's `host: true` binds the IPv6
    // wildcard ('::'), which doesn't reliably accept IPv4 connections (observed: localhost
    // worked, the LAN IPv4 address did not). Binding IPv4 explicitly fixes reachability from a
    // phone on the same Wi-Fi network.
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 5173,
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
