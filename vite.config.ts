import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], optimizeDeps: { include: ['three', 'three/addons/controls/OrbitControls.js', 'three/addons/controls/TransformControls.js'] }, server: { port: 4190, host: '127.0.0.1' } });
