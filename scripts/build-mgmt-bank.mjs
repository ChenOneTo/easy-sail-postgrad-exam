#!/usr/bin/env node
/**
 * 构建 199 管综（数学 + 逻辑）真题题库（一次性作者工具）。
 *
 * 数据源：{MGMT_SOURCE_DIR}/{year}-管综真题.md（真题 + 答案 + 解析）
 * 产物：src/assets/exam-mgmt/mgmt-bank.json
 *
 * 用法：
 *   node scripts/build-mgmt-bank.mjs [--source <dir>] [--check-only]
 *
 * 说明：源文件是人工整理的 Markdown，五年排版不统一（2021/2024 用粗体题号，
 * 2022 用 #### 标题，2025 把逐题解析集中放在文末）。这里按「题号必须顺序递增」
 * 切块，尽量保留原文，解析不出来的字段留空并在 review.csv 里记一条。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DEFAULT_SOURCE = process.env.MGMT_SOURCE_DIR || '/Users/cgy/data/work-buddy/考研管综真题'

const args = process.argv.slice(2)
const sourceArgIndex = args.indexOf('--source')
const SOURCE_DIR = sourceArgIndex >= 0 ? args[sourceArgIndex + 1] : DEFAULT_SOURCE
const CHECK_ONLY = args.includes('--check-only')
const OUT_JSON = path.join(ROOT, 'src', 'assets', 'exam-mgmt', 'mgmt-bank.json')
const REVIEW_CSV = path.join(ROOT, 'exam-mgmt-source', 'review.csv')

const YEARS = [2021, 2022, 2023, 2024, 2025]
const MATH_RANGE = [1, 25]
const LOGIC_RANGE = [26, 55]

// ========== 文本工具 ==========

function cleanInline(text) {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/\*\*/g, '')
    .replace(/^\s*题目[：:]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function isNoiseLine(line) {
  const t = line.trim()
  if (!t) return true
  if (/^-{3,}$/.test(t)) return true
  if (/^>\s*⚠️/.test(t)) return true
  return false
}

/** 题号行 → 题号；不是题号行返回 null */
function matchQuestionNo(line) {
  const text = line.trim()
  if (/^#{2,4}\s/.test(text)) {
    const m = text.match(/^#{2,4}\s*(\d{1,2})\s*[.．、]\s*(.*)$/)
    return m ? { no: Number(m[1]), heading: m[2] } : null
  }
  const m = text.match(/^(?:\*\*)?(\d{1,2})\s*[.．、]\s*(.*)$/)
  if (!m) return null
  return { no: Number(m[1]), heading: '' }
}

// ========== 分段 ==========

function splitSections(raw) {
  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  const findLine = (pattern, from = 0) => {
    for (let i = from; i < lines.length; i++) {
      if (pattern.test(lines[i])) return i
    }
    return -1
  }
  const mathStart = findLine(/^##\s*一、数学基础/)
  const logicStart = findLine(/^##\s*二、逻辑推理/)
  const writeStart = findLine(/^##\s*三、写作/)
  return {
    math: lines.slice(
      mathStart >= 0 ? mathStart + 1 : 0,
      logicStart >= 0 ? logicStart : writeStart >= 0 ? writeStart : lines.length,
    ),
    logic: lines.slice(
      logicStart >= 0 ? logicStart + 1 : 0,
      writeStart >= 0 ? writeStart : lines.length,
    ),
    all: lines,
  }
}

/** 去掉「逐题解析」等文末区块，避免解析正文被误当题目 */
function dropExplanationBlock(lines) {
  const end = lines.findIndex((l) => /^###\s*(数学|逻辑)逐题解析/.test(l.trim()))
  return end >= 0 ? lines.slice(0, end) : lines
}

/** 抽取 2025 那种文末集中解析：`**12. 【B】** 解析正文` */
function parseExplanationSection(lines, from, to) {
  const map = new Map()
  const text = lines.join('\n')
  const re = /^\*\*(\d{1,2})\.\s*【([A-E])】\*\*\s*([\s\S]*?)(?=^\*\*\d{1,2}\.\s*【|^###|^##|$)/gm
  let m
  while ((m = re.exec(text)) !== null) {
    const no = Number(m[1])
    if (no < from || no > to) continue
    map.set(no, {
      answer: m[2],
      explanation: cleanInline(m[3]).slice(0, 1200),
    })
  }
  return map
}

// ========== 选项解析 ==========

const OPTION_MARK = /(^|[\u3000\s])([A-E])\s*[.．、]\s*/g

/** 解析一行中的 A–E 选项，返回 [{letter, text}]，可解析出多个 */
function splitOptionLine(line) {
  const text = line.replace(/\*\*/g, '').replace(/\u00a0/g, ' ')
  const marks = []
  OPTION_MARK.lastIndex = 0
  let m
  while ((m = OPTION_MARK.exec(text)) !== null) {
    marks.push({ letter: m[2], start: m.index + m[1].length, bodyStart: OPTION_MARK.lastIndex })
  }
  if (marks.length === 0) return []
  const out = []
  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i]
    const end = i + 1 < marks.length ? marks[i + 1].start : text.length
    out.push({ letter: mark.letter, text: text.slice(mark.bodyStart, end).trim() })
  }
  return out
}

/** 2025 的分数选项会出现 `A.` 单独一行、数值在后续行，因此只要求标记本身 */
function isOptionStart(line) {
  return /^(?:\*\*)?[A-E]\s*[.．、]/.test(line.trim())
}

/** 条件充分性判断全卷固定选项 */
const CSD_OPTIONS = [
  '条件（1）充分，但条件（2）不充分',
  '条件（2）充分，但条件（1）不充分',
  '条件（1）和（2）单独都不充分，但联合起来充分',
  '条件（1）充分，条件（2）也充分',
  '条件（1）和（2）单独都不充分，联合起来也不充分',
]

/** 判断题块里是否有多个答案（题号被 OCR 吞掉的题会并进上一块） */
function splitByAnswer(block) {
  const answerIndex = []
  block.lines.forEach((line, i) => {
    if (/答案[：:]|【答案/.test(line)) answerIndex.push(i)
  })
  if (answerIndex.length <= 1) return [block]
  const parts = []
  let start = 0
  for (let k = 0; k < answerIndex.length; k++) {
    let end = answerIndex[k] + 1
    // 紧随答案行的解析行属于本题
    while (end < block.lines.length && /^\s*(?:\*\*)?(?:解析|【解析)/.test(block.lines[end])) end++
    parts.push({ no: block.no + k, heading: block.heading, lines: block.lines.slice(start, end) })
    start = end
  }
  if (start < block.lines.length) parts[parts.length - 1].lines.push(...block.lines.slice(start))
  return parts
}

/** 答案 / 考点 / 解析行：既是选项区的结束信号，也是题干的截断点 */
function isMetaLine(line) {
  const t = line.trim()
  return /^(?:\*\*)?答案[：:]|^【答案|^(?:\*\*)?考点[：:]|^(?:\*\*)?考点\*\*|^(?:\*\*)?题型[：:]|^(?:\*\*)?解析[：:]|^(?:\*\*)?解析\*\*|^【解析|^-{3,}$/.test(t)
}

/** 从题目块里抽 A–E 选项（容忍选项跨行、同行多选项） */
function parseOptions(blockLines) {
  const start = blockLines.findIndex((l) => isOptionStart(l))
  if (start < 0) return { options: [], tail: blockLines, broken: false }
  const options = []
  let current = null
  // 2025 扫描卷把分数拆成多行（`A.` 独占一行），拼出来的选项语义失真，整题不可用
  let broken = false
  for (let i = start; i < blockLines.length; i++) {
    const line = blockLines[i]
    if (isMetaLine(line)) break
    if (isNoiseLine(line) && !current) continue
    if (/^(?:\*\*)?[A-E]\s*[.．、]\s*$/.test(line.trim())) broken = true
    const parts = splitOptionLine(line)
    if (parts.length > 0) {
      for (const part of parts) {
        if (current) options.push(current)
        current = { letter: part.letter, text: part.text }
      }
      continue
    }
    // 续行：拼到当前选项（公式断行、选项说明换行）
    if (current) current.text = `${current.text} ${line.trim()}`.trim()
  }
  if (current) options.push(current)

  const byLetter = new Map()
  for (const opt of options) {
    if (!byLetter.has(opt.letter)) byLetter.set(opt.letter, cleanInline(opt.text))
  }
  return {
    options: ['A', 'B', 'C', 'D', 'E'].map((letter) => byLetter.get(letter) || ''),
    tail: blockLines.slice(start),
    broken,
  }
}

// ========== 答案 / 解析 / 考点 ==========

function parseAnswer(blockText) {
  const patterns = [
    /\*\*答案[：:]\s*([A-E])/,
    /【答案[：:]\s*([A-E])】/,
    /【答案】\s*([A-E])/,
    /\*\*答案[：:]?\*\*\s*([A-E])/,
  ]
  for (const re of patterns) {
    const m = blockText.match(re)
    if (m) return m[1]
  }
  return ''
}

function parseAnswerAlt(blockText) {
  // 存疑题：`⚠️ 存疑（本集 D，考研信息网 E）`
  const m = blockText.match(/存疑[（(][^）)]*?([A-E])[）)]/)
  return m ? m[1] : ''
}

function isDisputed(blockText) {
  return /⚠️|存疑|分歧/.test(blockText)
}

function parseExplanation(blockText) {
  const m = blockText.match(/\*\*解析[：:]\*\*\s*([\s\S]*)$/)
  if (m) return cleanInline(m[1]).slice(0, 1500)
  const m2 = blockText.match(/\*\*解析\*\*[：:]\s*([\s\S]*)$/)
  return m2 ? cleanInline(m2[1]).slice(0, 1500) : ''
}

const KNOWLEDGE_RE = /(?:\*\*考点[：:]\*\*|\*\*考点\*\*[：:]|\*\*题型[：:]\*\*|考点[：:])\s*([^\n*]+)/

function parseKnowledge(blockText, heading) {
  const m = blockText.match(KNOWLEDGE_RE)
  if (m) return cleanInline(m[1]).slice(0, 60)
  const bracket = (heading || '').match(/[（(]([^）)]{2,20})[）)]\s*$/)
  return bracket ? bracket[1].trim() : ''
}

// ========== 题型 / 分类 ==========

function mathTopic(knowledge, stem) {
  const text = knowledge ? knowledge : stem
  if (/概率|古典概型|独立事件/.test(text)) return '概率'
  if (/排列|组合|隔板|定序|分组|选取/.test(text)) return '排列组合'
  if (/几何|三角形|圆|菱形|正方形|面积|体积|立体|坐标|直线|抛物线|解析/.test(text)) return '几何'
  if (/数列|等差|等比/.test(text)) return '数列'
  if (/行程|工程|浓度|利润|价格|成本|比|比例|百分|容斥|集合|年龄|分配|应用/.test(text)) return '应用题'
  if (/方程|不等式|函数|最值|绝对值|整式|分式|根式/.test(text)) return '代数'
  return '算术'
}

function logicTopic(knowledge, stem) {
  const text = knowledge || stem
  if (/削弱|加强|支持|质疑|假设|解释|评价|论证/.test(text)) return '论证评价'
  if (/假言|逆否|三段论|直言|模态|选言|联言|充分|必要|形式/.test(text)) return '形式逻辑'
  if (/分析推理|排序|分组|匹配|对应|安排|名额|真假|列表|归谬/.test(text)) return '分析推理'
  return '综合推理'
}

/** 抽取「N-M 题基于以下题干」这类题组条件，供组内所有小题共用 */
function collectGroupContexts(lines) {
  const groups = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/(\d{1,2})\s*[-~～至]\s*(\d{1,2})\s*题基于以下题干/)
    if (!m) continue
    const from = Number(m[1])
    const to = Number(m[2])
    const inline = lines[i].replace(/^.*?题基于以下题干[：:]*\*{0,2}\s*/, '').trim()
    const body = inline ? [inline] : []
    for (let j = i + 1; j < lines.length; j++) {
      if (matchQuestionNo(lines[j])) break
      if (/^#{2,4}\s/.test(lines[j].trim())) break
      body.push(lines[j])
    }
    const text = cleanInline(body.join(' '))
    if (text) groups.push({ from, to, text })
  }
  return groups
}

function hasFigure(stem) {
  return /如图|图\s*\d|下图|图示|方阵图|示意图/.test(stem)
}

// ========== 主解析 ==========

function parseYear(year, review) {
  const file = path.join(SOURCE_DIR, `${year}-管综真题.md`)
  if (!fs.existsSync(file)) throw new Error(`缺少真题文件：${file}`)
  const raw = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  const sections = splitSections(raw)
  const allLines = sections.all

  const out = []

  const jobs = [
    { subject: 'math', lines: dropExplanationBlock(sections.math), range: MATH_RANGE },
    { subject: 'logic', lines: dropExplanationBlock(sections.logic), range: LOGIC_RANGE },
  ]

  // 2025 文末集中解析
  const explanationFrom = allLines.findIndex((l) => /^###\s*数学逐题解析/.test(l.trim()))
  const logicExplanationFrom = allLines.findIndex((l) => /^###\s*逻辑逐题解析/.test(l.trim()))
  const mathNotes = explanationFrom >= 0
    ? parseExplanationSection(allLines.slice(explanationFrom), MATH_RANGE[0], MATH_RANGE[1])
    : new Map()
  const logicNotes = logicExplanationFrom >= 0
    ? parseExplanationSection(allLines.slice(logicExplanationFrom), LOGIC_RANGE[0], LOGIC_RANGE[1])
    : new Map()

  for (const job of jobs) {
    const [from, to] = job.range
    const rawBlocks = []
    let current = null
    for (const line of job.lines) {
      const hit = matchQuestionNo(line)
      // 题号允许跳号（OCR 会吞掉 41、50 这类题号），只要求单调递增
      if (hit && hit.no >= from && hit.no <= to && (!current || hit.no > current.no)) {
        if (current) rawBlocks.push(current)
        current = {
          no: hit.no,
          heading: hit.heading,
          lines: hit.heading ? [] : [line.replace(/^.*?[.．、]\s*/, '')],
        }
        continue
      }
      if (current) current.lines.push(line)
    }
    if (current) rawBlocks.push(current)

    const blocks = rawBlocks.flatMap((block) => splitByAnswer(block))
    if (blocks.length !== to - from + 1) {
      review.push(`${year},${job.subject},题块数,期望 ${to - from + 1} 实际 ${blocks.length}`)
    }

    const groups = job.subject === 'logic' ? collectGroupContexts(job.lines) : []
    let prevLogicStem = ''

    for (const block of blocks) {
      const blockText = block.lines.join('\n')
      const isCsd = job.subject === 'math' && block.no >= 16

      let options
      let stemLines
      let broken = false
      if (isCsd) {
        // 条件充分性判断：全卷选项固定，题干内含（1）（2）两个条件
        options = [...CSD_OPTIONS]
        const cutIdx = block.lines.findIndex((l) => isMetaLine(l))
        stemLines = (cutIdx >= 0 ? block.lines.slice(0, cutIdx) : block.lines)
          .filter((l) => !isNoiseLine(l))
          .filter((l) => !/^[A-E]\s*[.．、]?\s*条件（[12]）/.test(l.trim()))
          .filter((l) => !/^-?\s*（[A-E]）条件/.test(l.trim()))
          .filter((l) => !/^(?:二、)?条件充分性判断/.test(l.trim()))
          .filter((l) => !/^解题说明/.test(l.trim()))
          .filter((l) => !/^本大题要求判断/.test(l.trim()))
          .filter((l) => !/^通用选项说明/.test(l.trim()))
          .filter((l) => !/^A\s+条件（1）充分/.test(l.trim()))
      } else {
        const parsed = parseOptions(block.lines)
        options = parsed.options
        broken = parsed.broken
        const cut = block.lines.length - parsed.tail.length
        stemLines = block.lines.slice(0, cut > 0 ? cut : 0).filter((l) => !isNoiseLine(l))
      }

      let stem = cleanInline(stemLines.join(' '))
      stem = stem.replace(/^#{2,4}\s*\d*\s*[.．、]?\s*/, '').replace(/^\*\s*/, '').replace(/^题目[：:]\s*/, '')
      // 2022 的 `#### N. 标题（考点）` 行会把标题混进题干，去掉首行的标题括注
      if (block.heading) {
        stem = stem.replace(/^[^。？?]{0,30}?[（(][^）)]{2,20}[）)]\s*/, (match) =>
          match.includes('题') || match.includes('如图') ? match : '',
        )
      }

      // 分析推理组题：小题只有问句，必须把共用题干拼回去才能作答
      if (job.subject === 'logic') {
        const group = groups.find((g) => block.no >= g.from && block.no <= g.to)
        if (group) {
          stem = `${group.text} ${stem}`
        } else if (stem.length < 40 && /共用题干/.test(prevLogicStem)) {
          stem = `${prevLogicStem.replace(/^.*?共用题干[）)]?[：:]\s*/, '')} ${stem}`
        }
      }

      const notes = job.subject === 'math' ? mathNotes : logicNotes
      const note = notes.get(block.no)
      const answer = parseAnswer(blockText) || note?.answer || ''
      const explanation = parseExplanation(blockText) || note?.explanation || ''
      const knowledge = parseKnowledge(blockText, block.heading)

      if (!stem) review.push(`${year},${job.subject},${block.no},空题干`)
      if (options.filter(Boolean).length !== 5) {
        review.push(`${year},${job.subject},${block.no},选项 ${options.filter(Boolean).length}/5`)
      }
      if (!answer) review.push(`${year},${job.subject},${block.no},缺答案`)
      if (!explanation) review.push(`${year},${job.subject},${block.no},缺解析`)
      if (broken) review.push(`${year},${job.subject},${block.no},公式断行已剔除`)

      out.push({
        key: `${year}-${String(block.no).padStart(2, '0')}`,
        subject: job.subject,
        year,
        qno: block.no,
        qtype: isCsd ? 'csd' : job.subject === 'math' ? 'ps' : 'logic',
        topic: job.subject === 'math' ? mathTopic(knowledge, stem) : logicTopic(knowledge, stem),
        stem,
        options,
        answer,
        answerAlt: parseAnswerAlt(blockText),
        disputed: isDisputed(blockText),
        explanation,
        knowledge,
        hasFigure: hasFigure(stem),
        broken,
        sourceRef: `${year}-管综真题.md#${block.no}`,
      })
      if (job.subject === 'logic' && stem.length >= 40) prevLogicStem = stem
    }
  }

  return out
}

function main() {
  const review = []
  const questions = []
  for (const year of YEARS) questions.push(...parseYear(year, review))

  const usable = questions
    .filter((q) => q.stem && q.answer && q.options.filter(Boolean).length === 5 && !q.broken)
    .map(({ broken, ...rest }) => rest)
  const bySubject = { math: 0, logic: 0 }
  for (const q of usable) bySubject[q.subject]++

  const bank = {
    version: 1,
    builtAt: new Date().toISOString(),
    paper: '199',
    dataset: {
      name: '199 管理类综合能力真题 2021–2025',
      sourceDir: SOURCE_DIR,
      questionCount: usable.length,
    },
    questions: usable,
  }

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true })
  fs.mkdirSync(path.dirname(REVIEW_CSV), { recursive: true })
  fs.writeFileSync(REVIEW_CSV, ['year,subject,question,issue,detail', ...review].join('\n') + '\n', 'utf8')

  console.log(`可用题目：${usable.length} 题（数学 ${bySubject.math} / 逻辑 ${bySubject.logic}），丢弃 ${questions.length - usable.length} 题`)
  console.log(`复核清单：${REVIEW_CSV}（${review.length} 条）`)
  if (!CHECK_ONLY) {
    fs.writeFileSync(OUT_JSON, JSON.stringify(bank), 'utf8')
    console.log(`已写入：${OUT_JSON}`)
  }
}

main()
