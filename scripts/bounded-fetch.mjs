export function remainingDeadlineMs(deadlineAt, now = Date.now()) {
  if (!Number.isFinite(deadlineAt)) return Number.POSITIVE_INFINITY;
  return Math.max(0, deadlineAt - now);
}

export function assertDeadline(deadlineAt, code = "OPERATION_DEADLINE_EXCEEDED") {
  if (remainingDeadlineMs(deadlineAt) <= 0) {
    throw Object.assign(new Error(code), { code });
  }
}

export async function boundedOperation(
  operation,
  {
    timeoutMs = 10_000,
    deadlineAt = Number.POSITIVE_INFINITY,
    timeoutCode = "OPERATION_TIMEOUT",
    onTimeout,
  } = {},
) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw Object.assign(new Error("OPERATION_TIMEOUT_INVALID"), {
      code: "OPERATION_TIMEOUT_INVALID",
      timeoutMs,
    });
  }
  if (Number.isFinite(deadlineAt) && deadlineAt <= 0) {
    throw Object.assign(new Error("OPERATION_DEADLINE_INVALID"), {
      code: "OPERATION_DEADLINE_INVALID",
      deadlineAt,
    });
  }
  assertDeadline(deadlineAt, timeoutCode);
  const remaining = remainingDeadlineMs(deadlineAt);
  const effectiveTimeout = Math.max(1, Math.min(timeoutMs, remaining));
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      onTimeout?.();
      reject(Object.assign(new Error(timeoutCode), {
        code: timeoutCode,
        timeoutMs: effectiveTimeout,
      }));
    }, effectiveTimeout);
  });
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function boundedFetch(
  fetcher,
  input,
  init = {},
  options = {},
) {
  const controller = new AbortController();
  const callerSignal = init.signal;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  try {
    return await boundedOperation(
      () => fetcher(input, { ...init, signal: controller.signal }),
      {
        ...options,
        timeoutCode: options.timeoutCode || "FETCH_TIMEOUT",
        onTimeout: () => controller.abort(options.timeoutCode || "FETCH_TIMEOUT"),
      },
    );
  } finally {
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}

export async function delayWithinDeadline(
  delayMs,
  deadlineAt,
  code = "OPERATION_DEADLINE_EXCEEDED",
) {
  assertDeadline(deadlineAt, code);
  const remaining = remainingDeadlineMs(deadlineAt);
  await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, remaining)));
  assertDeadline(deadlineAt, code);
}
