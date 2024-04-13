import React, { useState, type ComponentPropsWithoutRef } from 'react';
import { useMemo } from 'react';

import { css } from 'glamor';

import { rolloverBudget } from 'loot-core/src/client/queries';

import { theme, styles, type CSSProperties } from '../../../../style';
import { Block } from '../../../common/Block';
import { HoverTarget } from '../../../common/HoverTarget';
import { Menu } from '../../../common/Menu';
import { View } from '../../../common/View';
import { PrivacyFilter } from '../../../PrivacyFilter';
import { useFormat } from '../../../spreadsheet/useFormat';
import { useSheetName } from '../../../spreadsheet/useSheetName';
import { useSheetValue } from '../../../spreadsheet/useSheetValue';
import { Tooltip } from '../../../tooltips';
import { HoldTooltip } from '../HoldTooltip';
import { TransferTooltip } from '../TransferTooltip';

import {
  useSchedules,
} from 'loot-core/src/client/data-hooks/schedules';

import { TotalsList } from './TotalsList';
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

function getScheduleOcurrencesUpToMonth({ config, month }) {

    // if the frequency is undefined, we assume it's a one-time schedule
    if (!config.frequency) {
      // if one-time schedule, we return the date it's supposed to happen if it has happened before or on the given month
      const monthIsScheduled = monthFromDate(config)
      return monthIsScheduled <= month ? [config] : [];
      
    }
    const rules = recurConfigToRSchedule(config);

  try {
    const schedule = new RSchedule({ rrules: rules });


    var count = 1;

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
    // start today, end the last day of the given month
      .occurrences({ start: currentDate(), end: d.endOfMonth(firstDayMonth), take: 365 })
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

type ToBudgetProps = {
  month: string;
  onBudgetAction: (idx: string, action: string, arg?: unknown) => void;
  prevMonthName: string;
  showTotalsTooltipOnHover?: boolean;
  style?: CSSProperties;
  amountStyle?: CSSProperties;
  menuTooltipProps?: ComponentPropsWithoutRef<typeof Tooltip>;
  totalsTooltipProps?: ComponentPropsWithoutRef<typeof Tooltip>;
  holdTooltipProps?: ComponentPropsWithoutRef<typeof HoldTooltip>;
  transferTooltipProps?: ComponentPropsWithoutRef<typeof TransferTooltip>;
};
export function ToBudget({
  month,
  prevMonthName,
  showTotalsTooltipOnHover,
  onBudgetAction,
  style,
  amountStyle,
  menuTooltipProps,
  totalsTooltipProps,
  holdTooltipProps,
  transferTooltipProps,
}: ToBudgetProps) {
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
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
      console.log('Calculating schedules for month', month);
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
      const occurrences = getScheduleOcurrencesUpToMonth({ config: s._date, month: month });
      console.log('Occurrences for schedule', s.name, occurrences);
      const timesThisMonth = occurrences.length;
      if (timesThisMonth > 0) {
        const id = s.id;
        const amount = s._amount;
        const frequency = s._date.frequency;
        schedulesThisMonth.push({ id, name: s.name, amount: amount, frequency, timesThisMonth });
      }
    });
    return schedulesThisMonth;
  }, [schedules]);
  
  const totalIncomeExpected = useMemo(() => {
    return schedulesThisMonth.reduce((acc, s) => acc + s.amount * s.timesThisMonth, 0) + num;
  }, [schedulesThisMonth, num]);

  return (
    <View style={{ alignItems: 'center', ...style }}>
      <Block>{isNegative ? 'Overbudgeted:' : 'To Budget:'}</Block>
      <View>
        <HoverTarget
          disabled={!showTotalsTooltipOnHover || !!menuOpen}
          renderContent={() => (
            <Tooltip position="bottom-center" {...totalsTooltipProps}>
              <TotalsList
                prevMonthName={prevMonthName}
                style={{
                  padding: 7,
                }}
              />
            </Tooltip>
          )}
        >
          <PrivacyFilter blurIntensity={7}>
            <Block
              onClick={() => setMenuOpen('actions')}
              data-cellname={sheetName}
              className={`${css([
                styles.veryLargeText,
                {
                  fontWeight: 400,
                  userSelect: 'none',
                  cursor: 'pointer',
                  color: isNegative ? theme.errorText : theme.pageTextPositive,
                  marginBottom: -1,
                  borderBottom: '1px solid transparent',
                  ':hover': {
                    borderColor: isNegative
                      ? theme.errorBorder
                      : theme.pageTextPositive,
                  },
                },
                amountStyle,
              ])}`}
            >
              {format(num, 'financial')}
            </Block>
          </PrivacyFilter>
        </HoverTarget>
        {menuOpen === 'actions' && (
          <Tooltip
            position="bottom-center"
            width={200}
            style={{ padding: 0 }}
            onClose={() => setMenuOpen(null)}
            {...menuTooltipProps}
          >
            <Menu
              onMenuSelect={type => {
                if (type === 'reset-buffer') {
                  onBudgetAction(month, 'reset-hold');
                  setMenuOpen(null);
                } else {
                  setMenuOpen(type);
                }
              }}
              items={[
                {
                  name: 'transfer',
                  text: 'Move to a category',
                },
                {
                  name: 'buffer',
                  text: 'Hold for next month',
                },
                {
                  name: 'reset-buffer',
                  text: 'Reset next month’s buffer',
                },
              ]}
            />
          </Tooltip>
        )}
        {menuOpen === 'buffer' && (
          <HoldTooltip
            onClose={() => setMenuOpen(null)}
            onSubmit={amount => {
              onBudgetAction(month, 'hold', { amount });
            }}
            {...holdTooltipProps}
          />
        )}
        {menuOpen === 'transfer' && (
          <TransferTooltip
            initialAmount={availableValue}
            onClose={() => setMenuOpen(null)}
            onSubmit={(amount, category) => {
              onBudgetAction(month, 'transfer-available', {
                amount,
                category,
              });
            }}
            {...transferTooltipProps}
          />
        )}
      </View>
      {isNegative && (
        <View style={{ alignItems: 'center', marginTop: 15, ...style }}>
        <Block>Expected to budget</Block>
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
