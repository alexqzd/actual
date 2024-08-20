import React from 'react';

import { css } from 'glamor';

import { rolloverBudget } from 'loot-core/src/client/queries';

import { theme, styles, type CSSProperties } from '../../../../style';
import { Block } from '../../../common/Block';
import { Tooltip } from '../../../common/Tooltip';
import { View } from '../../../common/View';
import { PrivacyFilter } from '../../../PrivacyFilter';
import { useFormat } from '../../../spreadsheet/useFormat';
import { useSheetName } from '../../../spreadsheet/useSheetName';
import { useSheetValue } from '../../../spreadsheet/useSheetValue';

import { TotalsList } from './TotalsList';

import { useMemo } from 'react';

import { useSchedules } from 'loot-core/src/client/data-hooks/schedules';

import { currentDate, monthFromDate } from 'loot-core/shared/months';

import { recurConfigToRSchedule } from 'loot-core/src/shared/schedules';
import { Schedule as RSchedule } from 'loot-core/src/server/util/rschedule';
import * as d from 'date-fns';
import { dayFromDate } from 'loot-core/src/shared/months';
import { captureBreadcrumb } from 'loot-core/src/platform/exceptions';

export function getDateWithSkippedWeekend(
  date: Date,
  solveMode: 'after' | 'before',
) {
  if (d.isWeekend(date)) {
    if (solveMode === 'after') {
      return d.nextMonday(date);
    } else if (solveMode === 'before') {
      return d.previousFriday(date);
    } else {
      throw new Error('Unknown weekend solve mode, this should not happen!');
    }
  }
  return date;
}

function getScheduleOcurrencesUpToMonth({ s, month }) {
  const config = s._date;
    // if the frequency is undefined, we assume it's a one-time schedule
    if (!config.frequency) {
      // if one-time schedule, we return the date it's supposed to happen if it has happened before or on the given month
      const monthIsScheduled = monthFromDate(config)
      return monthIsScheduled <= month ? [config] : [];

    }
    const rules = recurConfigToRSchedule(config);

  try {
    const schedule = new RSchedule({ rrules: rules });


    var count = 366;

    if (config.frequency === 'daily') {
      count = 31;
    } else if (config.frequency === 'weekly') {
      count = 4;
    }

    const yearMonth = String(month).slice(0, 7);
    const year = Number(yearMonth.slice(0, 4));
    const monthIndex = Number(yearMonth.slice(5, 7)) - 1; // month is 0-indexed
    const firstDayMonth = new Date(year, monthIndex, 1);

    return schedule
      .occurrences({ start: s.next_date, end: d.endOfMonth(firstDayMonth), take: count })
      .toArray()
      .map(date =>
        config.skipWeekend
          ? getDateWithSkippedWeekend(date.date, config.weekendSolveMode)
          : date.date,
      )//.filter(date => monthFromDate(date) === month).map(date => dayFromDate(date))
      .map(date => dayFromDate(date));
  } catch (err) {
    captureBreadcrumb(config);
    throw err;
  }
}

type ForecastedToBudgetAmountProps = {
  month: string;
  prevMonthName: string;
  style?: CSSProperties;
  amountStyle?: CSSProperties;
  onClick: () => void;
  isTotalsListTooltipDisabled?: boolean;
};

export function ForecastedToBudgetAmount({
  month,
  prevMonthName,
  style,
  amountStyle,
  onClick,
  isTotalsListTooltipDisabled = false,
}: ForecastedToBudgetAmountProps) {
  const sheetName = useSheetName(rolloverBudget.toBudget);
  const sheetValue = useSheetValue({
    name: rolloverBudget.toBudget,
    value: 0,
  });
  const format = useFormat();
  const availableValue = parseInt(sheetValue);
  const num = isNaN(availableValue) ? 0 : availableValue;
  const isNegative = num < 0;

  const scheduleData = useSchedules()

  const schedules = useMemo(
    ()  => {
      return scheduleData
        ? scheduleData.schedules.filter(
            s =>
              !s.completed && Number(s._amount) > 0 && (// schedules that are not completed (i.e. still active)
             (['due', 'upcoming', 'missed', 'scheduled'].includes(
                scheduleData.statuses.get(s.id),
              ) // and are due, upcoming, missed, or scheduled (i.e. haven't occurred yet)
              //and next date is equal or greater than the current budget month
              && monthFromDate(s.next_date) <= month
            ) 
              ||
              //or have occurred and next date is not the current budget month
              ['paid'].includes( // paid is only shown in the day of the schedule
                                 // so we want to include it in the months that are not the current month being processed
                scheduleData.statuses.get(s.id),
              ) && monthFromDate(s.next_date) !== month
              )
          )
        : []},
    [scheduleData],
  );

  const schedulesThisMonth = useMemo(() => {
    const schedulesThisMonth = [];
    schedules.forEach(s => {
      var occurrences = getScheduleOcurrencesUpToMonth({ s: s, month: month });
      console.log(s.name, "occurrences", occurrences, "in month", month, "status", scheduleData.statuses.get(s.id));
      const alreadyPaid = scheduleData.statuses.get(s.id) === 'paid';
      // if already paid, we don't want to count it if the month we are processing is the current month
      // because the schedule is only shown as paid in the day of the schedule
      if (alreadyPaid) {
        // if the schedule is paid, we want to remove the first occurrence
        // because it's the one that has already happened
        // only if today's date is greater or equal to the next date
        const today = currentDate();
        const nextDate = new Date(s.next_date); // Convert s.next_date to a Date object
        console.log(s.name, "is already paid, next date", nextDate, "today", today);
      //  if (today >= nextDate) {
          console.log(s.name, "is already paid, removing first occurrence");
          occurrences = occurrences.slice(1);
       // }
      }
      if (!alreadyPaid || monthFromDate(s.next_date) !== month) {
        const timesThisMonth = occurrences.length;
        if (timesThisMonth > 0) {
          const id = s.id;
          const amount = s._amount;
          const frequency = s._date.frequency;
          schedulesThisMonth.push({ id, name: s.name, amount: amount, frequency, timesThisMonth });
        }
      }
    });
    return schedulesThisMonth;
  }, [schedules]);

  const totalIncomeExpected = useMemo(() => {
    return schedulesThisMonth.reduce((acc, s) => acc + s.amount * s.timesThisMonth, 0) + num;
  }, [schedulesThisMonth, num]);

  return (
    <View>
      {isNegative && (
        <View style={{ alignItems: 'center', marginTop: 15, ...style }}>
        <Block>Expected to budget:</Block>
        <PrivacyFilter blurIntensity={7}>
            <Block
              className={`${css([
                styles.veryLargeText,
                {
                  fontWeight: 400,
                  userSelect: 'none',
                  color: totalIncomeExpected < 0 ? theme.errorTextMenu : theme.formInputTextPlaceholder,
                  marginBottom: -1,
                  borderBottom: '1px solid transparent',
                },
                amountStyle,
              ])}`}
            >
              {format(totalIncomeExpected, 'financial')}
            </Block>
          </PrivacyFilter>
        </View>
      )}
    </View>
  );
}
