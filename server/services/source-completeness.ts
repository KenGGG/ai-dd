export interface SourceCompletenessInput {
  periodicReady: number;
  periodicExpected: number;
  recentReady: number;
  recentExpected: number;
  failedCount: number;
  recentLimit: number;
}

export interface SourceCompletenessResult {
  complete: boolean;
  hasPeriodic: boolean;
  hasRecent: boolean;
  noFailed: boolean;
  message: string;
  failedCount: number;
}

export function evaluateSourceCompleteness(
  input: SourceCompletenessInput,
): SourceCompletenessResult {
  const {
    periodicReady,
    periodicExpected,
    recentReady,
    recentExpected,
    failedCount,
    recentLimit,
  } = input;

  // periodicExpected === 0 means no periodic reports are required, so the
  // periodic check is vacuously satisfied (mirrors recentLimit === 0 below).
  const hasPeriodic = periodicExpected === 0 || periodicReady >= periodicExpected;

  const hasRecent =
    recentLimit === 0
      ? true
      : recentExpected > 0 && recentReady >= recentExpected;

  const noFailed = failedCount === 0;

  const complete = hasPeriodic && hasRecent && noFailed;

  const parts: string[] = [];
  if (periodicExpected > 0) parts.push(`periodic=${periodicReady}/${periodicExpected}`);
  if (recentLimit > 0) parts.push(`recent=${recentReady}/${recentExpected}`);
  if (failedCount > 0) parts.push(`failed=${failedCount}`);

  return {
    complete,
    hasPeriodic,
    hasRecent,
    noFailed,
    message: complete ? "来源完整性达标" : `来源完整性不达标：${parts.join(", ")}`,
    failedCount,
  };
}
