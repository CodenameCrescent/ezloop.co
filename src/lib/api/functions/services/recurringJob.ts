import { runDueSchedules } from "./recurring";
import { sweepPastDue } from "./subscription";

export interface RecurringJobResult {
  ranAt: string;
  schedulesProcessed: number;
  postsCreated: number;
  cappedScheduleIds: string[];
  subscriptionsPastDue: number;
}

/**
 * The daily recurring job: post every due schedule (all businesses) and sweep
 * confirm_first subscriptions that went unpaid into past_due. Idempotent —
 * safe to run repeatedly (the posting unique lock blocks duplicates), so a
 * cron that fires twice or an uptime pinger that retries never double-posts.
 */
export async function runRecurringJob(today: Date = new Date()): Promise<RecurringJobResult> {
  const posted = await runDueSchedules(today);
  const pastDue = await sweepPastDue(today);
  return {
    ranAt: today.toISOString(),
    schedulesProcessed: posted.schedulesProcessed,
    postsCreated: posted.postsCreated,
    cappedScheduleIds: posted.cappedScheduleIds,
    subscriptionsPastDue: pastDue,
  };
}
