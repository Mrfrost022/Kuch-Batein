import { defineConfig } from 'vite'

const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1]

export default defineConfig({
  server: {
    allowedHosts: ['villages-appreciate-tip-jon.trycloudflare.com'],
  },
  base: process.env.GITHUB_ACTIONS && repositoryName ? `/${repositoryName}/` : '/',
})
