import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@': '/src',
        },
    },
    server: {
        port: 3000,
        proxy: {
            '/api': {
                target: 'http://localhost:8080',
                changeOrigin: true,
                rewrite: function (p) { return p.replace(/^\/api/, ''); },
            },
        },
    },
    build: {
        // Code splitting optimization
        rollupOptions: {
            output: {
                manualChunks: {
                    // Vendor chunks
                    'react-vendor': ['react', 'react-dom', 'react-router-dom'],
                    'editor': ['@tinymce/tinymce-react', 'tinymce'],
                    'icons': ['lucide-react'],
                },
            },
        },
        // Chunk size warnings
        chunkSizeWarningLimit: 1000,
        // Minification
        minify: 'terser',
        terserOptions: {
            compress: {
                drop_console: true,
                drop_debugger: true,
            },
        },
        // Source maps for production debugging
        sourcemap: false,
    },
    // Performance optimizations
    optimizeDeps: {
        include: ['react', 'react-dom', 'react-router-dom'],
    },
});
