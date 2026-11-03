import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({plugins:[react()],server:{proxy:{'/api':'http://127.0.0.1:3002','/health':'http://127.0.0.1:3002','/glitch-private':{target:'http://127.0.0.1:9000',changeOrigin:false}}}});
