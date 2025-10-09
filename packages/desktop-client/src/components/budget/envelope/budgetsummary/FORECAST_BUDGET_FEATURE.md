# Forecast Budget Feature Documentation

## Overview

The **Forecast Budget Feature** extends Actual Budget's envelope budgeting system to show expected future income based on scheduled transactions. When the "To Budget" amount is negative (indicating overbudgeting), the system displays an "Expected to budget" amount that helps users plan months in advance by forecasting income from recurring and one-time scheduled transactions.

## Purpose

This feature enables users to:
- Budget multiple months in advance with confidence
- See projected income from scheduled transactions
- Understand their expected financial position for future months
- Make informed budgeting decisions even when currently overbudgeted

## User Interface

### Display Conditions

Located in `ToBudget.tsx:68-99`:

```typescript
const showToBudget = availableValue >= 0 || !isCollapsed;
const showForecastedToBudget = availableValue < 0;
```

**Behavior:**
- **Regular "To Budget"**: Shown when `availableValue >= 0` OR when the view is expanded
- **"Expected to budget"**: Shown when `availableValue < 0` (overbudgeted)
- Both displays can appear simultaneously with 8px vertical spacing
- Forecast amount styled with gray text (`theme.formInputTextPlaceholder`) to differentiate from the primary "To Budget" amount

### Component Locations

1. **Desktop Budget Header**: `ToBudget.tsx` - Displays in the budget summary section
2. **Budget Summary Modal**: `EnvelopeBudgetSummaryModal.tsx` - Shows in mobile/modal view

## Core Components

### 1. ForecastedToBudgetAmount.tsx

**Location**: `packages/desktop-client/src/components/budget/envelope/budgetsummary/ForecastedToBudgetAmount.tsx`

**Main Exports:**
- `calculateForecastedToBudgetAmount({ month })` - Core calculation function
- `ForecastedToBudgetAmount` - Display component
- `getScheduleOcurrencesUpToMonth({ s, month })` - Calculates schedule occurrences

### 2. Supporting Files

| File | Purpose |
|------|---------|
| `ToBudget.tsx` | Conditionally displays forecast vs regular To Budget |
| `ToBudgetAmount.tsx` | Standard "To Budget" display component |
| `EnvelopeBudgetSummaryModal.tsx` | Shows forecast in mobile/modal views |
| `TotalsList.tsx` | Shows income breakdown tooltip |

## Schedule Processing Logic

### Step 1: Filter Schedules

**Location**: `ForecastedToBudgetAmount.tsx:115-137`

Schedules are included if they meet **ALL** these criteria:

✅ **Basic Filters:**
- Not completed (`!s.completed`)
- Positive amount (`Number(s._amount) > 0`) - **Income only**

✅ **Status-Based Filter (one of the following):**

**Option A:**
- Status is `due`, `upcoming`, `missed`, or `scheduled`
- **AND** `monthFromDate(s.next_date) <= month`

**Option B:**
- Status is `paid`
- **AND** `monthFromDate(s.next_date) !== month`

> **Note on "paid" schedules**: They are only shown as paid on the day of the schedule occurrence. For future months, we include them if they're paid but not in the current processing month.

### Step 2: Calculate Occurrences

**Function**: `getScheduleOcurrencesUpToMonth({ s, month })`

#### One-Time Schedules

If `config.frequency` is undefined:
```javascript
const monthIsScheduled = monthFromDate(config)
return monthIsScheduled <= month ? [config] : [];
```

Returns the date if it occurs on or before the target month.

#### Recurring Schedules

Uses the **RSchedule** library:

1. **Convert to RRule format**: `recurConfigToRSchedule(config)`
2. **Calculate occurrences**:
   ```javascript
   const schedule = new RSchedule({ rrules: rules });
   const start_search = d.startOfMonth(nextDate);

   schedule.occurrences({
     start: start_search,
     end: d.endOfMonth(firstDayMonth),
     take: 366
   })
   ```
3. **Handle weekend skipping** (if configured):
   ```javascript
   config.skipWeekend
     ? getDateWithSkippedWeekend(date.date, config.weekendSolveMode)
     : date.date
   ```

**Weekend Solve Modes:**
- `after`: Moves to next Monday
- `before`: Moves to previous Friday

### Step 3: Handle Paid Schedules

**Location**: `ForecastedToBudgetAmount.tsx:144-158`

Special logic for already-paid schedules:

```javascript
if (alreadyPaid) {
  // Remove first occurrence because it's already happened
  console.log(s.name, "is already paid, removing first occurrence");
  occurrences = occurrences.slice(1);
}
```

**Logic:**
- If status is `paid`, remove the first occurrence (already happened)
- Only count the schedule if:
  - Not already paid, OR
  - `monthFromDate(s.next_date) !== month`

### Step 4: Calculate Total

**Location**: `ForecastedToBudgetAmount.tsx:173-175`

```javascript
const totalIncomeExpected = schedulesThisMonth.reduce(
  (acc, s) => acc + s.amount * s.timesThisMonth,
  0
) + num;
```

**Formula:**
```
Total Expected Income =
  Σ(schedule.amount × schedule.timesThisMonth)
  + current "To Budget" value
```

## Schedule Status System

**Source**: `useSchedules` hook and `loot-core/shared/schedules.ts:12-36`

### Status Definitions

| Status | Condition |
|--------|-----------|
| `completed` | Schedule is marked complete |
| `paid` | Has transaction on/near `next_date` (within 2 days for approx dates) |
| `due` | `next_date` equals today |
| `upcoming` | `next_date` is within upcoming window (default: 7 days) |
| `missed` | `next_date` < today |
| `scheduled` | All other future dates |

### Status Calculation

```javascript
function getStatus(nextDate, completed, hasTrans, upcomingLength = '7') {
  if (completed) return 'completed';
  if (hasTrans) return 'paid';
  if (nextDate === today) return 'due';
  if (nextDate > today && nextDate <= addDays(today, upcomingDays))
    return 'upcoming';
  if (nextDate < today) return 'missed';
  return 'scheduled';
}
```

**Transaction Detection:**
- Queries transactions table for matches
- Looks for transactions with `schedule` field matching schedule ID
- For "is" date conditions: matches exact date
- For "isapprox" conditions: checks within ±2 days

## Data Flow

```
┌─────────────────────────────────────────────────────────┐
│ 1. useSchedules Hook                                    │
│    - Fetches all schedules via live query               │
│    - Queries transactions to find paid schedules        │
│    - Calculates status for each schedule                │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│ 2. calculateForecastedToBudgetAmount                    │
│    - Filters for income schedules (amount > 0)          │
│    - Filters by status and date criteria                │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│ 3. getScheduleOcurrencesUpToMonth                       │
│    - For one-time: checks if date <= target month       │
│    - For recurring: uses RSchedule to calculate dates   │
│    - Applies weekend skipping if configured             │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│ 4. Handle Paid Schedules                                │
│    - Removes first occurrence if already paid           │
│    - Only counts if not in current month                │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│ 5. Aggregate & Display                                  │
│    - Sums: amount × occurrences for each schedule       │
│    - Adds current "To Budget" value                     │
│    - Displays "Expected to budget: $X"                  │
└─────────────────────────────────────────────────────────┘
```

## Data Structures

### ScheduleEntity

```typescript
{
  id: string;
  name?: string;
  rule: string;                    // RuleEntity['id']
  next_date: string;               // Format: "YYYY-MM-DD"
  completed: boolean;
  posts_transaction: boolean;
  tombstone: boolean;

  // Special fields from underlying rule:
  _payee: string;                  // PayeeEntity['id']
  _account: string;                // AccountEntity['id']
  _amount: number | { num1: number; num2: number };
  _amountOp: string;
  _date: RecurConfig;
  _conditions: RuleConditionEntity[];
  _actions: Array<{ op: unknown }>;
}
```

### RecurConfig

```typescript
{
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval?: number;               // e.g., 2 for "every 2 weeks"
  patterns?: RecurPattern[];       // For monthly: specific days
  skipWeekend?: boolean;
  start: string;                   // Format: "YYYY-MM-DD"
  endMode: 'never' | 'after_n_occurrences' | 'on_date';
  endOccurrences?: number;         // Used with 'after_n_occurrences'
  endDate?: string;                // Used with 'on_date'
  weekendSolveMode?: 'before' | 'after';
}
```

### RecurPattern

```typescript
{
  value: number;                   // Day number or week number
  type: 'SU' | 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'day';
}
```

## Dependencies

### External Libraries

- **@rschedule/core**: Recurrence rule engine
- **@rschedule/standard-date-adapter**: Date handling for RSchedule
- **date-fns**: Date manipulation utilities

### Internal Modules

| Module | Purpose |
|--------|---------|
| `loot-core/shared/schedules` | Status calculation, RRule conversion |
| `loot-core/shared/months` | Date utilities (monthFromDate, currentDate) |
| `loot-core/shared/query` | Database query builder |
| `@desktop-client/hooks/useSchedules` | Live schedule data hook |
| `@desktop-client/spreadsheet/bindings` | Spreadsheet cell bindings |

### Key Imports

```typescript
// Schedule processing
import { recurConfigToRSchedule } from 'loot-core/shared/schedules';
import { Schedule as RSchedule } from 'loot-core/server/util/rschedule';

// Date utilities
import { currentDate, monthFromDate } from 'loot-core/shared/months';
import * as d from 'date-fns';

// Data fetching
import { useSchedules } from '@desktop-client/hooks/useSchedules';
import { q } from 'loot-core/shared/query';

// Spreadsheet integration
import { useEnvelopeSheetValue } from '../EnvelopeBudgetComponents';
import { envelopeBudget } from '@desktop-client/spreadsheet/bindings';
```

## Spreadsheet Integration

The forecast feature integrates with Actual's spreadsheet system:

**Binding**: `envelopeBudget.toBudget` → `'to-budget'`

```typescript
// Get current "To Budget" value
const sheetValue = useEnvelopeSheetValue({
  name: envelopeBudget.toBudget,
  value: 0,
});
```

This binding connects to the envelope budget spreadsheet that calculates:
- Available funds
- Overspent from last month
- Total budgeted
- For next month buffer

## Notable Design Decisions

### 1. Income-Only Filtering
**Why**: The feature is designed to forecast available funds to budget, which comes from income. Expense schedules would reduce available funds but are already reflected in category budgets.

### 2. Paid Schedule Handling
**Logic**:
- Paid schedules show as "paid" only on the day they occur
- For future month calculations, we exclude the first (paid) occurrence but include future ones
- This prevents double-counting income that's already been received

### 3. Weekend Skipping
**Why**: Many real-world recurring transactions (like paychecks) don't occur on weekends. The system can automatically adjust:
- **After mode**: Shift Saturday/Sunday to next Monday
- **Before mode**: Shift Saturday/Sunday to previous Friday

### 4. Month Comparison
**Format**: Uses `monthFromDate()` returning `"YYYY-MM"` format
- Allows simple string comparison: `"2025-03" <= "2025-10"`
- Consistent with Actual's month handling throughout the app

### 5. RSchedule Integration
**Why**: Provides a robust, battle-tested recurrence engine that handles:
- Complex recurring patterns (e.g., "2nd and 4th Monday of every month")
- Edge cases (leap years, month boundaries, etc.)
- Standard iCalendar RRULE format

### 6. Live Query Updates
**Why**: Uses `liveQuery` for reactive updates
- Automatically refreshes when schedules change
- Updates when transactions are added/modified
- Ensures forecast is always current

### 7. Max 366 Occurrences
**Why**: Limits the calculation window to prevent performance issues with daily schedules:
```javascript
var count = 366;  // Maximum one year of daily occurrences
```

## Example Scenarios

### Scenario 1: Simple Bi-Weekly Paycheck

**Schedule**:
- Amount: $2,000
- Frequency: Every 2 weeks on Friday
- Next date: Oct 4, 2025
- Status: scheduled

**Processing for October 2025**:
1. Filter: ✅ Income, not completed, scheduled, next_date in Oct
2. Calculate occurrences: Oct 4, Oct 18
3. Times this month: 2
4. Contribution: $2,000 × 2 = $4,000

### Scenario 2: Monthly Freelance Income (Already Paid)

**Schedule**:
- Amount: $1,500
- Frequency: Monthly on the 1st
- Next date: Oct 1, 2025
- Status: paid (transaction exists for Oct 1)

**Processing for November 2025**:
1. Filter: ✅ Income, not completed, paid, next_date ≠ Nov
2. Calculate occurrences: Oct 1, Nov 1, Dec 1 (up to Nov)
3. Remove first (already paid): Nov 1, Dec 1
4. Filter for Nov only: Nov 1
5. Times this month: 1
6. Contribution: $1,500 × 1 = $1,500

### Scenario 3: One-Time Bonus

**Schedule**:
- Amount: $5,000
- Frequency: None (one-time)
- Date: Dec 15, 2025
- Status: scheduled

**Processing for December 2025**:
1. Filter: ✅ Income, not completed, scheduled
2. Check: monthFromDate("2025-12-15") <= "2025-12" ✅
3. Return: ["2025-12-15"]
4. Times this month: 1
5. Contribution: $5,000 × 1 = $5,000

## Debugging

### Console Logs

The feature includes several debug console logs:

```javascript
// Line 153: Paid schedule detection
console.log(s.name, "is already paid, next date", nextDate, "today", today);

// Line 155: Occurrence removal
console.log(s.name, "is already paid, removing first occurrence");

// Line 166: Schedule occurrence details
console.log(s.name, "occurrences", occurrences, "timesThisMonth", timesThisMonth);

// Line 190: Final calculation
console.log("month", month, "totalIncomeExpected", totalIncomeExpected);
```

### Common Issues

**Issue**: Schedule not showing in forecast
- Check schedule status (must be due/upcoming/missed/scheduled/paid)
- Verify amount is positive (income only)
- Confirm `next_date <= target_month`
- Check if schedule is marked completed

**Issue**: Wrong number of occurrences
- Verify `next_date` is set correctly
- Check recurrence configuration (interval, patterns)
- Look for weekend skipping configuration
- Review console logs for occurrence calculation

**Issue**: Paid schedule counted incorrectly
- Check transaction exists and links to schedule
- Verify current month vs. processing month
- Review paid schedule removal logic

## Future Enhancements

Potential improvements to consider:

1. **Expense Forecasting**: Add support for showing expected expenses
2. **Confidence Indicators**: Show probability/confidence for income estimates
3. **Amount Ranges**: Better handling of amount ranges (`{ num1, num2 }`)

## Testing Considerations

When testing this feature:

1. **Test various schedule types**:
   - Daily, weekly, monthly, yearly
   - Different intervals (every 2 weeks, every 3 months)
   - Complex patterns (2nd Tuesday, last Friday)

2. **Test edge cases**:
   - Schedules ending mid-month
   - Weekend skipping behavior
   - Month boundaries
   - Leap years

3. **Test status transitions**:
   - Schedule becomes paid
   - Schedule is completed
   - Schedule is missed

4. **Test UI states**:
   - Positive "To Budget" (forecast hidden)
   - Negative "To Budget" (forecast shown)
   - Large forecast amounts (formatting)

## Related Files

### Core Feature Files
- `packages/desktop-client/src/components/budget/envelope/budgetsummary/ForecastedToBudgetAmount.tsx`
- `packages/desktop-client/src/components/budget/envelope/budgetsummary/ToBudget.tsx`
- `packages/desktop-client/src/components/budget/envelope/budgetsummary/ToBudgetAmount.tsx`

### Supporting Files
- `packages/desktop-client/src/hooks/useSchedules.ts`
- `packages/loot-core/src/shared/schedules.ts`
- `packages/loot-core/src/shared/months.ts`
- `packages/loot-core/src/server/util/rschedule.ts`

### Type Definitions
- `packages/loot-core/src/types/models/schedule.ts`

### Spreadsheet Bindings
- `packages/desktop-client/src/spreadsheet/bindings.ts` (line 161-187)

---

**Last Updated**: October 2025
**Feature Status**: Active
**Budget Type**: Envelope Budgeting Only
