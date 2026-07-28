export type CollectProgress = {
  active: boolean;
  percent: number;
  stage: string;
  message: string;
  updatedAt: number;
};

const progress: CollectProgress = {
  active: false,
  percent: 0,
  stage: "idle",
  message: "",
  updatedAt: Date.now(),
};

export function getCollectProgress(): CollectProgress {
  return { ...progress };
}

export function setCollectProgress(partial: {
  active?: boolean;
  percent?: number;
  stage?: string;
  message?: string;
}): void {
  if (partial.active !== undefined) progress.active = partial.active;
  if (partial.percent !== undefined) {
    const next = Math.max(0, Math.min(100, Math.round(partial.percent)));
    // Don't jump backwards while a run is active (parallel boards finish out of order).
    progress.percent =
      progress.active && next < progress.percent && next < 100 ? progress.percent : next;
  }
  if (partial.stage !== undefined) progress.stage = partial.stage;
  if (partial.message !== undefined) progress.message = partial.message;
  progress.updatedAt = Date.now();
}

export function startCollectProgress(message = "Starting job search…"): void {
  setCollectProgress({
    active: true,
    percent: 2,
    stage: "starting",
    message,
  });
}

export function finishCollectProgress(message = "Done"): void {
  setCollectProgress({
    active: false,
    percent: 100,
    stage: "done",
    message,
  });
}

export function failCollectProgress(message: string): void {
  setCollectProgress({
    active: false,
    percent: progress.percent,
    stage: "error",
    message,
  });
}
