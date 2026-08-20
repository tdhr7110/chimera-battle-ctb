import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages のプロジェクトサイトは https://<user>.github.io/chimera-battle-ctb/ 配下に
// 配信されるため、本番ビルドのみアセットパスをリポジトリ名でプレフィックスする。
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/chimera-battle-ctb/' : '/',
  plugins: [react()],
}));
