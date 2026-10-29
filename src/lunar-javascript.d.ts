/**
 * lunar-javascript 最小类型声明
 *
 * 该库未自带 TypeScript 类型，也未发布到 @types。
 * 此文件仅声明项目中实际使用的 API，消除 ts(7016) 提示并保留类型检查。
 * 库地址: https://github.com/6tail/lunar-javascript
 */

declare module 'lunar-javascript' {
  /** 公历 */
  export class Solar {
    static fromYmd(year: number, month: number, day: number): Solar;
    static fromDate(date: Date): Solar;
    getLunar(): Lunar;
    getFestivals(): string[];
    /** 公历日 */
    getDay(): number;
    /** 公历月 (1-12) */
    getMonth(): number;
    /** 公历年 */
    getYear(): number;
  }

  /** 农历 */
  export class Lunar {
    static fromYmd(year: number, month: number, day: number): Lunar;
    static fromDate(date: Date): Lunar;
    /** 节气名，无则返回空字符串 */
    getJieQi(): string;
    /** 农历节日列表 */
    getFestivals(): string[];
    /** 农历日的中文名，如"初一"、"十五" */
    getDayInChinese(): string;
    /** 农历月的中文名，如"正"、"腊" */
    getMonthInChinese(): string;
    /** 农历年 */
    getYear(): number;
    /** 农历月 (1-12，闰月为负) */
    getMonth(): number;
    /** 农历日 */
    getDay(): number;
  }

  /** 节假日工具 */
  export namespace HolidayUtil {
    /** 获取某天的节假日信息，无则返回 null */
    function getHoliday(year: number, month: number, day: number): Holiday | null;
    /** 获取某天对应的节假日对象（含调休） */
    function getHolidayByYmd(year: number, month: number, day: number): Holiday | null;
  }

  /** 节假日对象 */
  export class Holiday {
    /** 节假日名称，如"国庆节"；非假日返回空字符串 */
    getName(): string;
    /** 是否为法定节假日 */
    isHoliday(): boolean;
    /** 工作日标记（调休上班时为 true） */
    isWork(): boolean;
    getYear(): number;
    getMonth(): number;
    getDay(): number;
  }
}
