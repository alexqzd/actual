import React, { useEffect, useState } from 'react';
import { Trans } from 'react-i18next';


import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { send } from '@actual-app/core/platform/client/connection';
import { type ForecastedScheduleDetail } from '@actual-app/core/server/budget/forecast';

import { PrivacyFilter } from '#components/PrivacyFilter';
import { useFormat } from '#hooks/useFormat';

type ForecastedSchedulesListProps = {
  month: string;
};

export function ForecastedSchedulesList({
  month,
}: ForecastedSchedulesListProps) {
  const format = useFormat();
  const [schedules, setSchedules] = useState<ForecastedScheduleDetail[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchSchedules() {
      try {
        setIsLoading(true);
        const budgetMonth = await send('api/budget-month', { month });
        setSchedules(budgetMonth.forecastedSchedules || []);
      } catch (error) {
        console.error('Error fetching forecasted schedules:', error);
        setSchedules([]);
      } finally {
        setIsLoading(false);
      }
    }

    fetchSchedules();
  }, [month]);

  if (isLoading) {
    return (
      <View
        style={{
          marginTop: 10,
          paddingLeft: 20,
        }}
      >
        <Text style={{ color: theme.formInputTextPlaceholder, fontSize: 13 }}>
          Loading schedules...
        </Text>
      </View>
    );
  }

  if (schedules.length === 0) {
    return (
      <View
        style={{
          marginTop: 10,
          paddingLeft: 20,
        }}
      >
        <Text style={{ color: theme.formInputTextPlaceholder, fontSize: 13 }}><Trans>
          No scheduled income found
        </Trans></Text>
      </View>
    );
  }

  return (
    <View
      style={{
        marginTop: 10,
        gap: 6,
        alignItems: 'center',
      }}
    >
      {schedules.map(schedule => (
        <View
          key={schedule.id}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Text
            style={{
              fontSize: 13,
              color: theme.tableText,
              whiteSpace: 'nowrap',
            }}
          >
            {schedule.name}:
          </Text>
          <PrivacyFilter>
            <Text
              style={{
                fontSize: 13,
                color: theme.tableText,
                fontWeight: 500,
                whiteSpace: 'nowrap',
              }}
            >
              {schedule.occurrences > 1
                ? `${format(schedule.amount, 'financial')} × ${schedule.occurrences} = ${format(schedule.total, 'financial')}`
                : format(schedule.total, 'financial')}
            </Text>
          </PrivacyFilter>
        </View>
      ))}
    </View>
  );
}
