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
    // tg-bot (self-service) выведен из автозапуска — заменён на client-bot + manager-bot.
    // Код приложения сохранён в apps/tg-bot; чтобы временно вернуть — раскомментируйте.
    // {
    //   name: 'tg-bot',
    //   cwd: './apps/tg-bot',
    //   script: 'pnpm',
    //   args: 'dev',
    //   watch: false,
    // },
    {
      name: 'client-bot',
      cwd: './apps/client-bot',
      script: 'pnpm',
      args: 'dev',
      watch: false,
    },
    {
      name: 'manager-bot',
      cwd: './apps/manager-bot',
      script: 'pnpm',
      args: 'dev',
      watch: false,
    },
    {
      name: 'landing',
      cwd: './apps/landing',
      script: 'pnpm',
      args: 'dev',
      watch: false,
    },
  ],
};
