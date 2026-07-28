/** Only one Playwright persistent profile session at a time (same userDataDir). */
let mutex: Promise<void> = Promise.resolve();
let held = false;

export function isAutomationBrowserBusy(): boolean {
  return held;
}

/** Unstick the lock if a prior run crashed without closing the browser. */
export function forceReleaseAutomationBrowserLock(): void {
  held = false;
}

/** Call release() when the browser context is closed. */
export async function acquireAutomationBrowserLock(): Promise<() => void> {
  const waitFor = mutex;
  let releaseMutex!: () => void;
  mutex = new Promise<void>((resolve) => {
    releaseMutex = resolve;
  });
  await waitFor;
  held = true;
  return () => {
    held = false;
    releaseMutex();
  };
}
