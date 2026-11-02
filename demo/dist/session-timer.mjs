import { dateAtTime, durationMinutes } from './core.mjs';

const BREAK_MS = 5 * 60_000;
const nonnegative = value => Number.isFinite(value) ? Math.max(0, value) : 0;
const timestamp = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

function plannedBounds(task) {
  const duration = durationMinutes(task) * 60_000;
  const start = dateAtTime(task?.date, task?.start);
  const end = dateAtTime(task?.date, task?.end);
  if (!duration || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return { start: 0, end: 0, duration: 0 };
  return { start: start.getTime(), end: end.getTime(), duration };
}

/** Starting early or taking a break never moves the planned deadline. */
export function createSession(task, atMs) {
  const plan = plannedBounds(task);
  const at = timestamp(atMs, plan.start);
  return {
    taskId: task?.id,
    date: task?.date,
    deadlineMs: plan.end,
    budgetMs: Math.max(0, plan.end - at),
    accumulatedMs: 0,
    startedAt: at,
    paused: false,
    pausedAt: null,
    breakEndsAt: null,
  };
}

/**
 * Normalize once on load and save the returned copy when migrating old data.
 * A five-minute break expires at its stored end, including while backgrounded.
 * budgetMs is progress information only; task.end always controls the deadline.
 */
export function normalizeSession(session, task, atMs) {
  if (!session) return null;
  const plan = plannedBounds(task);
  const at = timestamp(atMs, plan.start);
  const startedAt = timestamp(session.startedAt, at);
  const accumulatedMs = nonnegative(session.accumulatedMs);
  const paused = Boolean(session.paused);
  const pausedAt = paused ? timestamp(session.pausedAt, at) : null;
  const reference = paused ? pausedAt : startedAt;
  const budgetMs = Math.max(nonnegative(session.budgetMs), accumulatedMs + Math.max(0, plan.end - reference));
  const normalized = {
    ...session,
    taskId: session.taskId ?? task?.id,
    date: session.date ?? task?.date,
    deadlineMs: plan.end,
    budgetMs,
    accumulatedMs,
    startedAt,
    paused,
    pausedAt,
    breakEndsAt: paused
      ? Math.min(plan.end, pausedAt + BREAK_MS, Math.max(pausedAt, timestamp(session.breakEndsAt, pausedAt + BREAK_MS)))
      : null,
  };
  if (normalized.paused && at >= normalized.breakEndsAt) {
    // Resume from when the break actually ended, not from when the app reopened.
    return { ...normalized, paused: false, pausedAt: null, startedAt: normalized.breakEndsAt, breakEndsAt: null };
  }
  return normalized;
}

function elapsed(normalized, atMs) {
  if (!normalized) return 0;
  const stopAt = Math.min(timestamp(atMs, normalized.startedAt), normalized.deadlineMs);
  const runningMs = normalized.paused ? 0 : Math.max(0, stopAt - normalized.startedAt);
  return normalized.accumulatedMs + runningMs;
}

export function sessionElapsedMs(session, task, atMs) {
  return elapsed(normalizeSession(session, task, atMs), atMs);
}

/** This is the plan's remaining time, which continues to decrease during breaks. */
export function sessionRemainingMs(session, task, atMs) {
  if (!session) return 0;
  const plan = plannedBounds(task);
  return Math.max(0, plan.end - timestamp(atMs, plan.start));
}

/** Begin a five-minute break, shortened when the plan ends sooner. */
export function pauseSession(session, task, atMs) {
  const normalized = normalizeSession(session, task, atMs);
  if (!normalized || normalized.paused) return normalized;
  const at = timestamp(atMs, normalized.startedAt);
  const accumulatedMs = elapsed(normalized, at);
  if (at >= normalized.deadlineMs) {
    return { ...normalized, accumulatedMs, startedAt: normalized.deadlineMs };
  }
  return {
    ...normalized,
    accumulatedMs,
    paused: true,
    pausedAt: at,
    breakEndsAt: Math.min(at + BREAK_MS, normalized.deadlineMs),
  };
}

/** End a break early; an already auto-resumed session keeps its original anchor. */
export function resumeSession(session, task, atMs) {
  const normalized = normalizeSession(session, task, atMs);
  if (!normalized || !normalized.paused) return normalized;
  return {
    ...normalized,
    startedAt: Math.min(normalized.deadlineMs, Math.max(timestamp(atMs, normalized.pausedAt), normalized.pausedAt)),
    paused: false,
    pausedAt: null,
    breakEndsAt: null,
  };
}

/** Breaks and legacy moving budgets cannot change the fixed plan deadline. */
export function sessionDeadlineMs(session, task, atMs) {
  return session ? plannedBounds(task).end : null;
}

export function sessionBreakRemainingMs(session, task, atMs) {
  const normalized = normalizeSession(session, task, atMs);
  if (!normalized?.paused) return 0;
  return Math.min(BREAK_MS, Math.max(0, normalized.breakEndsAt - timestamp(atMs, normalized.pausedAt)));
}
