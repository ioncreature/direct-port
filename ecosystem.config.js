module.exports = {
  apps: [
    {
      name: 'api',
      cwd: './apps/api',
      script: 'pnpm',
      args: 'dev',
      watch: false,
    },
    {
      name: 'web',
      cwd: './apps/web',
      script: 'pnpm',
      args: 'dev',
      watch: false,
    },
  ],
};
