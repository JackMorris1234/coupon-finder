import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // bind all interfaces so phones/laptops on the LAN can open the app
    allowedHosts: ['.ts.net'], // Tailscale MagicDNS names (phone access from anywhere)
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001', // LAN clients reach the API through this proxy
    },
  },
});
