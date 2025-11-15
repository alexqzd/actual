import React, { type CSSProperties, useState } from 'react';

import { css } from '@emotion/css';

import { SvgExpandArrow } from '@actual-app/components/icons/v0';

import { envelopeBudget } from '../../../../../../desktop-client/src/spreadsheet/bindings';

import { styles } from '../../../../../../component-library/src/styles';
import { theme } from '../../../../../../component-library/src/theme';
import { Block } from '../../../../../../component-library/src/Block';
import { View } from '../../../../../../component-library/src/View';
import { PrivacyFilter } from '../../../PrivacyFilter';
import { useFormat } from '../../../../../../desktop-client/src/hooks/useFormat';

import { useEnvelopeSheetValue } from '../EnvelopeBudgetComponents';
import { ForecastedSchedulesList } from './ForecastedSchedulesList';

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
  const [isExpanded, setIsExpanded] = useState(false);

  // CUSTOM: Forecast Budget Feature
  // Get forecasted to-budget value from spreadsheet
  const forecastValue = useEnvelopeSheetValue({
    name: envelopeBudget.forecastedToBudget as any,
    value: 0,
  });

  const num = isNaN(forecastValue) ? 0 : forecastValue;
  const isNegative = num < 0;

  const handleToggleExpand = () => {
    setIsExpanded(!isExpanded);
  };

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
          onClick={handleToggleExpand}
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
          <Block>Expected to budget:</Block>
        </View>
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
      {isExpanded && <ForecastedSchedulesList month={month} />}
    </View>
  );
}
