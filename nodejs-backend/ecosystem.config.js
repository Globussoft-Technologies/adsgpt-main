/**
 * PM2 process definitions for the Node backend.
 *
 * Added with C1 (docs/AUTOPILOT_SCALING_PLAN.md), which splits scheduled work
 * out of the API process. Before this the gateway was started by hand and ran
 * everything; two processes is one too many to keep in someone's shell
 * history.
 *
 *   pm2 start ecosystem.config.js
 *   pm2 start ecosystem.config.js --only adsgpt-worker
 *   pm2 restart gateway --update-env      # after changing CRON_ROLE
 *
 * `gateway` keeps its existing name deliberately: the deploy workflow
 * (.github/workflows/deploy-nodejs-backend.yml) restarts it by that name, and
 * renaming it here would quietly break CI.
 * pm2 start ecosystem.config.js --only adsgpt-worker
 * pm2 save
 */
module.exports = {
  apps: [
    {
      name: "gateway",
      script: "index.js",
      exec_mode: "fork",
      instances: 1,
      env: {
        // Serves HTTP only. Scheduled work belongs to adsgpt-worker below.
        //
        // ONLY SET THIS ONCE THE WORKER IS RUNNING. With it set and no worker,
        // nothing scheduled runs at all — Autopilot included. The default when
        // unset is `all`, which is the pre-split behaviour and the safe state
        // to be in halfway through a migration.
        CRON_ROLE: "api",
      },
      max_memory_restart: "1G",
    },
    {
      name: "adsgpt-worker",
      script: "worker.js",
      // FORK, ONE INSTANCE. Never cluster, never instances > 1: the Meta rate
      // limiter is an in-memory singleton and coordinates nothing across
      // processes, so a second worker sees half the true app-level usage,
      // fails to throttle, and gets the whole app blocked. Scaling out
      // requires moving the limiter into Redis first (C5, not built).
      exec_mode: "fork",
      instances: 1,
      env: {
        CRON_ROLE: "worker",
      },
      // A cycle holds its Redis lock for up to 55 minutes; restarting the
      // worker in a tight loop would leave a trail of half-finished cycles.
      min_uptime: "60s",
      max_restarts: 10,
      // Autopilot audits are memory-hungry on large accounts (six insights
      // payloads per account, normalised in memory). Restart on a leak rather
      // than letting the box swap.
      max_memory_restart: "1G",
    },
  ],
};
