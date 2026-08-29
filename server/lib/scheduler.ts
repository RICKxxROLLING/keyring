import { clockLocal, todayLocal } from "./time.js";

export interface Job {
  name: string;
  /** Run every N ms. Mutually exclusive with dailyAt. */
  intervalMs?: number;
  /** 'HH:mm' in APP_TIMEZONE. Checked once a minute. */
  dailyAt?: string;
  runOnStart?: boolean;
  fn: () => void | Promise<void>;
}

interface Logger {
  info: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

const jobs = new Map<string, Job>();
const lastDailyRun = new Map<string, string>();
let timers: NodeJS.Timeout[] = [];
let tick: NodeJS.Timeout | null = null;
let log: Logger = { info: () => {}, error: () => {} };
let timeZone = "UTC";

/** Called from a workstream's registerX(). Idempotent by name. */
export function registerJob(job: Job): void {
  jobs.set(job.name, job);
}

export function listJobs(): string[] {
  return [...jobs.keys()].sort();
}

async function run(job: Job): Promise<void> {
  try {
    await job.fn();
    log.info({ job: job.name }, "job completed");
  } catch (err) {
    log.error({ job: job.name, err }, "job failed");
  }
}

/** Manual trigger — used by tests and by ops endpoints. */
export async function runJobNow(name: string): Promise<void> {
  const job = jobs.get(name);
  if (!job) throw new Error(`Unknown job ${name}`);
  await run(job);
}

export function startJobs(logger: Logger, tz: string): void {
  stopJobs();
  log = logger;
  timeZone = tz;
  for (const job of jobs.values()) {
    if (job.runOnStart) void run(job);
    if (job.intervalMs) {
      const t = setInterval(() => void run(job), job.intervalMs);
      t.unref();
      timers.push(t);
    }
  }
  tick = setInterval(() => {
    const hhmm = clockLocal(timeZone);
    const today = todayLocal(timeZone);
    for (const job of jobs.values()) {
      if (!job.dailyAt || job.dailyAt !== hhmm) continue;
      if (lastDailyRun.get(job.name) === today) continue;
      lastDailyRun.set(job.name, today);
      void run(job);
    }
  }, 60_000);
  tick.unref();
}

export function stopJobs(): void {
  for (const t of timers) clearInterval(t);
  timers = [];
  if (tick) clearInterval(tick);
  tick = null;
}

/** Tests only. */
export function clearJobs(): void {
  stopJobs();
  jobs.clear();
  lastDailyRun.clear();
}
