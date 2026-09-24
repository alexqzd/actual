import * as db from '#server/db';
import { loadMappings } from '#server/db/mappings';
import { createSchedule } from '#server/schedules/app';
import { loadRules } from '#server/transactions/transaction-rules';
import type { RecurConfig } from '#types/models/schedule';

import {
  calculateForecastedToBudget,
  getOccurrenceDates,
  getPendingOccurrenceDates,
  getSchedulesForForecastedToBudget,
  invalidateForecastCache,
  matchPostedOccurrences,
} from './forecast';
import type { IncomeSchedule } from './forecast';

// Tests run with currentDay() fixed at 2017-01-01.

const monthly15: RecurConfig = {
  start: '2016-12-15',
  frequency: 'monthly',
  patterns: [],
  skipWeekend: false,
  weekendSolveMode: 'after',
  endMode: 'never',
  endOccurrences: 1,
  endDate: '2016-12-15',
  interval: 1,
};

function incomeSchedule(
  overrides: Partial<IncomeSchedule> = {},
): IncomeSchedule {
  return {
    id: 's1',
    name: 'Salary',
    amount: 1000,
    nextDate: '2017-01-15',
    dateValue: monthly15,
    posts_transaction: false,
    _conditions: [{ op: 'isapprox', field: 'date', value: monthly15 }],
    ...overrides,
  };
}

describe('forecast occurrence matching', () => {
  it('generates occurrences within the range', () => {
    expect(getOccurrenceDates(monthly15, '2017-01-01', '2017-03-31')).toEqual([
      '2017-01-15',
      '2017-02-15',
      '2017-03-15',
    ]);
  });

  it('keeps weekend-adjusted occurrences in the month they land in', () => {
    // 2017-04-01 is a Saturday, "before" moves it to Friday 2017-03-31
    const firstOfMonth: RecurConfig = {
      ...monthly15,
      start: '2017-01-01',
      patterns: [{ type: 'day', value: 1 }],
      skipWeekend: true,
      weekendSolveMode: 'before',
    };
    expect(
      getOccurrenceDates(firstOfMonth, '2017-03-02', '2017-03-31'),
    ).toEqual(['2017-03-31']);
  });

  it('matches a future-dated transaction to its occurrence', () => {
    const result = matchPostedOccurrences(
      incomeSchedule(),
      ['2017-01-15', '2017-02-15'],
      ['2017-01-15'],
      '2017-01-01',
    );
    expect(result).toEqual([
      { date: '2017-01-15', posted: true },
      { date: '2017-02-15', posted: false },
    ]);
  });

  it('matches a transaction registered several days early', () => {
    const result = matchPostedOccurrences(
      incomeSchedule(),
      ['2017-01-15', '2017-02-15'],
      ['2017-01-10'],
      '2017-01-01',
    );
    expect(result[0].posted).toBe(true);
    expect(result[1].posted).toBe(false);
  });

  it('uses a transaction only once', () => {
    const pending = getPendingOccurrenceDates(
      incomeSchedule(),
      ['2017-01-15'],
      '2017-01-01',
      '2017-03-31',
    );
    expect(pending).toEqual(['2017-02-15', '2017-03-15']);
  });

  it('does not let a late payment steal the next occurrence', () => {
    // 2016-12-15 was paid late on 2016-12-28
    expect(
      getPendingOccurrenceDates(
        incomeSchedule({ nextDate: '2016-12-15' }),
        ['2016-12-28'],
        '2017-01-01',
        '2017-01-31',
      ),
    ).toEqual(['2017-01-15']);

    // Late and future-dated: still closer to the missed occurrence
    expect(
      getPendingOccurrenceDates(
        incomeSchedule({ nextDate: '2016-12-15' }),
        ['2016-12-22'],
        '2016-12-20',
        '2017-01-31',
      ),
    ).toEqual(['2017-01-15']);
  });

  it('treats a one-time schedule with a linked transaction as received', () => {
    const pending = getPendingOccurrenceDates(
      incomeSchedule({
        nextDate: '2017-01-20',
        dateValue: '2017-01-20',
        _conditions: [{ op: 'is', field: 'date', value: '2017-01-20' }],
      }),
      ['2017-01-05'],
      '2017-01-01',
      '2017-01-31',
    );
    expect(pending).toEqual([]);
  });
});

describe('calculateForecastedToBudget', () => {
  let accountId: string;

  beforeEach(async () => {
    await global.emptyDatabase()();
    await loadMappings();
    await loadRules();
    invalidateForecastCache();
    accountId = await db.insertAccount({ name: 'Checking', offbudget: 0 });
  });

  async function createIncomeSchedule(date = monthly15, amount = 1000) {
    return createSchedule({
      schedule: { name: 'Salary' },
      conditions: [
        { op: 'is', field: 'account', value: accountId },
        { op: 'is', field: 'amount', value: amount },
        { op: 'isapprox', field: 'date', value: date },
      ],
    });
  }

  it('adds pending scheduled income up to the month', async () => {
    await createIncomeSchedule();

    expect(calculateForecastedToBudget('2017-01', 50)).toBe(1050);
    expect(calculateForecastedToBudget('2017-03', 50)).toBe(3050);
    expect(getSchedulesForForecastedToBudget('2017-03')).toMatchObject([
      { name: 'Salary', amount: 1000, occurrences: 3, total: 3000 },
    ]);
  });

  it('does not double count income recorded with a future date', async () => {
    const id = await createIncomeSchedule();
    await db.insertTransaction({
      account: accountId,
      amount: 1000,
      date: '2017-01-15',
      schedule: id,
    });
    invalidateForecastCache();

    expect(calculateForecastedToBudget('2017-01', 0)).toBe(0);
    expect(calculateForecastedToBudget('2017-02', 0)).toBe(1000);
  });

  it('ignores income into off-budget accounts', async () => {
    const offBudget = await db.insertAccount({ name: 'Broker', offbudget: 1 });
    await createSchedule({
      conditions: [
        { op: 'is', field: 'account', value: offBudget },
        { op: 'is', field: 'amount', value: 1000 },
        { op: 'isapprox', field: 'date', value: monthly15 },
      ],
    });

    expect(calculateForecastedToBudget('2017-01', 0)).toBe(0);
  });

  it('uses the average of "is between" amounts', async () => {
    await createSchedule({
      conditions: [
        { op: 'is', field: 'account', value: accountId },
        { op: 'isbetween', field: 'amount', value: { num1: 900, num2: 1100 } },
        { op: 'isapprox', field: 'date', value: monthly15 },
      ],
    });

    expect(calculateForecastedToBudget('2017-01', 0)).toBe(1000);
  });

  it('ignores past months', async () => {
    await createIncomeSchedule();
    expect(calculateForecastedToBudget('2016-12', 10)).toBe(10);
  });
});
