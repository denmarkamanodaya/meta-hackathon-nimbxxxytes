// Holds the Ask box's job queue for every screen of the Mac shell, and follows each running short
// guide or Memory Lane session (one watcher each, drawing nothing) so its card ticks while the owner browses.
import type { ReactNode } from 'react';
import type { AskJob } from '../../core/ask/jobs';
import { AskContext, useAskQueue, useGuideJob, useMemoryJob, useShortJob, type AskQueue } from '../../hooks/useAsk';

function ShortWatch({ job, shortId, report }: { job: AskJob; shortId: string; report: AskQueue['report'] }) {
  useShortJob(job, shortId, report);
  return null;
}

function GuideWatch({ job, guideId, report }: { job: AskJob; guideId: string; report: AskQueue['report'] }) {
  useGuideJob(job, guideId, report);
  return null;
}

function MemoryWatch({ job, memoryId, report }: { job: AskJob; memoryId: string; report: AskQueue['report'] }) {
  useMemoryJob(job, memoryId, report);
  return null;
}

/**
 * The provider.
 * @param props - The shell.
 * @returns The provider with its watchers.
 */
export function AskProvider({ children }: { children: ReactNode }) {
  const queue = useAskQueue();
  return (
    <AskContext.Provider value={queue}>
      {children}
      {queue.jobs.map((job) => {
        if (job.status !== 'running') return null;
        if (job.shortId !== null) return <ShortWatch key={job.id} job={job} shortId={job.shortId} report={queue.report} />;
        if (job.guideId !== null) return <GuideWatch key={job.id} job={job} guideId={job.guideId} report={queue.report} />;
        if (job.memoryId !== null) return <MemoryWatch key={job.id} job={job} memoryId={job.memoryId} report={queue.report} />;
        return null;
      })}
    </AskContext.Provider>
  );
}
