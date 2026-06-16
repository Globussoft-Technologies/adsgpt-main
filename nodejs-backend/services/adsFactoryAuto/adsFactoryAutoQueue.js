const { Queue, Worker } = require("bullmq");
const logger = require("../../utils/logger");

function resolvePresetCron(frequency, hour = 0) {
  const h = parseInt(hour, 10) || 0;
  switch (frequency) {
    case "daily": return `0 ${h} * * *`;
    case "every_weekday": return `0 ${h} * * 1-5`;
    case "every_weekend": return `0 ${h} * * 0,6`;
    default: return null;
  }
}

// BullMQ needs its own dedicated ioredis connection — cannot share pub/sub connections
const connection = {
  host:     process.env.HOST,
  port:     Number(process.env.RD_PORT),
  username: process.env.RD_USERNAME,
  password: process.env.redisPass,
  enableReadyCheck: false,
  maxRetriesPerRequest: null,
};

const QUEUE_NAME = "ads-factory-autopilot";

let _queue  = null;
let _worker = null;

function getQueue() {
  if (!_queue) _queue = new Queue(QUEUE_NAME, { connection });
  return _queue;
}

// Unique BullMQ job name per AdsFactoryJob doc — this is how we find + cancel repeatables
function jobName(jobId) {
  return `ads-factory:${jobId}`;
}

// Converts a saved ScheduleSchema doc → the object buildRepeatOpts expects.
// Shared by controller and reloadActiveJobs so both resolve the same way.
function resolveScheduleForQueue(schedule) {
  const { frequency, startDate, timezone } = schedule;

  if (frequency === "does_not_repeat") {
    const runAt = startDate ? new Date(startDate) : new Date();
    return { type: "once", runAt, timezone };
  }

  if (frequency === "custom") {
    const cf = schedule.customFrequency || {};
    return {
      type:         "custom",
      repeatEvery:  cf.repeatEvery  || 1,
      repeatUnit:   cf.repeatUnit   || "week",
      repeatOnDays: cf.repeatOnDays || [],
      timezone,
      hour:         schedule.hour || 0,
    };
  }

  // Preset (daily / every_weekday / every_weekend) → dynamic cron based on hour
  return { type: "cron", cronExpression: resolvePresetCron(frequency, schedule.hour), timezone };
}

/**
 * Convert the resolved schedule object (from controller) into BullMQ repeat options.
 *
 * schedule.type is one of: "cron" | "interval" | "once"
 *
 * For "interval" the UI only exposes days + hours (no minutes/seconds),
 * so intervalDays and intervalHours are both supported.
 * Total ms = (days * 86_400_000) + (hours * 3_600_000)
 */
function buildRepeatOpts(schedule) {
  if (schedule.type === "cron") {
    return {
      repeat: {
        pattern: schedule.cronExpression,
        tz:      schedule.timezone || "UTC",
      },
    };
  }

  if (schedule.type === "interval") {
    const days  = Number(schedule.intervalDays  || 0);
    const hours = Number(schedule.intervalHours || 0);
    const every = days * 86_400_000 + hours * 3_600_000;
    if (every <= 0) throw new Error("interval must be at least 1 hour");
    return { repeat: { every } };
  }

  // "custom" — repeatEvery + repeatUnit + optional repeatOnDays
  if (schedule.type === "custom") {
    const every  = schedule.repeatEvery || 1;
    const unit   = schedule.repeatUnit  || "week";
    const days   = schedule.repeatOnDays || [];
    const tz     = schedule.timezone || "UTC";

    const hour   = schedule.hour || 0;

    if (unit === "day") {
      // Every N days at specific hour
      return { repeat: { pattern: `0 ${hour} */${every} * *`, tz } };
    }

    // Every N weeks on selected days — build a cron day-of-week list
    // If no days selected fall back to Monday
    const DOW_MAP = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
    const dowNums = days.length > 0
      ? days.map((d) => DOW_MAP[d]).filter((n) => n !== undefined).join(",")
      : "1";
    // BullMQ does not natively support "every N weeks" cron, so we fire on the
    // correct days every week and let the orchestrator skip based on lastRunAt if needed.
    return { repeat: { pattern: `0 ${hour} * * ${dowNums}`, tz } };
  }

  // "once" — one-shot with delay, no repeat
  if (schedule.type === "once" && schedule.runAt) {
    const delay = Math.max(0, new Date(schedule.runAt).getTime() - Date.now());
    return { delay };
  }

  return {};
}

/**
 * Register (or re-register) a BullMQ job for an AdsFactoryJob doc.
 * Safe to call multiple times — always cancels the old entry first.
 *
 * @param {string|ObjectId} jobId  - AdsFactoryJob._id
 * @param {object}          schedule - resolved schedule from controller
 */
async function scheduleJob(jobId, schedule) {
  const queue = getQueue();
  await cancelJob(jobId);

  const opts = buildRepeatOpts(schedule);

  await queue.add(
    jobName(jobId),
    { jobId: jobId.toString() },
    {
      ...opts,
      // attempts = 1 → no automatic retries.
      // Retrying a run that already called createAd would post a duplicate ad on Meta.
      // The next scheduled tick will naturally retry on the next cycle.
      attempts:         1,
      removeOnComplete: { count: 50 },
      removeOnFail:     { count: 20 },
    }
  );
}

/**
 * Remove all BullMQ repeatable entries for a given AdsFactoryJob id.
 */
async function cancelJob(jobId) {
  const queue = getQueue();
  const name  = jobName(jobId);
  const repeatableJobs = await queue.getRepeatableJobs();
  for (const rep of repeatableJobs) {
    if (rep.name === name) {
      await queue.removeRepeatableByKey(rep.key);
    }
  }
}

/**
 * Fetch the next scheduled run time from BullMQ for a given AdsFactoryJob id.
 */
async function getNextRunTime(jobId, schedule = null) {
  const queue = getQueue();
  const name  = jobName(jobId);
  const repeatableJobs = await queue.getRepeatableJobs();
  for (const rep of repeatableJobs) {
    if (rep.name === name) {
      return new Date(rep.next);
    }
  }

  // Fallback for paused jobs or one-shot jobs not in BullMQ repeatables.
  if (schedule) {
    if (schedule.frequency === "does_not_repeat") {
      return schedule.startDate ? new Date(schedule.startDate) : null;
    }
    if (schedule.cronExpression) {
      try {
        const parser = require("cron-parser");
        const interval = parser.parseExpression(schedule.cronExpression, {
          tz: schedule.timezone || "UTC",
        });
        return interval.next().toDate();
      } catch (err) {}
    }
  }

  return null;
}

/**
 * Queue a single immediate (non-repeating) run — used by runNow endpoint.
 */
async function runJobNow(jobId) {
  const queue = getQueue();
  // Use a unique jobId per manual trigger so BullMQ de-dupes concurrent calls.
  // attempts = 1 → no retries on manual runs either (would duplicate the ad).
  await queue.add(
    `${jobName(jobId)}:manual:${Date.now()}`,
    { jobId: jobId.toString() },
    {
      attempts:         1,
      removeOnComplete: true,
      removeOnFail:     { count: 10 },
    }
  );
}

/**
 * Start the BullMQ worker. Called once from index.js after MongoDB connects.
 * Lazy-imports the orchestrator to avoid circular deps at module load.
 */
function startWorker() {
  if (_worker) return _worker;

  _worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { adsFactoryOrchestrator } = require("./adsFactoryAutoOrchestrator");
      await adsFactoryOrchestrator.run(job.data.jobId);
    },
    {
      connection,
      // concurrency: 1 — process one tick at a time so the same AdsFactoryJob
      // can never run in parallel with itself and post two ads simultaneously.
      concurrency: 1,
    }
  );

  _worker.on("failed", (job, err) => {
    logger.error(`[adsFactoryAuto:worker] job ${job?.data?.jobId} failed: ${err.message}`);
  });

  _worker.on("completed", (job) => {
    logger.info(`[adsFactoryAuto:worker] job ${job?.data?.jobId} completed`);
  });

  return _worker;
}

/**
 * On server boot, re-register all active AdsFactoryJob docs into BullMQ
 * so schedules survive restarts.
 */
async function reloadActiveJobs() {
  const AdsFactoryJob = require("../../Module/adsFactoryAuto/adsFactoryAutoJob");
  const activeJobs = await AdsFactoryJob.find({ status: "active" }).lean();
  let count = 0;
  for (const job of activeJobs) {
    try {
      await scheduleJob(job._id, resolveScheduleForQueue(job.schedule));
      count++;
    } catch (err) {
      logger.error(`[adsFactoryAuto] failed to reload job ${job._id}: ${err.message}`);
    }
  }
  logger.info(`[adsFactoryAuto] reloaded ${count} active autopilot jobs into BullMQ`);
}

module.exports = { scheduleJob, cancelJob, runJobNow, startWorker, reloadActiveJobs, resolveScheduleForQueue, resolvePresetCron, getNextRunTime };
