import {
  detectWorkArrangement as detectWorkArrangementShared,
  WORK_ARRANGEMENT_LABELS,
  type WorkArrangement,
} from "@jobfinder/shared";
import type { JobDto } from "@jobfinder/shared";

export type { WorkArrangement };

const STYLES: Record<WorkArrangement, string> = {
  remote: "bg-emerald-900/50 text-emerald-300 border-emerald-800/60",
  hybrid: "bg-blue-900/50 text-blue-300 border-blue-800/60",
  "on-site": "bg-amber-900/40 text-amber-200 border-amber-800/50",
  unknown: "bg-ink-800 text-gray-400 border-ink-700",
};

export function workArrangementLabel(arrangement: WorkArrangement): string {
  return WORK_ARRANGEMENT_LABELS[arrangement];
}

export function workArrangementClass(arrangement: WorkArrangement): string {
  return STYLES[arrangement];
}

export function resolveWorkArrangement(job: JobDto): WorkArrangement {
  return job.workArrangement ?? detectWorkArrangementShared(job);
}
