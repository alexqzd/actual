// CUSTOM: Forecast Budget Feature
import React, { useState } from 'react';
import type { CSSProperties } from 'react';
import { Trans } from 'react-i18next';

import { Block } from '@actual-app/components/block';
import { SvgExpandArrow } from '@actual-app/components/icons/v0';
import { styles } from '@actual-app/components/styles';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { css } from '@emotion/css';

import { useEnvelopeSheetValue } from '#components/budget/envelope/EnvelopeBudgetComponents';
import { FinancialText } from '#components/FinancialText';
import { PrivacyFilter } from '#components/PrivacyFilter';
import { useFormat } from '#hooks/useFormat';
import { envelopeBudget } from '#spreadsheet/bindings';

import { ForecastedSchedulesList } from './ForecastedSchedulesList';

type ForecastedToBudgetAmountProps = {
  month: string;
  style?: CSSProperties;
  amountStyle?: CSSProperties;
  onClick?: () => void;
};

export function ForecastedToBudgetAmount({
  month,
  style,
  amountStyle,
  onClick,
}: ForecastedToBudgetAmountProps) {
  const format = useFormat();
  const [isExpanded, setIsExpanded] = useState(false);

  const forecastValue = useEnvelopeSheetValue({
    name: envelopeBudget.forecastedToBudget,
    value: 0,
  });

  const num =
    typeof forecastValue === 'number' && !isNaN(forecastValue)
      ? forecastValue
      : 0;
  const isNegative = num < 0;

  return (
    <View>
      <View style={{ alignItems: 'center', marginTop: 0, ...style }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            cursor: 'pointer',
            userSelect: 'none',
          }}
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <SvgExpandArrow
            width={8}
            height={8}
            style={{
              marginRight: 5,
              flexShrink: 0,
              transition: 'transform .1s',
              transform: isExpanded ? '' : 'rotate(-90deg)',
            }}
          />
          <Block>
            <Trans>Expected to budget:</Trans>
          </Block>
        </View>
        <PrivacyFilter>
          <Block
            className={css([
              styles.veryLargeText,
              {
                fontWeight: 400,
                userSelect: 'none',
                color: isNegative
                  ? theme.errorText
                  : theme.formInputTextPlaceholder,
                ...amountStyle,
              },
            ])}
            onClick={onClick}
            data-testid="expected-to-budget"
          >
            <FinancialText>{format(num, 'financial')}</FinancialText>
          </Block>
        </PrivacyFilter>
      </View>
      {isExpanded && <ForecastedSchedulesList month={month} />}
    </View>
  );
}
