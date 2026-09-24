// CUSTOM: Forecast Budget Feature
import React, { useEffect, useState } from 'react';
import { Trans } from 'react-i18next';

import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { send } from '@actual-app/core/platform/client/connection';
import type { ForecastedScheduleDetail } from '@actual-app/core/server/budget/forecast';

import { FinancialText } from '#components/FinancialText';
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
    let isCancelled = false;

    async function fetchSchedules() {
      setIsLoading(true);
      try {
        const result = await send('budget/get-forecasted-schedules', {
          month,
        });
        if (!isCancelled) {
          setSchedules(result ?? []);
        }
      } catch (error) {
        console.error('Error fetching forecasted schedules:', error);
        if (!isCancelled) {
          setSchedules([]);
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    }

    void fetchSchedules();
    return () => {
      isCancelled = true;
    };
  }, [month]);

  if (isLoading || schedules.length === 0) {
    return (
      <View style={{ marginTop: 10, paddingLeft: 20 }}>
        <Text style={{ color: theme.formInputTextPlaceholder, fontSize: 13 }}>
          {isLoading ? (
            <Trans>Loading schedules…</Trans>
          ) : (
            <Trans>No scheduled income found</Trans>
          )}
        </Text>
      </View>
    );
  }

  return (
    <View style={{ marginTop: 10, gap: 6, alignItems: 'center' }}>
      {schedules.map(schedule => (
        <View
          key={schedule.id}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
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
            <FinancialText
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
            </FinancialText>
          </PrivacyFilter>
        </View>
      ))}
    </View>
  );
}
