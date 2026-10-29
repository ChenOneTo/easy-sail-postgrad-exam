import { Solar, HolidayUtil } from 'lunar-javascript';

/**
 * 获取某天的节气名称（如果没有则返回 null）
 */
export function getSolarTerm(year: number, month: number, day: number): string | null {
  try {
    const solar = Solar.fromYmd(year, month, day);
    const lunar = solar.getLunar();
    const jieQi = lunar.getJieQi();
    return jieQi || null;
  } catch {
    return null;
  }
}

/**
 * 获取某天的节假日信息
 * 返回: { name: string, type: 'festival' | 'holiday' } | null
 * - festival: 传统节日（春节、中秋等）
 * - holiday: 法定假日（国庆、元旦等）
 */
export function getHoliday(year: number, month: number, day: number): { name: string; type: 'festival' | 'holiday' } | null {
  try {
    // 法定节假日（元旦、春节、清明、五一、端午、中秋、国庆）
    const holiday = HolidayUtil.getHoliday(year, month, day);
    if (holiday && holiday.getName()) {
      return { name: holiday.getName(), type: 'holiday' };
    }

    // 公历转农历（用于查农历节日）
    const solar = Solar.fromYmd(year, month, day);
    const lunar = solar.getLunar();

    // 传统节日（农历节日）
    const festivals = lunar.getFestivals();
    if (festivals.length > 0) {
      return { name: festivals[0], type: 'festival' };
    }

    // 公历节日
    const solarFestivals = solar.getFestivals();
    if (solarFestivals.length > 0) {
      return { name: solarFestivals[0], type: 'festival' };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * 获取某天的农历日期（如"正月初一"、"腊月三十"）
 */
export function getLunarDay(year: number, month: number, day: number): string {
  try {
    const lunar = Solar.fromYmd(year, month, day).getLunar();
    return lunar.getDayInChinese();
  } catch {
    return '';
  }
}

/**
 * 获取某天的标记信息（优先节假日 > 节气 > 农历）
 *
 * 性能优化：该函数被日历视图逐格高频调用，内部只构造一次 Solar / Lunar
 * 对象，并复用 Lunar 完成节假日、节气、农历日期的全部查询，避免重复计算。
 */
export function getDayMark(year: number, month: number, day: number): {
  label: string;
  type: 'holiday' | 'festival' | 'term' | 'lunar';
} {
  // 入参校验：非法日期直接返回空标记，避免触发无谓的库调用
  if (!Number.isInteger(year) || month < 1 || month > 12 || day < 1 || day > 31) {
    return { label: '', type: 'lunar' };
  }

  let solar: Solar;
  try {
    solar = Solar.fromYmd(year, month, day);
  } catch {
    return { label: '', type: 'lunar' };
  }

  try {
    // 1. 法定节假日（元旦、春节、清明、五一、端午、中秋、国庆）
    const holiday = HolidayUtil.getHoliday(year, month, day);
    if (holiday && holiday.getName()) {
      return { label: holiday.getName(), type: 'holiday' };
    }

    // 复用同一个 Lunar 对象完成后续所有农历相关查询
    const lunar = solar.getLunar();

    // 2. 传统节日（农历节日）
    const festivals = lunar.getFestivals();
    if (festivals.length > 0) {
      return { label: festivals[0], type: 'festival' };
    }

    // 3. 公历节日
    const solarFestivals = solar.getFestivals();
    if (solarFestivals.length > 0) {
      return { label: solarFestivals[0], type: 'festival' };
    }

    // 4. 节气
    const jieQi = lunar.getJieQi();
    if (jieQi) {
      return { label: jieQi, type: 'term' };
    }

    // 5. 农历（初一显示月份名，其他显示农历日期）
    const dayInChinese = lunar.getDayInChinese();
    if (dayInChinese === '初一') {
      return { label: lunar.getMonthInChinese() + '月', type: 'lunar' };
    }
    return { label: dayInChinese, type: 'lunar' };
  } catch {
    return { label: '', type: 'lunar' };
  }
}
