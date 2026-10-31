#!/usr/bin/env node
/**
 * 构建英语二阅读 Part A 题库（一次性作者工具）。
 *
 * 数据源：
 *   - reading-source/pdf-text/{year}-英语二-试题.txt（layout 模式抽取，含段落缩进）
 *   - {READING_SOURCE_DIR}/{year}-考研英语二真题.md（答案/解析/考点/定位/干扰项）
 *   - {READING_SOURCE_DIR}/README.md（阅读 Part A 答案速查表）
 *
 * 产物：
 *   - src/assets/exam-reading/reading-bank.json
 *   - reading-source/draft.json（便于检查）
 *   - reading-source/review.csv（需人工复核的条目）
 *
 * 用法：
 *   node scripts/build-reading-bank.mjs [--source <dir>] [--check-only]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DEFAULT_SOURCE =
  process.env.READING_SOURCE_DIR || '/Users/cgy/data/work-buddy/考研英语二真题'

const args = process.argv.slice(2)
const sourceArgIndex = args.indexOf('--source')
const SOURCE_DIR = sourceArgIndex >= 0 ? args[sourceArgIndex + 1] : DEFAULT_SOURCE
const CHECK_ONLY = args.includes('--check-only')
const PDF_TEXT_DIR = path.join(ROOT, 'reading-source', 'pdf-text')
const OUT_JSON = path.join(ROOT, 'src', 'assets', 'exam-reading', 'reading-bank.json')
const DRAFT_JSON = path.join(ROOT, 'reading-source', 'draft.json')
const REVIEW_CSV = path.join(ROOT, 'reading-source', 'review.csv')

const YEARS = [2022, 2023, 2024, 2025, 2026]
const EXPECTED_RANGE = { 1: [21, 25], 2: [26, 30], 3: [31, 35], 4: [36, 40] }

// ========== 词典（用于修复 PDF 的词内空格） ==========
const DICT = new Set()
try {
  for (const line of fs.readFileSync('/usr/share/dict/words', 'utf8').split('\n')) {
    const word = line.trim().toLowerCase()
    if (word) DICT.add(word)
  }
} catch {
  // macOS 以外的环境没有系统词典时，退化为只做保守规则
}
const PROPER_NOUNS = new Set([
  'coyle', 'cambridge', 'brookings', 'brunnquell', 'stanton', 'brandywine',
  'chelsea', 'yosemite', 'sequoia', 'walmart', 'copilot', 'microsoft',
])

/**
 * 2025 试卷 PDF 的 Text 1 末段、Text 2 第 4-6 段缺失。
 * 依据：解析集 Q25 引文；解析集「资料来源」第 13 条（奇速英语 NHS 全文）。
 * 这两处属于源 PDF 缺页，不是 OCR 噪声，必须补齐否则 Q25/Q28-Q30 无法作答。
 */
const PASSAGE_SUPPLEMENTS = {
  '2025-t1': [
    'However, many customers are frustrated because they feel they are being asked for too high of a tip, too often. And, as our research emphasizes, tipping now seems to be more coercive, less generous and often completely dissociated from service quality.',
  ],
  '2025-t2': [
    'Yet despite two decades of strategies and a number of major health reforms, we have failed to make meaningful progress on any of these aims. That is why the Reform think tank is launching a new programme of work entitled "Reimagining health", supported by ten former health ministers. Together, we are calling for a much more open and honest conversation about the future of health in the UK, and an "urgent rethink" of the hospital-centric model we retain.',
    'This must begin with the question of how we maximise the health of the nation, rather than "fix" the NHS. It is estimated, for example, that healthcare accounts for only about 20% of health outcomes. Much more important are the places we live, work and socialise — yet there is no clear cross-government strategy for improving these social determinants of health. Worse, when policies like the national obesity strategy are scrapped, taxpayers are left with the hefty price tag of treating the illnesses, like diabetes, that result.',
    'Reform wants to ask how power and resources should be distributed in our health system. What health functions should remain at the centre, and what should be given to local leaders, often responsible for services that create health, and with a much better understanding of the needs of their populations?',
  ],
}

/** 2025 Text 4 的试卷 PDF 第 1-2 段整段重复，按 1-based 下标丢弃第 3、4 段 */
const DROP_PARAGRAPHS = {
  '2025-t4': [3, 4],
}

// ========== 文本清洗 ==========

const PUNCT_ONLY = /^[^\p{L}\p{N}]+$/u
const WORD_TOKEN = /^[A-Za-z][A-Za-z'’.-]*$/

function isWord(token) {
  const clean = token.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '').toLowerCase()
  if (!clean) return false
  return DICT.has(clean) || PROPER_NOUNS.has(clean)
}

/** 修复 PDF 中随机插入的词内空格，例如 "Coyl e" / "gr owth" / "Accor ding" */
function repairWordSpacing(text) {
  if (!DICT.size) return text
  const tokens = text.split(/\s+/).filter(Boolean)
  const out = []
  let i = 0
  while (i < tokens.length) {
    let joined = false
    for (let n = 4; n >= 2; n--) {
      if (i + n > tokens.length) continue
      const parts = tokens.slice(i, i + n)
      if (!parts.every((p) => WORD_TOKEN.test(p))) continue
      const candidate = parts.join('')
      const lower = candidate.toLowerCase()
      const known = DICT.has(lower) || PROPER_NOUNS.has(lower)
      if (!known) continue
      const anyUnknown = parts.some((p) => !isWord(p))
      const singleLetterTail =
        n === 2 && /^[A-Za-z]$/.test(parts[1]) && /^[A-Za-z]{2,}$/.test(parts[0])
      if (anyUnknown || singleLetterTail) {
        out.push(candidate)
        i += n
        joined = true
        break
      }
    }
    if (!joined) {
      out.push(tokens[i])
      i++
    }
  }
  return out.join(' ')
}

/** 标点、大小写与括号间距 */
function fixPunctuation(text) {
  let s = text
  s = s.replace(/\s+([,.;:!?])/g, '$1')
  s = s.replace(/([,;:])(?=[A-Za-z])/g, '$1 ')
  s = s.replace(/\.(?=[A-Za-z])/g, '. ')
  s = s.replace(/([.!?])\s*([a-z])/g, (_m, p, c) => `${p} ${c.toUpperCase()}`)
  s = s.replace(/([a-z])([A-Z][a-z])/g, (m, a, b) => {
    const lower = `${a}${b}`.toLowerCase()
    if (['ipad', 'ipads', 'iphone', 'iphones', 'ipod', 'ipods', 'mcdonald', 'youtube', 'linkedin'].includes(lower)) return m
    return `${a} ${b}`
  })
  s = s.replace(/([a-z])\(/g, '$1 (')
  s = s.replace(/\)([A-Za-z])/g, ') $1')
  s = s.replace(/\s+/g, ' ').trim()
  return s
}

/** 已知 OCR/排版问题的定点修正（按年份 +篇目作用域） */
const CORRECTIONS = {
  common: [
    ['day13.000', 'day 13,000'],
    ['Larry Browns', "Larry Brown's"],
    ['US.egg', 'US egg'],
    ['Paragragh', 'Paragraph'],
    ['Brungvell', 'Brunnquell'],
    ['markets prospects', 'market prospects'],
    ['super markets', 'supermarkets'],
    ['quickly says', 'quickly, says'],
    ['minimal,if any,improvement', 'minimal, if any, improvement'],
    ['U. S.', 'U.S.'],
    ['Ona recent', 'On a recent'],
    ['asa replacement', 'as a replacement'],
    ['playa role', 'play a role'],
    ['playa bigger', 'play a bigger'],
    ['Sclentists', 'Scientists'],
    ['leda study', 'led a study'],
    ['isfacing', 'is facing'],
    ['Whether itis', 'Whether it is'],
    ['cases, itis', 'cases, it is'],
    ['anda number', 'and a number'],
    ['anda certain', 'and a certain'],
    ['asa child', 'as a child'],
    ['asa small', 'as a small'],
    ['anyway-aren’t', 'anyway — aren’t'],
    ['shortcut-and', 'shortcut—and'],
    ['stops -or', 'stops — or'],
    ['stop - driving', 'stop — driving'],
    ['stops - driving', 'stops — driving'],
    ['co -authors', 'co-authors'],
    ['there searchers', 'researchers'],
    ['lives Think', 'lives. Think'],
    ['frustrate by', 'frustrated by'],
    ['percent-and', 'percent—and'],
    ['going -or', 'going — or'],
    ['alertsystems -and', 'alert systems — and'],
    ['U.S. Customers', 'U.S. customers'],
    ['i Pads', 'iPads'],
    ['fora tip', 'for a tip'],
    ['in the Paragraph ', 'in Paragraph '],
    ['the doubts to over', 'the doubts over'],
  ],
  2022: [
    [
      'agriculture-special house gases',
      'agriculture—a practice that can reduce greenhouse gases',
    ],
    ['The birds waste then fertilizes', "The birds' waste then fertilizes"],
  ],
  2023: [
    ['lake grass', 'fake grass'],
    ['ac courage', 'encourage'],
    ['bee na', 'been a'],
    ['environ ment', 'environment'],
    ['cir cles', 'circles'],
    ['be nefits', 'benefits'],
    ['prot ect', 'protect'],
    ['alte rnative', 'alternative'],
    ['environmen t', 'environment'],
    ['contin uously', 'continuously'],
  ],
  2024: [
    ['economi st', 'economist'],
    ['Cambri dge', 'Cambridge'],
    ['Univers ity', 'University'],
    ['Coyl e', 'Coyle'],
    ['argue s', 'argues'],
    ['gr owth', 'growth'],
    ['Paragra ph', 'Paragraph'],
    ['Accor ding', 'According'],
    ['underc ut', 'undercut'],
    ['require s', 'requires'],
    ['digita l', 'digital'],
    ['worker s', 'workers'],
    ['ge ogra phical', 'geographical'],
    ['sugge sts', 'suggests'],
    ['strangl ehold', 'stranglehold'],
    ['technologi es', 'technologies'],
    ['capabiliti es', 'capabilities'],
    ['commerciali zation', 'commercialization'],
    ['sustainsble', 'sustainable'],
  ],
  2025: [
    ['when oud how', 'when and how'],
    ['new kind of services', 'new kinds of services'],
    ['U. S.', 'U.S.'],
    ['asa ', 'as a '],
    ['asa hub', 'as a hub'],
    ['playa ', 'play a '],
    ['firsttwo', 'first two'],
    ['isaimed', 'is aimed'],
    ['then health system', 'the health system'],
    ['tipamounts', 'tip amounts'],
    ['tip flation', 'tipflation'],
    ['tipflation-the', 'tipflation—the'],
    ['default options-often', 'default options—often'],
    ['can not', 'cannot'],
    ["hospital's", 'hospitals'],
    ['itis', 'it is'],
    ['squeezed out investment', 'squeezing our investment'],
    ['Nearly 75 years on; with', 'Nearly 75 years on, with'],
    ['workforce-which', 'workforce—which'],
    ['point-will', 'point—will'],
  ],
  2026: [
    ['in P6 show', 'in Paragraph 6 show'],
    ['Para.3&4', 'Paragraphs 3 and 4'],
    ['Para. 5', 'Paragraph 5'],
  ],
}

function applyCorrections(text, year, textNo) {
  let s = text
  for (const [find, replace] of CORRECTIONS.common) s = s.split(find).join(replace)
  for (const [find, replace] of CORRECTIONS[year] || []) s = s.split(find).join(replace)
  if (year === 2025 && textNo === 1) {
    s = s.replace(/well above 70%/g, 'well above 20%')
    s = s.replace(
      /benefits some of these workers, such as cooks and dishwashers/g,
      'benefits some of these workers, such as waiters, but not others, such as cooks and dishwashers',
    )
  }
  return s
}

function cleanProse(text, year, textNo) {
  let s = text
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
  // 2025 扫描卷把句号/分号识别成了斜杠；该年正文没有 and/or 之类的用法
  if (year === 2025) s = s.replace(/\s*\/\s*/g, '. ')
  s = repairWordSpacing(s)
  s = fixPunctuation(s)
  s = applyCorrections(s, year, textNo)
  s = s.replace(/\s+([,.;:!?])/g, '$1').replace(/\s+/g, ' ').trim()
  return s
}

// ========== PDF 解析 ==========

function stripPageArtifacts(lines) {
  return lines
    .map((entry) => {
      const text = entry.text.replace(/\u00a0/g, ' ').replace(/\s+$/, '')
      return { ...entry, text }
    })
    .filter(({ text }) => {
      const t = text.trim()
      if (!t) return false
      if (/^=== PAGE \d+ ===$/.test(t)) return false
      if (/^\d{1,2}$/.test(t)) return false
      if (/^-\s*\d+\s*-$/.test(t)) return false
      if (/第\s*\d+\s*页/.test(t)) return false
      if (/年全国硕士研究生招生考试/.test(t)) return false
      if (/^TB店铺/.test(t)) return false
      if (/^Part\s*[AB]$/i.test(t)) return false
      if (/^Section\s*(I{1,2}|Ⅱ|Ⅲ)/i.test(t)) return false
      if (/^Directions\s*:/i.test(t)) return false
      if (/^Read\s+the\s+following/i.test(t)) return false
      if (/^choosing\s+A/i.test(t)) return false
      if (/^C\s+or\s+D/i.test(t)) return false
      if (/^SHEET/i.test(t)) return false
      if (/^each\s+text/i.test(t)) return false
      return true
    })
}

function parsePdfYear(year) {
  const file = path.join(PDF_TEXT_DIR, `${year}-英语二-试题.txt`)
  if (!fs.existsSync(file)) throw new Error(`缺少 PDF 文本：${file}`)
  const raw = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')

  const lines = []
  let page = 1
  for (const text of raw.split('\n')) {
    const marker = text.match(/^=== PAGE (\d+) ===$/)
    if (marker) {
      page = Number(marker[1])
      continue
    }
    lines.push({ text, page })
  }

  // 定位第一处 Section II / Part A（跳过 2024 后半部分的解析）
  let start = lines.findIndex((l) => /Section\s*(II|Ⅱ)/i.test(l.text))
  if (start < 0) start = lines.findIndex((l) => /^\s*Part\s*A\s*$/i.test(l.text))
  if (start < 0) throw new Error(`${year}: 未找到 Reading Part A`)
  const partA = lines.findIndex(
    (l, i) => i > start && /^\s*Part\s*A\s*$/i.test(l.text),
  )
  const sectionStart = partA >= 0 ? partA : start
  let end = lines.findIndex(
    (l, i) =>
      i > sectionStart &&
      (/^\s*Part\s*B\s*$/i.test(l.text) || /Section\s*(III|Ⅲ)/i.test(l.text)),
  )
  if (end < 0) end = lines.length

  const section = stripPageArtifacts(lines.slice(sectionStart, end))
  const textHeadings = section
    .map((l, i) => ({ ...l, i, match: l.text.match(/^\s*Text\s*([1-4])\s*$/i) }))
    .filter((l) => l.match)

  if (textHeadings.length < 4) {
    throw new Error(`${year}: 只找到 ${textHeadings.length} 个 Text 标题`)
  }

  const passages = []
  for (let t = 0; t < 4; t++) {
    const heading = textHeadings[t]
    const next = t + 1 < textHeadings.length ? textHeadings[t + 1].i : section.length
    const block = section.slice(heading.i + 1, next)
    const [from, to] = EXPECTED_RANGE[t + 1]
    const firstQuestion = block.findIndex((l) =>
      new RegExp(
        `^\\s*(${from}|${from + 1}|${from + 2}|${from + 3}|${from + 4})[.、]?\\s*\\S`,
      ).test(l.text),
    )
    if (firstQuestion < 0) {
      passages.push({ textNo: t + 1, paragraphs: [], questions: [], needsReview: true })
      continue
    }

    const passageLines = block.slice(0, firstQuestion)
    const questionLines = block.slice(firstQuestion)

    // 段落合并：layout 模式下新段落有 4+ 空格缩进
    const paragraphs = []
    let current = ''
    let firstPage = null
    let lastPage = null
    for (const line of passageLines) {
      const rawText = line.text.replace(/\s+$/, '')
      if (!rawText.trim()) continue
      const indent = rawText.match(/^\s*/)[0].length
      if (firstPage === null) firstPage = line.page
      lastPage = line.page
      if (indent >= 4 && current) {
        paragraphs.push(current)
        current = rawText.trim()
      } else {
        current = current ? `${current} ${rawText.trim()}` : rawText.trim()
      }
    }
    if (current) paragraphs.push(current)

    const key = `${year}-t${t + 1}`
    const drop = new Set(DROP_PARAGRAPHS[key] || [])
    let cleanedParagraphs = paragraphs
      .map((p, index) => ({ text: cleanProse(p, year, t + 1), index: index + 1 }))
      .filter((p) => p.text.length > 20 && !drop.has(p.index))
      .map((p) => p.text)

    // 源 PDF 缺段补齐（2025 Text 1 末段 / Text 2 第 4-6 段）
    cleanedParagraphs = cleanedParagraphs.concat(
      (PASSAGE_SUPPLEMENTS[key] || []).map((p) => cleanProse(p, year, t + 1)),
    )

    // 去重：2025 Text 4 等扫描卷可能整段重复
    const seenParagraphs = new Set()
    cleanedParagraphs = cleanedParagraphs.filter((p) => {
      const sig = p.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 100)
      if (!sig || seenParagraphs.has(sig)) return false
      seenParagraphs.add(sig)
      return true
    })

    const questions = parseQuestionBlocks(questionLines, year, t + 1, from, to)
    passages.push({
      textNo: t + 1,
      paragraphs: cleanedParagraphs,
      questions,
      firstPage,
      lastPage,
      needsReview: questions.length !== 5 || cleanedParagraphs.length === 0,
    })
  }

  return passages
}

function parseQuestionBlocks(lines, year, textNo, from, to) {
  const blocks = []
  let current = null
  for (const line of lines) {
    const m = line.text.match(/^\s*(\d{2})[.、]?\s*(\S.*)$/)
    if (m) {
      const num = Number(m[1])
      if (num >= from && num <= to) {
        if (current) blocks.push(current)
        current = { num, lines: [{ text: m[2], page: line.page }] }
        continue
      }
    }
    if (current) current.lines.push(line)
  }
  if (current) blocks.push(current)

  return blocks.map((block) => {
    const optionStart = findOptionStart(block.lines)
    if (optionStart < 0) {
      return {
        num: block.num,
        stem: cleanProse(block.lines.map((l) => l.text).join(' '), year, textNo),
        options: [],
        page: block.lines[0]?.page ?? 0,
        needsReview: true,
      }
    }
    const rawStem = cleanProse(
      block.lines.slice(0, optionStart).map((l) => l.text).join(' '),
      year,
      textNo,
    )
    const stem = rawStem ? rawStem.charAt(0).toUpperCase() + rawStem.slice(1) : rawStem
    const options = []
    let currentLetter = null
    let bucket = []
    for (let i = optionStart; i < block.lines.length; i++) {
      const text = block.lines[i].text.trim()
      if (!text) continue
      const m = matchOptionLine(text)
      if (m) {
        if (currentLetter) options.push({ letter: currentLetter, text: bucket.join(' ') })
        currentLetter = m.letter
        bucket = [m.rest]
      } else if (currentLetter) {
        bucket.push(text)
      }
    }
    if (currentLetter) options.push({ letter: currentLetter, text: bucket.join(' ') })

    return {
      num: block.num,
      stem,
      options: options
        .filter((o) => o.text.trim())
        .map((o) => ({ letter: o.letter, text: cleanProse(o.text, year, textNo) })),
      page: block.lines[0]?.page ?? 0,
      needsReview: options.length !== 4,
    }
  })
}

/** 兼容四种选项排版：`A. text` / `A text` / `A.text` / `[A] text` */
function matchOptionLine(text) {
  let m = text.match(/^\s*\[([A-D])\]\s*(.*)$/)
  if (m) return { letter: m[1], rest: m[2] }
  m = text.match(/^\s*([A-D])(?:[.、]|\s)\s*(.*)$/)
  if (m) return { letter: m[1], rest: m[2] }
  return null
}

/** 找到 A/B/C/D 四个选项的起始行（避免把题干里以 A 开头的行误判） */
function findOptionStart(lines) {
  for (let i = 0; i < lines.length; i++) {
    const first = matchOptionLine(lines[i].text)
    if (!first || first.letter !== 'A') continue
    let seen = 0
    for (let j = i; j < Math.min(lines.length, i + 16); j++) {
      const m = matchOptionLine(lines[j].text)
      if (!m) continue
      if (m.letter === 'ABCD'[seen]) seen++
      if (seen === 4) return i
    }
  }
  return -1
}

// ========== Markdown 解析集 ==========

const QTYPE_MAP = [
  ['细节', 'detail'],
  ['推理', 'infer'],
  ['推断', 'infer'],
  ['主旨', 'main'],
  ['大意', 'main'],
  ['词义', 'vocab'],
  ['句意', 'vocab'],
  ['态度', 'attitude'],
  ['例证', 'example'],
]

function noteQtype(raw) {
  for (const [key, value] of QTYPE_MAP) {
    if (raw.includes(key)) return value
  }
  return 'other'
}

function parseNotes(year) {
  const file = path.join(SOURCE_DIR, `${year}-考研英语二真题.md`)
  if (!fs.existsSync(file)) throw new Error(`缺少解析集：${file}`)
  const raw = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  const start = raw.indexOf('## Section II 阅读理解 Part A')
  const end = raw.indexOf('## Part B', start)
  const section = raw.slice(start, end > start ? end : raw.length)

  const textParts = section.split(/^### Text\s*([1-4])（\d+-\d+）— 主题：(.+)$/m)
  const byText = new Map()
  for (let i = 1; i < textParts.length; i += 3) {
    const textNo = Number(textParts[i])
    const title = textParts[i + 1].trim()
    const body = textParts[i + 2] || ''
    const qParts = body.split(/^\*\*(\d{2})\.\s*(.*?)\*\*\s*—\s*考点：(.+)$/m)
    const questions = new Map()
    for (let j = 1; j < qParts.length; j += 4) {
      const num = Number(qParts[j])
      const heading = qParts[j + 1]
      const qtypeRaw = qParts[j + 2]
      const block = qParts[j + 3] || ''
      const answerMatch = heading.match(/\[([A-D])\]/)
      const answer = answerMatch ? answerMatch[1] : ''
      const answerText = answerMatch
        ? heading.slice(answerMatch.index + answerMatch[0].length).trim()
        : ''
      const normalized = block
        .replace(/；解析：/g, '\n解析：')
        .replace(/；干扰项：/g, '\n干扰项：')
        .replace(/；定位：/g, '\n定位：')
      const locateMatch = normalized.match(/定位：([\s\S]*?)(?=\n解析：|\n干扰项：|\n>|$)/)
      const explainMatch = normalized.match(/解析：([\s\S]*?)(?=\n干扰项：|\n>|$)/)
      const distractorMatch = normalized.match(/干扰项：([\s\S]*?)(?=\n>|$)/)
      const noteLines = block
        .split('\n')
        .filter((l) => /^\s*>/.test(l))
        .map((l) => l.replace(/^\s*>\s?/, '').replace(/\*\*/g, '').trim())
        .filter(Boolean)
      questions.set(num, {
        answer,
        answerText,
        qtype: noteQtype(qtypeRaw),
        locate: locateMatch ? locateMatch[1].replace(/\*\*/g, '').trim() : '',
        explanation: explainMatch ? explainMatch[1].replace(/\*\*/g, '').trim() : '',
        distractors: distractorMatch ? distractorMatch[1].replace(/\*\*/g, '').trim() : '',
        notes: noteLines.join(' '),
      })
    }
    byText.set(textNo, { title, questions })
  }
  return byText
}

function parseReadmeAnswers() {
  const file = path.join(SOURCE_DIR, 'README.md')
  const result = new Map()
  if (!fs.existsSync(file)) return result
  const raw = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  const start = raw.indexOf('### 阅读理解 Part A')
  if (start < 0) return result
  const section = raw.slice(start, raw.indexOf('###', start + 10))
  for (const line of section.split('\n')) {
    const m = line.match(/^\|\s*(\d{4})\s*\|(.+)\|$/)
    if (!m) continue
    const year = Number(m[1])
    const cells = m[2].split('|').map((c) => c.trim())
    const letters = []
    for (const cell of cells) {
      for (const token of cell.split(/\s+/)) {
        if (/^[A-D]$/.test(token)) letters.push(token)
      }
    }
    if (letters.length >= 20) result.set(year, letters.slice(0, 20))
  }
  return result
}

// ========== 组装 ==========

function parseLocatePara(hint, paragraphCount) {
  if (!hint) return 0
  const last = hint.match(/末段|最后一段/)
  if (last) return paragraphCount
  const reverse = hint.match(/倒数第\s*(\d+)\s*段/)
  if (reverse) return Math.max(1, paragraphCount - Number(reverse[1]) + 1)
  const first = hint.match(/第\s*(\d+)\s*段/)
  if (first) return Math.min(paragraphCount, Number(first[1]))
  return 0
}

function classifyTopic(title) {
  const t = title || ''
  if (/AI|人工智能|数字|互联网|技术|图书馆|隐私|App|算法|高铁|铁路/.test(t)) return '科技'
  if (/气候|环境|农业|木材|森林|能源|高温|碳排放|净零|鸡蛋/.test(t)) return '环境'
  if (/退休|青少年|人口|社会|健康|NHS|小费|员工|职场|社区/.test(t)) return '社会'
  if (/公园|政府|公共|大学|教育|图书馆/.test(t)) return '公共机构'
  if (/商业|企业|市场|经济|就业|司机|消费/.test(t)) return '商业'
  return '其他'
}

function main() {
  const readmeAnswers = parseReadmeAnswers()
  const review = []
  const passages = []

  for (const year of YEARS) {
    const pdfPassages = parsePdfYear(year)
    const notes = parseNotes(year)
    const answers = readmeAnswers.get(year) || []

    for (const p of pdfPassages) {
      const noteText = notes.get(p.textNo)
      const title = noteText?.title || ''
      const cleanedParagraphs = p.paragraphs
      const questions = []
      for (const q of p.questions) {
        const note = noteText?.questions.get(q.num)
        const readmeAnswer = answers[q.num - 21] || ''
        let answer = note?.answer || readmeAnswer
        let answerAlt = ''
        let disputed = false
        let answerNote = note?.notes || ''

        if (year === 2025 && q.num === 30) {
          answer = 'C'
          answerAlt = 'D'
          disputed = true
          answerNote = [
            '本题存在 C/D 分歧：整理者倾向 C（职能与资源应下放给地方领导人，推断其应发挥更大作用），官方试题卷参考答案等来源作 D（地方领导人更了解民众需求）。应用内 C/D 均判对，请以你的辅导书口径为准。',
          ].join(' ')
        }

        if (note?.answer && readmeAnswer && note.answer !== readmeAnswer && !disputed) {
          review.push(
            `${year},Text${p.textNo},Q${q.num},答案冲突,notes=${note.answer}/readme=${readmeAnswer}`,
          )
        }
        if (!answer) {
          review.push(`${year},Text${p.textNo},Q${q.num},缺答案,`)
          answer = 'A'
        }
        if (q.needsReview) review.push(`${year},Text${p.textNo},Q${q.num},题干/选项需复核,`)
        if (!note) review.push(`${year},Text${p.textNo},Q${q.num},解析集缺题目,`)
        if (!q.stem) review.push(`${year},Text${p.textNo},Q${q.num},空题干,`)
        if (q.options.length !== 4) {
          review.push(
            `${year},Text${p.textNo},Q${q.num},选项${q.options.length}个,`,
          )
        }

        const optionMap = new Map(q.options.map((o) => [o.letter, o.text]))
        questions.push({
          key: `${year}-t${p.textNo}-q${q.num}`,
          seq: q.num - (p.textNo - 1) * 5 - 20,
          stem: q.stem,
          options: ['A', 'B', 'C', 'D'].map((letter) => optionMap.get(letter) || ''),
          answer,
          answerAlt,
          disputed,
          qtype: note?.qtype || 'other',
          locatePara: parseLocatePara(note?.locate || '', cleanedParagraphs.length),
          locateHint: note?.locate || '',
          explanation: note?.explanation || '',
          distractors: note?.distractors || '',
          answerNote,
          sourceRef: `${year}-考研英语二真题.md#Text${p.textNo}-Q${q.num}`,
          difficulty: 2,
          archived: false,
        })
      }

      passages.push({
        key: `${year}-t${p.textNo}`,
        year,
        textNo: p.textNo,
        title,
        topic: classifyTopic(title),
        difficulty: 2,
        wordCount: cleanedParagraphs.join(' ').split(/\s+/).filter(Boolean).length,
        paragraphs: cleanedParagraphs,
        translation: [],
        sourceRef: `${year}-英语二-试题.pdf p.${p.firstPage ?? '?'}`,
        questions,
        archived: false,
      })
      if (cleanedParagraphs.length === 0) {
        review.push(`${year},Text${p.textNo},空文章,`)
      }
    }
  }

  const bank = {
    version: 1,
    builtAt: new Date().toISOString(),
    paper: 'english2',
    dataset: {
      name: '考研英语二真题 2022–2026',
      readmeDate: '2026-10-31',
      sourceDir: SOURCE_DIR,
    },
    passages,
  }

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true })
  fs.mkdirSync(path.dirname(DRAFT_JSON), { recursive: true })
  fs.writeFileSync(DRAFT_JSON, JSON.stringify(bank, null, 2), 'utf8')
  fs.writeFileSync(
    REVIEW_CSV,
    ['year,scope,question,issue,detail', ...review].join('\n') + '\n',
    'utf8',
  )

  const questionCount = passages.reduce((n, p) => n + p.questions.length, 0)
  console.log(
    `题库：${passages.length} 篇 / ${questionCount} 题；问题条目 ${review.length} 条`,
  )
  console.log(`草稿：${DRAFT_JSON}`)
  console.log(`复核：${REVIEW_CSV}`)
  if (!CHECK_ONLY) {
    fs.writeFileSync(OUT_JSON, JSON.stringify(bank), 'utf8')
    console.log(`已写入：${OUT_JSON}`)
  } else {
    console.log('check-only：未写入应用资源')
  }
}

main()
