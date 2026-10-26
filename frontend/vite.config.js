import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    base: '/pcl-tutor/',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    include: ['src/**/*.test.{js,jsx}'],
  },
});
