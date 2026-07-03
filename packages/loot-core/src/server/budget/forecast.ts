// @ts-strict-ignore
import * as d from 'date-fns';

import { logger } from '#platform/server/log';
import * as db from '#server/db';
import { Schedule as RSchedule } from '#server/util/rschedule';
import * as monthUtils from '#shared/months';
import { monthFromDate } from '#shared/months';
import {
  extractScheduleConds,
  getDateWithSkippedWeekend,
  getStatus,
  recurConfigToRSchedule,
} from '#shared/schedules';
import type { ScheduleEntity } from '#types/models';

/**
 * Schedule data returned from the database query
 */
type ScheduleQueryResult = {
  id: string;
  rule: string;
  completed: number;
  next_date: number | string;
  conditions: string | null;
  actions: string | null;
};

/**
 * Convert a date from integer format (YYYYMMDD) to string format (YYYY-MM-DD)
 */
function formatDateInt(dateInt: number | string): string {
  const dateStr = String(dateInt);
  return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
}

function getScheduleOccurrencesUpToMonth({
  s,
  month,
}: {
  s: Pick<ScheduleEntity, '_date' | 'next_date'>;
  month: string;
}) {
  const config = s._date;

  // If the frequency is undefined, we assume it's a one-time schedule
  if (typeof config === 'string' || !config.frequency) {
    // If one-time schedule, config IS the date string (not an object)
    try {
      // For one-time schedules, config is directly the date string
      const startDate = typeof config === 'string' ? config : config.start;

      if (!startDate) {
        logger.error('[FORECAST] One-time schedule missing date');
        return [];
      }

      const monthIsScheduled = monthFromDate(startDate);
      if (monthIsScheduled <= month) {
        // Parse the start date and return as a Date object
        const year = Number(startDate.slice(0, 4));
        const monthIndex = Number(startDate.slice(5, 7)) - 1;
        const day = Number(startDate.slice(8, 10));

        if (isNaN(year) || isNaN(monthIndex) || isNaN(day)) {
          logger.error(
            `[FORECAST] Invalid date components: year=${year}, month=${monthIndex}, day=${day}`,
          );
          return [];
        }

        const dateObj = new Date(year, monthIndex, day);
        if (isNaN(dateObj.getTime())) {
          logger.error(
            `[FORECAST] Invalid Date object created from: ${startDate}`,
          );
          return [];
        }

        return [dateObj];
      }
      return [];
    } catch (err) {
      logger.error('[FORECAST] Error parsing one-time schedule date:', err);
      return [];
    }
  }

  const rules = recurConfigToRSchedule(config);

  try {
    const schedule = new RSchedule({ rrules: rules });

    const count = 366; // Maximum one year of daily occurrences

    const yearMonth = String(month).slice(0, 7);
    const year = Number(yearMonth.slice(0, 4));
    const monthIndex = Number(yearMonth.slice(5, 7)) - 1; // month is 0-indexed
    const firstDayMonth = new Date(year, monthIndex, 1);

    // next_date is a string in the format "YYYY-MM-DD"
    const nextDateStr = String(s.next_date);
    const nextDateYYYY = nextDateStr.slice(0, 4);
    const nextDateMM = nextDateStr.slice(5, 7);
    const nextDateDD = nextDateStr.slice(8, 10);
    const nextDate = new Date(
      Number(nextDateYYYY),
      Number(nextDateMM) - 1,
      Number(nextDateDD),
    );

    const start_search = d.startOfMonth(nextDate);

    return schedule
      .occurrences({
        start: start_search,
        end: d.endOfMonth(firstDayMonth),
        take: count,
      })
      .toArray()
      .map(date =>
        config.skipWeekend
          ? getDateWithSkippedWeekend(date.date, config.weekendSolveMode)
          : date.date,
      );
  } catch (err) {
    logger.error('Error calculating schedule occurrences:', err);
    return [];
  }
}

/**
 * Get schedule occurrences only within a specific month (not cumulative)
 */
function getScheduleOccurrencesInMonth({
  s,
  month,
}: {
  s: Pick<ScheduleEntity, '_date' | 'next_date'>;
  month: string;
}) {
  const config = s._date;

  // If the frequency is undefined, we assume it's a one-time schedule
  if (typeof config === 'string' || !config.frequency) {
    // If one-time schedule, config IS the date string (not an object)
    try {
      // For one-time schedules, config is directly the date string
      const startDate = typeof config === 'string' ? config : config.start;

      if (!startDate) {
        logger.error('[FORECAST] One-time schedule missing date (inMonth)');
        return [];
      }

      const monthIsScheduled = monthFromDate(startDate);
      if (monthIsScheduled === month) {
        // Parse the start date and return as a Date object
        const year = Number(startDate.slice(0, 4));
        const monthIndex = Number(startDate.slice(5, 7)) - 1;
        const day = Number(startDate.slice(8, 10));

        if (isNaN(year) || isNaN(monthIndex) || isNaN(day)) {
          logger.error(
            `[FORECAST] Invalid date components: year=${year}, month=${monthIndex}, day=${day}`,
          );
          return [];
        }

        const dateObj = new Date(year, monthIndex, day);
        if (isNaN(dateObj.getTime())) {
          logger.error(
            `[FORECAST] Invalid Date object created from: ${startDate}`,
          );
          return [];
        }

        return [dateObj];
      }
      return [];
    } catch (err) {
      logger.error(
        '[FORECAST] Error parsing one-time schedule date (inMonth):',
        err,
      );
      return [];
    }
  }

  const rules = recurConfigToRSchedule(config);

  try {
    const schedule = new RSchedule({ rrules: rules });

    const count = 100; // Maximum occurrences to check

    const yearMonth = String(month).slice(0, 7);
    const year = Number(yearMonth.slice(0, 4));
    const monthIndex = Number(yearMonth.slice(5, 7)) - 1; // month is 0-indexed
    const firstDayOfTargetMonth = new Date(year, monthIndex, 1);
    const lastDayOfTargetMonth = d.endOfMonth(firstDayOfTargetMonth);

    // Start searching from the beginning of the target month
    return schedule
      .occurrences({
        start: firstDayOfTargetMonth,
        end: lastDayOfTargetMonth,
        take: count,
      })
      .toArray()
      .map(date =>
        config.skipWeekend
          ? getDateWithSkippedWeekend(date.date, config.weekendSolveMode)
          : date.date,
      );
  } catch (err) {
    logger.error('Error calculating schedule occurrences in month:', err);
    return [];
  }
}

/**
 * Convert a date string (YYYY-MM-DD) to integer format (YYYYMMDD)
 */
function dateStringToInt(dateStr: string): number {
  return Number(dateStr.replace(/-/g, ''));
}

/**
 * Check if a schedule has associated transactions near its next_date
 */
function scheduleHasTransactions(
  scheduleId: string,
  nextDate: string,
  isOneTime: boolean,
): boolean {
  try {
    // For one-time schedules, look for exact date match
    // For recurring schedules, look within 2 days before the scheduled date
    const dateFilter = isOneTime ? nextDate : monthUtils.subDays(nextDate, 2);

    // Convert to integer format for SQLite comparison (dates stored as INTEGER)
    const dateFilterInt = dateStringToInt(dateFilter);

    // Query the raw transactions table with tombstone filter
    const result = db.runQuery<{ count: number }>(
      `SELECT COUNT(*) as count FROM transactions
       WHERE schedule = ?
       AND date >= ?
       AND tombstone = 0`,
      [scheduleId, dateFilterInt],
      true,
    );

    return result.length > 0 && result[0].count > 0;
  } catch (error) {
    logger.error('Error checking schedule transactions:', error);
    return false;
  }
}

/**
 * Schedule detail for UI display
 */
export type ForecastedScheduleDetail = {
  id: string;
  name: string;
  amount: number;
  occurrences: number;
  total: number;
  status: string;
};

/**
 * Get detailed schedule information for the forecasted "to budget" calculation
 */
export function getSchedulesForForecastedToBudget(
  month: string,
): ForecastedScheduleDetail[] {
  try {
    // Fetch all active schedules
    const schedules = db.runQuery<
      ScheduleQueryResult & { schedule_name: string }
    >(
      `SELECT
        s.id,
        s.name as schedule_name,
        s.rule,
        s.completed,
        snd.local_next_date as next_date,
        r.conditions,
        r.actions
       FROM schedules s
       JOIN schedules_next_date snd ON snd.schedule_id = s.id
       LEFT JOIN rules r ON r.id = s.rule
       WHERE s.tombstone = 0
       AND s.completed = 0`,
      [],
      true,
    );

    if (schedules.length === 0) {
      return [];
    }

    // Fetch all payees for mapping
    const payees = db.runQuery<{ id: string; name: string }>(
      `SELECT id, name FROM payees WHERE tombstone = 0`,
      [],
      true,
    );
    const payeeMap = new Map(payees.map(p => [p.id, p.name]));

    const scheduleDetails: ForecastedScheduleDetail[] = [];

    schedules.forEach(s => {
      try {
        // Skip schedules with no matching rule
        if (!s.conditions || !s.actions) {
          return;
        }

        // Parse the rule's conditions from JSON
        const conditions =
          typeof s.conditions === 'string'
            ? JSON.parse(s.conditions)
            : s.conditions;

        // Extract schedule conditions using the shared utility
        const conds = extractScheduleConds(conditions);

        // Get amount, date, and payee from conditions
        const scheduleAmount = conds.amount?.value;
        const dateConfig = conds.date?.value;
        const payeeId = conds.payee?.value;

        // Skip if no amount or date, or if not income (amount <= 0)
        if (!scheduleAmount || !dateConfig || Number(scheduleAmount) <= 0) {
          return;
        }

        // Convert next_date from integer to string format
        const nextDateStr = formatDateInt(s.next_date);

        // Check if schedule is one-time (no frequency)
        const isOneTime = !dateConfig.frequency;

        // Check if schedule has transactions
        const hasTrans = scheduleHasTransactions(s.id, nextDateStr, isOneTime);

        // Get schedule status using the shared function
        const status = getStatus(nextDateStr, Boolean(s.completed), hasTrans);

        const payeeName = payeeId ? payeeMap.get(payeeId) : null;
        const displayName = s.schedule_name || payeeName || 'Unknown';

        // Create schedule entity with date config for occurrence calculation
        const scheduleWithDate = {
          ...s,
          next_date: nextDateStr,
          _date: dateConfig,
          _amount: scheduleAmount,
        };

        // Calculate occurrences for this schedule ONLY in the target month
        // This will automatically filter out months where there are no occurrences
        let occurrences = getScheduleOccurrencesInMonth({
          s: scheduleWithDate,
          month,
        });

        // Filter out occurrences that are in the past (already happened)
        // If the schedule is paid, exclude today's occurrence since it's already accounted for
        // Otherwise include today since schedules due today should be counted
        const today = monthUtils.currentDay();
        occurrences = occurrences.filter(occ => {
          const occDate = monthUtils.dayFromDate(occ);
          return status === 'paid' ? occDate > today : occDate >= today;
        });

        // Add schedule to the list if it has future occurrences in the target month
        const occurrenceCount = occurrences.length;
        if (occurrenceCount > 0) {
          const amount = Number(scheduleAmount);
          if (!isNaN(amount) && amount > 0) {
            scheduleDetails.push({
              id: s.id,
              name: displayName,
              amount,
              occurrences: occurrenceCount,
              total: amount * occurrenceCount,
              status,
            });
          }
        }
      } catch (scheduleError) {
        logger.error(
          `[FORECAST ERROR] Processing schedule ${s.id}:`,
          scheduleError,
        );
      }
    });

    return scheduleDetails;
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
    // Fetch all active schedules by joining with rules table and extracting amount/date
    const schedules = db.runQuery<ScheduleQueryResult>(
      `SELECT
        s.id,
        s.rule,
        s.completed,
        snd.local_next_date as next_date,
        r.conditions,
        r.actions
       FROM schedules s
       JOIN schedules_next_date snd ON snd.schedule_id = s.id
       LEFT JOIN rules r ON r.id = s.rule
       WHERE s.tombstone = 0
       AND s.completed = 0`,
      [],
      true,
    );

    if (schedules.length === 0) {
      return currentToBudget;
    }

    // Calculate expected income from schedules
    let totalExpectedIncome = 0;

    schedules.forEach(s => {
      try {
        // Skip schedules with no matching rule
        if (!s.conditions || !s.actions) {
          return;
        }

        // Parse the rule's conditions from JSON
        const conditions =
          typeof s.conditions === 'string'
            ? JSON.parse(s.conditions)
            : s.conditions;

        // Extract schedule conditions using the shared utility
        const conds = extractScheduleConds(conditions);

        // Get amount and date from conditions
        const scheduleAmount = conds.amount?.value;
        const dateConfig = conds.date?.value;

        // Skip if no amount or date
        if (!scheduleAmount || !dateConfig || Number(scheduleAmount) <= 0) {
          return;
        }

        // Convert next_date from integer to string format
        const nextDateStr = formatDateInt(s.next_date);

        // Check if schedule is one-time (no frequency)
        const isOneTime = !dateConfig.frequency;

        // Check if schedule has transactions
        const hasTrans = scheduleHasTransactions(s.id, nextDateStr, isOneTime);

        // Get schedule status using the shared function
        const status = getStatus(nextDateStr, Boolean(s.completed), hasTrans);

        // Create schedule entity with date config for occurrence calculation
        const scheduleWithDate = {
          ...s,
          next_date: nextDateStr,
          _date: dateConfig,
          _amount: scheduleAmount,
        };

        // Calculate occurrences for this schedule UP TO the target month
        // (includes all months from now through the target month)
        let occurrences = getScheduleOccurrencesUpToMonth({
          s: scheduleWithDate,
          month,
        });

        // Filter out occurrences that are in the past (already happened)
        // If the schedule is paid, exclude today's occurrence since it's already accounted for
        // Otherwise include today since schedules due today should be counted
        const today = monthUtils.currentDay();
        occurrences = occurrences.filter(occ => {
          const occDate = monthUtils.dayFromDate(occ);
          return status === 'paid' ? occDate > today : occDate >= today;
        });

        // Add future occurrences to the total expected income
        const totalOccurrences = occurrences.length;
        if (totalOccurrences > 0) {
          const amount = Number(scheduleAmount);
          if (!isNaN(amount) && amount > 0) {
            totalExpectedIncome += amount * totalOccurrences;
          }
        }
      } catch (scheduleError) {
        logger.error(
          `[FORECAST ERROR] Processing schedule ${s.id}:`,
          scheduleError,
        );
      }
    });

    return totalExpectedIncome + currentToBudget;
  } catch (error) {
    logger.error('Error calculating forecasted to budget:', error);
    return currentToBudget; // Fallback to current value on error
  }
}
