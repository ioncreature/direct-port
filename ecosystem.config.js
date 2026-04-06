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
      name: 'admin-web',
      cwd: './apps/admin-web',
      script: 'pnpm',
      args: 'dev',
      watch: false,
    },
  ],
};
