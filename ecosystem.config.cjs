const path = require('node:path');

const root = __dirname;
const logsDir = path.join(root, 'logs');

module.exports = {
  apps: [
    {
      name: 'mempalace-server',
      cwd: path.join(root, 'server'),
      // Run bun as a plain subprocess — pm2's `interpreter: 'bun'` uses a
      // require-in-the-middle wrapper that can't load modules with top-level
      // `await` (index.ts awaits syncMaintainersFromConfig on boot).
      script: 'bun',
      args: 'src/index.ts',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      kill_timeout: 10000,
      env: {
        NODE_ENV: 'production',
        PORT: '7800',
        POLLER_ENABLED: 'true',
      },
      out_file: path.join(logsDir, 'server-out.log'),
      error_file: path.join(logsDir, 'server-err.log'),
      merge_logs: true,
      time: true,
    },
    {
      name: 'mempalace-dashboard',
      script: 'serve',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      env: {
        PM2_SERVE_PATH: path.join(root, 'dashboard', 'dist', 'dashboard', 'browser'),
        PM2_SERVE_PORT: '4200',
        PM2_SERVE_SPA: 'true',
        PM2_SERVE_HOMEPAGE: '/index.html',
      },
      out_file: path.join(logsDir, 'dashboard-out.log'),
      error_file: path.join(logsDir, 'dashboard-err.log'),
      merge_logs: true,
      time: true,
    },
  ],
};
