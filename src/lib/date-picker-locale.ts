/**
 * 日期选择器中文本地化文案与星期表头
 *
 * 从 DateTimePicker 组件中抽离，避免组件文件导出非组件成员
 * （react-refresh/only-export-components 规则）。
 */

import type { IntlTranslations } from '@zag-js/date-picker';

export const zhTranslations = {
  dayCell: (state: { label: string }) => state.label,
  nextTrigger: () => '下一月',
  monthSelect: '月份',
  yearSelect: '年份',
  viewTrigger: () => '切换视图',
  prevTrigger: () => '上一月',
  clearTrigger: '清除',
  trigger: (open: boolean) => (open ? '关闭日历' : '选择日期'),
  content: '日期选择器',
  placeholder: () => ({ year: '年', month: '月', day: '日' }),
  presetTrigger: (value: string[]) => value.join(', '),
} as unknown as IntlTranslations;

export const WEEK_DAYS = ['日', '一', '二', '三', '四', '五', '六'];
