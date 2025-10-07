import React, { type CSSProperties } from 'react';

import { css } from '@emotion/css';

import { envelopeBudget } from '../../../../../../desktop-client/src/spreadsheet/bindings';

import { styles } from '../../../../../../component-library/src/styles';
import { theme } from '../../../../../../component-library/src/theme';
import { Block } from '../../../../../../component-library/src/Block';
import { View } from '../../../../../../component-library/src/View';
import { PrivacyFilter } from '../../../PrivacyFilter';
import { useFormat } from '../../../../../../desktop-client/src/hooks/useFormat';

import { useEnvelopeSheetValue } from '../EnvelopeBudgetComponents';

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
  const format = useFormat();

  // CUSTOM: Forecast Budget Feature
  // Get forecasted to-budget value from spreadsheet
  const forecastValue = useEnvelopeSheetValue({
    name: envelopeBudget.forecastedToBudget as any,
    value: 0,
  });

  const num = isNaN(forecastValue) ? 0 : forecastValue;
  const isNegative = num < 0;

  return (
    <View>
      <View style={{ alignItems: 'center', marginTop: 0, ...style }}>
        <Block>Expected to budget:</Block>
        <PrivacyFilter>
          <Block
            className={css([
              styles.veryLargeText,
              {
                fontWeight: 400,
                userSelect: 'none',
                color: isNegative ? theme.errorText : theme.formInputTextPlaceholder,
                ...amountStyle,
              },
            ])}
            onClick={onClick}
            data-testid="expected-to-budget"
          >
            {format(num, 'financial')}
          </Block>
        </PrivacyFilter>
      </View>
    </View>
  );
}
