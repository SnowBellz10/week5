import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function injectQuickDappConfig() {
  return {
    name: 'inject-quickdapp-config',
    transformIndexHtml(html) {
      const configPath = path.resolve(__dirname, 'dapp.config.json');
      let runtimeConfig = {};

      if (fs.existsSync(configPath)) {
        const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        runtimeConfig = {
          ...(raw.config || {}),
          title: raw.config?.title || raw.name || 'ConcertTickets',
          details: raw.config?.details || '',
          logo: raw.config?.logo || '',
          contracts: Array.isArray(raw.contracts) ? raw.contracts : [],
          primaryContractId: raw.primaryContractId || raw.contracts?.[0]?.id || '',
          contract: raw.contract || null,
        };
      }

      const serialized = JSON.stringify(runtimeConfig).replace(/</g, '\\u003c');
      const cleanedHtml = html.replace(/<script type="importmap">[\s\S]*?<\/script>\s*/i, '');

      return {
        html: cleanedHtml,
        tags: [
          {
            tag: 'script',
            injectTo: 'head-prepend',
            children: `window.__QUICK_DAPP_CONFIG__ = Object.assign(${serialized}, window.__QUICK_DAPP_CONFIG__ || {});`,
          },
        ],
      };
    },
  };
}

export default defineConfig({
  base: '/week5/',
  plugins: [injectQuickDappConfig(), react()],
});
