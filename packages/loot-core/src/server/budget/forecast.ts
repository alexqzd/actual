// @ts-strict-ignore
// CUSTOM: Forecast Budget Feature
import { logger } from '#platform/server/log';
import * as db from '#server/db';
import { Schedule as RSchedule } from '#server/util/rschedule';
import * as monthUtils from '#shared/months';
import {
  extractScheduleConds,
  getDateWithSkippedWeekend,
  getScheduledAmount,
  getScheduleOccurrenceMatchStartDate,
  getStatus,
  recurConfigToRSchedule,
} from '#shared/schedules';
import type { RuleConditionEntity } from '#types/models';
import type { RecurConfig } from '#types/models/schedule';

/**
 * Schedule detail for UI display. Lists the pending occurrences that make up
 * the difference between "to budget" and "expected to budget" for a month.
 */
export type ForecastedScheduleDetail = {
  id: string;
  name: string;
  amount: number;
  occurrences: number;
  total: number;
  status: string;
};

type ScheduleRow = {
  id: string;
  name: string | null;
  posts_transaction: number;
  next_date: number;
  conditions: string | null;
  actions: string | null;
};

export type IncomeSchedule = {
  id: string;
  name: string;
  amount: number;
  nextDate: string;
  dateValue: string | RecurConfig;
  posts_transaction: boolean;
  _conditions: RuleConditionEntity[];
};

type PendingOccurrence = { date: string; posted: boolean };

type LoadedSchedule = IncomeSchedule & {
  postedDates: string[];
  status: string;
  // Pending (not yet posted, not in the past) occurrence dates, computed up
  // to `horizon` (inclusive, YYYY-MM-DD).
  pendingDates: string[];
};

type ForecastCache = {
  database: unknown;
  today: string;
  horizon: string;
  schedules: LoadedSchedule[];
};

let cache: ForecastCache | null = null;

// How far back we generate occurrences so that late, future-dated payments
// can be matched against a missed occurrence instead of stealing the next one.
const MISSED_OCCURRENCE_WINDOW_DAYS = 31;
// Extra days generated around the range so weekend adjustments that move an
// occurrence across the range boundary are still picked up.
const WEEKEND_PADDING_DAYS = 7;

/**
 * Drop cached schedule data. Must be called whenever schedules, rules,
 * transactions, accounts, payees or categories change.
 */
export function invalidateForecastCache() {
  cache = null;
}

function dateReprToString(date: number | string): string {
  const str = String(date);
  return `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}`;
}

function parseJSON<T>(value: string | T | null): T | null {
  if (value == null) {
    return null;
  }
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * All occurrence dates of a schedule between `start` and `end` (inclusive),
 * with weekend adjustments applied.
 */
export function getOccurrenceDates(
  dateValue: string | RecurConfig,
  start: string,
  end: string,
): string[] {
  if (typeof dateValue === 'string') {
    return dateValue >= start && dateValue <= end ? [dateValue] : [];
  }
  if (!dateValue?.frequency) {
    return [];
  }

  const schedule = new RSchedule({ rrules: recurConfigToRSchedule(dateValue) });
  const dates = new Set<string>();

  for (const occ of schedule
    .occurrences({
      start: monthUtils.parseDate(
        monthUtils.subDays(start, WEEKEND_PADDING_DAYS),
      ),
      end: monthUtils.parseDate(monthUtils.addDays(end, WEEKEND_PADDING_DAYS)),
    })
    .toArray()) {
    const date = monthUtils.dayFromDate(
      dateValue.skipWeekend
        ? getDateWithSkippedWeekend(occ.date, dateValue.weekendSolveMode)
        : occ.date,
    );
    if (date >= start && date <= end) {
      dates.add(date);
    }
  }

  return [...dates].sort();
}

/**
 * Pair each linked transaction with at most one occurrence, and each
 * occurrence with at most one transaction.
 *
 * - Transactions dated today or earlier use the same window as schedule
 *   status ("paid" if dated within the match lookback up to the occurrence).
 * - Transactions dated in the future are unambiguous pre-registrations of an
 *   upcoming occurrence, so they match the nearest occurrence regardless of
 *   the lookback window.
 */
export function matchPostedOccurrences(
  schedule: Pick<IncomeSchedule, 'posts_transaction' | '_conditions'>,
  occurrenceDates: string[],
  postedDates: string[],
  today: string,
): PendingOccurrence[] {
  const occurrences = occurrenceDates.map(date => ({ date, posted: false }));

  for (const txDate of [...postedDates].sort()) {
    let match: PendingOccurrence | undefined;

    if (txDate > today) {
      let bestDistance = Infinity;
      for (const occ of occurrences) {
        if (occ.posted) {
          continue;
        }
        const distance = Math.abs(
          monthUtils.differenceInCalendarDays(occ.date, txDate),
        );
        // Ties go to the later occurrence: paying early is more common
        // than pre-registering a late payment.
        if (distance <= bestDistance) {
          bestDistance = distance;
          match = occ;
        }
        if (occ.date > txDate) {
          break;
        }
      }
    } else {
      match = occurrences.find(
        occ =>
          !occ.posted &&
          txDate <= occ.date &&
          txDate >= getScheduleOccurrenceMatchStartDate(schedule, occ.date),
      );
    }

    if (match) {
      match.posted = true;
    }
  }

  return occurrences;
}

/**
 * Occurrences of a schedule that still have to be received: from today until
 * `horizon`, minus the ones already covered by a linked transaction.
 */
export function getPendingOccurrenceDates(
  schedule: IncomeSchedule,
  postedDates: string[],
  today: string,
  horizon: string,
): string[] {
  // A one-time schedule is received as soon as any transaction is linked
  // to it, whatever date the transaction was recorded with.
  if (typeof schedule.dateValue === 'string' && postedDates.length > 0) {
    return [];
  }

  // Never go before next_date: anything earlier was already paid or skipped.
  const lowerBound = monthUtils.subDays(today, MISSED_OCCURRENCE_WINDOW_DAYS);
  const start = schedule.nextDate > lowerBound ? schedule.nextDate : lowerBound;

  const occurrenceDates = getOccurrenceDates(
    schedule.dateValue,
    start,
    horizon,
  );

  return matchPostedOccurrences(schedule, occurrenceDates, postedDates, today)
    .filter(occ => !occ.posted && occ.date >= today)
    .map(occ => occ.date);
}

function loadIncomeSchedules(): IncomeSchedule[] {
  const rows = db.runQuery<ScheduleRow>(
    `SELECT
       s.id,
       s.name,
       s.posts_transaction,
       CASE
         WHEN snd.local_next_date_ts = snd.base_next_date_ts THEN snd.local_next_date
         ELSE snd.base_next_date
       END AS next_date,
       r.conditions,
       r.actions
     FROM schedules s
     JOIN schedules_next_date snd ON snd.schedule_id = s.id
     JOIN rules r ON r.id = s.rule AND r.tombstone = 0
     WHERE s.tombstone = 0 AND s.completed = 0`,
    [],
    true,
  );

  if (rows.length === 0) {
    return [];
  }

  const accounts = new Map(
    db
      .runQuery<{
        id: string;
        offbudget: number;
        closed: number;
      }>(
        'SELECT id, offbudget, closed FROM accounts WHERE tombstone = 0',
        [],
        true,
      )
      .map(a => [a.id, a]),
  );
  const payees = new Map(
    db
      .runQuery<{
        id: string;
        name: string;
        transfer_acct: string | null;
      }>(
        'SELECT id, name, transfer_acct FROM payees WHERE tombstone = 0',
        [],
        true,
      )
      .map(p => [p.id, p]),
  );
  const categories = new Map(
    db
      .runQuery<{
        id: string;
        is_income: number;
      }>('SELECT id, is_income FROM categories WHERE tombstone = 0', [], true)
      .map(c => [c.id, c]),
  );

  const schedules: IncomeSchedule[] = [];

  for (const row of rows) {
    try {
      const conditions = parseJSON<RuleConditionEntity[]>(row.conditions);
      if (!conditions || row.next_date == null) {
        continue;
      }

      const conds = extractScheduleConds(conditions);
      const amount = getScheduledAmount(conds.amount?.value);
      const dateValue = conds.date?.value;

      // Only income counts towards "to budget"
      if (!dateValue || !(amount > 0)) {
        continue;
      }

      // Money landing in an off-budget or closed account never reaches
      // "to budget".
      const account = accounts.get(conds.account?.value);
      if (conds.account?.value && (!account || account.closed)) {
        continue;
      }
      if (account?.offbudget) {
        continue;
      }

      // A transfer between two on-budget accounts is not income.
      const payee = payees.get(conds.payee?.value);
      if (payee?.transfer_acct) {
        const transferAccount = accounts.get(payee.transfer_acct);
        if (transferAccount && !transferAccount.offbudget) {
          continue;
        }
      }

      // A positive amount categorized into an expense category refills that
      // category (e.g. a refund), it doesn't add to "to budget".
      const actions = parseJSON<Array<{ op: string; field?: string; value }>>(
        row.actions,
      );
      const categoryAction = actions?.find(
        a => a.op === 'set' && a.field === 'category',
      );
      const category = categories.get(categoryAction?.value);
      if (category && !category.is_income) {
        continue;
      }

      schedules.push({
        id: row.id,
        name: row.name || payee?.name || 'Unknown',
        amount,
        nextDate: dateReprToString(row.next_date),
        dateValue,
        posts_transaction: Boolean(row.posts_transaction),
        _conditions: conditions,
      });
    } catch (err) {
      logger.error(`[FORECAST] Error processing schedule ${row.id}:`, err);
    }
  }

  return schedules;
}

function loadPostedDates(
  schedules: IncomeSchedule[],
  today: string,
): Map<string, string[]> {
  const posted = new Map<string, string[]>();
  if (schedules.length === 0) {
    return posted;
  }

  // The earliest date a transaction could match: the lookback before the
  // earliest occurrence we generate.
  const earliestNextDate = schedules.reduce(
    (min, s) => (s.nextDate < min ? s.nextDate : min),
    today,
  );
  const lowerBound = monthUtils.subDays(
    earliestNextDate > monthUtils.subDays(today, MISSED_OCCURRENCE_WINDOW_DAYS)
      ? earliestNextDate
      : monthUtils.subDays(today, MISSED_OCCURRENCE_WINDOW_DAYS),
    2,
  );

  // Group by parent so a split transaction counts once.
  const rows = db.runQuery<{ schedule: string; date: number }>(
    `SELECT schedule, MIN(date) AS date
     FROM transactions
     WHERE tombstone = 0
       AND schedule IS NOT NULL
       AND date >= ?
     GROUP BY schedule, COALESCE(parent_id, id)`,
    [db.toDateRepr(lowerBound)],
    true,
  );

  for (const row of rows) {
    const dates = posted.get(row.schedule) ?? [];
    dates.push(dateReprToString(row.date));
    posted.set(row.schedule, dates);
  }

  return posted;
}

function getLoadedSchedules(month: string): LoadedSchedule[] {
  const today = monthUtils.currentDay();
  const monthEnd = monthUtils.lastDayOfMonth(month);
  const database = db.getDatabase();

  if (!cache || cache.database !== database || cache.today !== today) {
    const incomeSchedules = loadIncomeSchedules();
    const postedBySchedule = loadPostedDates(incomeSchedules, today);

    cache = {
      database,
      today,
      horizon: '',
      schedules: incomeSchedules.map(schedule => {
        const postedDates = postedBySchedule.get(schedule.id) ?? [];
        const hasTrans = postedDates.some(
          date =>
            date >=
            getScheduleOccurrenceMatchStartDate(schedule, schedule.nextDate),
        );
        return {
          ...schedule,
          postedDates,
          status: getStatus(schedule.nextDate, false, hasTrans),
          pendingDates: [],
        };
      }),
    };
  }

  if (cache.horizon < monthEnd) {
    // Months are usually computed in order, so extend generously to avoid
    // regenerating occurrences for every month.
    const yearAhead = monthUtils.lastDayOfMonth(
      monthUtils.addMonths(monthUtils.monthFromDate(today), 12),
    );
    const horizon = monthEnd > yearAhead ? monthEnd : yearAhead;

    for (const schedule of cache.schedules) {
      schedule.pendingDates = getPendingOccurrenceDates(
        schedule,
        schedule.postedDates,
        today,
        horizon,
      );
    }
    cache.horizon = horizon;
  }

  return cache.schedules;
}

/**
 * Pending occurrences per schedule. With `onlyInMonth`, only those falling in
 * the month itself; otherwise every one from today through the end of the
 * month, since income received earlier carries over into later months.
 */
function getPendingBySchedule(month: string, onlyInMonth: boolean) {
  // Past months can't receive new scheduled income.
  if (month < monthUtils.monthFromDate(monthUtils.currentDay())) {
    return [];
  }

  const monthStart = monthUtils.firstDayOfMonth(month);
  const monthEnd = monthUtils.lastDayOfMonth(month);

  return getLoadedSchedules(month).flatMap(schedule => {
    const count = schedule.pendingDates.filter(
      date => date <= monthEnd && (!onlyInMonth || date >= monthStart),
    ).length;
    return count > 0 ? [{ schedule, count }] : [];
  });
}

/**
 * Pending scheduled income expected within the month itself, for display.
 * "Expected to budget" also counts pending income from earlier months; see
 * calculateForecastedToBudget.
 */
export function getSchedulesForForecastedToBudget(
  month: string,
): ForecastedScheduleDetail[] {
  try {
    return getPendingBySchedule(month, true).map(({ schedule, count }) => ({
      id: schedule.id,
      name: schedule.name,
      amount: schedule.amount,
      occurrences: count,
      total: schedule.amount * count,
      status: schedule.status,
    }));
  } catch (error) {
    logger.error('Error getting forecasted schedules:', error);
    return [];
  }
}

/**
 * Calculate the forecasted "to budget" amount for a given month.
 * This includes expected income from scheduled transactions.
 */
export function calculateForecastedToBudget(
  month: string,
  currentToBudget: number,
): number {
  try {
    return getPendingBySchedule(month, false).reduce(
      (total, { schedule, count }) => total + schedule.amount * count,
      currentToBudget,
    );
  } catch (error) {
    logger.error('Error calculating forecasted to budget:', error);
    return currentToBudget;
  }
}
