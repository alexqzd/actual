// @ts-strict-ignore
import * as d from 'date-fns';

import { logger } from '../../platform/server/log';
import * as monthUtils from '../../shared/months';
import { currentDate, monthFromDate } from '../../shared/months';
import { q } from '../../shared/query';
import {
  extractScheduleConds,
  getDateWithSkippedWeekend,
  recurConfigToRSchedule,
} from '../../shared/schedules';
import { ScheduleEntity } from '../../types/models';
import { aqlQuery } from '../aql';
import * as db from '../db';
import { Schedule as RSchedule } from '../util/rschedule';

/**
 * Schedule data returned from the database query
 */
interface ScheduleQueryResult {
  id: string;
  rule: string;
  completed: number;
  next_date: number | string;
  conditions: string | null;
  actions: string | null;
}

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
  if (!config.frequency) {
    // If one-time schedule, return the date if it happens before or on the given month
    const monthIsScheduled = monthFromDate(config.start);
    return monthIsScheduled <= month ? [config] : [];
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
 * Check if a schedule has associated transactions near its next_date
 */
function scheduleHasTransactions(
  scheduleId: string,
  nextDate: string,
): boolean {
  try {
    // Check for transactions within 2 days of the schedule date
    const twoDaysBack = monthUtils.subDays(nextDate, 2);

    const result = db.runQuery<{ count: number }>(
      `SELECT COUNT(*) as count FROM transactions
       WHERE schedule = ?
       AND date >= ?
       AND tombstone = 0`,
      [scheduleId, twoDaysBack],
      true,
    );

    return result.length > 0 && result[0].count > 0;
  } catch (error) {
    logger.error('Error checking schedule transactions:', error);
    return false;
  }
}

/**
 * Get the status of a schedule based on its next_date and completion status
 */
function getScheduleStatus(
  nextDate: string,
  completed: boolean,
  hasTrans: boolean,
): string {
  const upcomingDays = 7;
  const today = monthUtils.currentDay();

  if (completed) {
    return 'completed';
  } else if (hasTrans) {
    return 'paid';
  } else if (nextDate === today) {
    return 'due';
  } else if (
    nextDate > today &&
    nextDate <= monthUtils.addDays(today, upcomingDays)
  ) {
    return 'upcoming';
  } else if (nextDate < today) {
    return 'missed';
  } else {
    return 'scheduled';
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

        // Parse the rule's conditions and actions from JSON
        const conditions =
          typeof s.conditions === 'string'
            ? JSON.parse(s.conditions)
            : s.conditions;
        const actions =
          typeof s.actions === 'string' ? JSON.parse(s.actions) : s.actions;

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

        // Check if schedule has transactions
        const hasTrans = scheduleHasTransactions(s.id, nextDateStr);

        // Get schedule status
        const status = getScheduleStatus(
          nextDateStr,
          Boolean(s.completed),
          hasTrans,
        );

        // Determine if this schedule should be included
        let shouldInclude = false;

        if (
          ['due', 'upcoming', 'missed', 'scheduled'].includes(status) &&
          monthFromDate(nextDateStr) <= month
        ) {
          shouldInclude = true;
        } else if (status === 'paid' && monthFromDate(nextDateStr) !== month) {
          shouldInclude = true;
        }

        if (!shouldInclude) {
          return;
        }

        // Create schedule entity with date config for occurrence calculation
        const scheduleWithDate = {
          ...s,
          next_date: nextDateStr,
          _date: dateConfig,
          _amount: scheduleAmount,
        };

        // Calculate occurrences for this schedule
        let occurrences = getScheduleOccurrencesUpToMonth({
          s: scheduleWithDate,
          month,
        });

        // If already paid, remove the first occurrence
        if (status === 'paid') {
          occurrences = occurrences.slice(1);
        }

        // Only count if not already paid or if next_date is not in the processing month
        if (!hasTrans || monthFromDate(nextDateStr) !== month) {
          const timesThisMonth = occurrences.length;
          if (timesThisMonth > 0) {
            const amount = Number(scheduleAmount);
            if (!isNaN(amount) && amount > 0) {
              totalExpectedIncome += amount * timesThisMonth;
            }
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
