#!/usr/bin/env node
/**
 * 构建英语二完形填空题库（作者工具）。
 *
 * 数据源：
 *   - {READING_SOURCE_DIR}/{year}-考研英语二真题.md（答案、正确词、考点、简析）
 *   - {READING_SOURCE_DIR}/README.md（完形答案速查表，交叉校验）
 *   - reading-source/pdf-text/{year}-英语二-试题.txt（挖空原文 + A-D 选项）
 *
 * 产物：
 *   - src/assets/exam-cloze/cloze-bank.json
 *   - reading-source/cloze-draft.json
 *   - reading-source/cloze-review.csv
 *
 * 用法：
 *   node scripts/build-cloze-bank.mjs [--source <dir>] [--check-only]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DEFAULT_SOURCE = process.env.READING_SOURCE_DIR || '/Users/cgy/data/work-buddy/考研英语二真题'
const args = process.argv.slice(2)
const sourceArgIndex = args.indexOf('--source')
const SOURCE_DIR = sourceArgIndex >= 0 ? args[sourceArgIndex + 1] : DEFAULT_SOURCE
const CHECK_ONLY = args.includes('--check-only')
const PDF_TEXT_DIR = path.join(ROOT, 'reading-source', 'pdf-text')
const OUT_DIR = path.join(ROOT, 'src', 'assets', 'exam-cloze')
const OUT_JSON = path.join(OUT_DIR, 'cloze-bank.json')
const DRAFT_JSON = path.join(ROOT, 'reading-source', 'cloze-draft.json')
const REVIEW_CSV = path.join(ROOT, 'reading-source', 'cloze-review.csv')

const YEARS = [2022, 2023, 2024, 2025, 2026]
// 不使用 \b：2023/2024 的 OCR 常把空号与前后单词粘连（6was / 1some），
// 用数字边界排除 2012、50、92 这类正文数字。
const BLANK_RE = /(?<!\d)(20|19|18|17|16|15|14|13|12|11|10|9|8|7|6|5|4|3|2|1)(?!\d)\s*_?/g

/** 原文 OCR/排版定点修正（按年份作用域） */
const PASSAGE_FIXES = {
  common: [
    [/It'simportant/g, "It's important"],
    [/it’sonly/g, "it's only"],
    [/It’sjust/g, "It's just"],
    [/is,to/g, 'is, to'],
    [/startsto/g, 'starts to'],
    [/fora/g, 'for a'],
    [/areal/g, 'a real'],
    [/diffe rent/g, 'different'],
    [/engin\s*eering/g, 'engineering'],
    [/engine\s*ering/g, 'engineering'],
    [/proje\s*ct/g, 'project'],
    [/back bur\s*ner/g, 'back burner'],
    [/lifeis/g, 'life is'],
    [/ifit'sdoing/g, "if it's doing"],
    [/It'sa/g, "It's a"],
    [/itis/g, 'it is'],
    [/you’re/g, "you're"],
    [/it’s/g, "it's"],
    [/don’t/g, "don't"],
    [/won’t/g, "won't"],
    [/can’t/g, "can't"],
    [/\b(\d{1,2})\s*_/g, '$1'],
    [/\s+/g, ' '],
  ],
  2022: [
    [/hale to be less/g, 'have to be less'],
    [/Pointing out that/g, 'He points out that'],
    [/with  your  friends  an  less/g, 'with your friends and less'],
    [/friends an less/g, 'friends and less'],
    [/It's\s+(?:a\s+)?15\s+learning curve, and it always won't always make you popular\./g, "It's a 15 learning curve, and it won't always make you popular."],
    [/at least sometime for/g, 'at least some time for'],
    [/Any write needs to read as mach and as widely/g, 'Any writer needs to read as much and as widely'],
    [/The older you yet/g, 'The older you get'],
    [/We need to use it’s a carefully/g, 'We need to use it carefully'],
    [/We need to use it's a carefully/g, 'We need to use it carefully'],
    [/prioritizing out activities/g, 'prioritizing our activities'],
    [/writing-and/g, 'writing—and'],
    [/best selling/g, 'best-selling'],
    [/job-a job/g, 'job—a job'],
    [/supporter-something/g, 'supporter—something'],
    [/\{\{20\}\}—/g, '{{20}} —'],
  ],
  2023: [
    [/It needs someone whose\s+can\s+15\s+the interdisciplinary team/g, 'It needs someone who can 15 the interdisciplinary team'],
    [/steering the\s+m clear of distractions/g, 'steering the team clear of distractions'],
    [/a nice\s+1\s*,/g, 'a nice 1,'],
    [/2012,when/g, '2012, when'],
    [/Things changed,\s+8\s*\.when/g, 'Things changed, 8, when'],
    [/the\s+11of\s+upgrades/g, 'the 11 of upgrades'],
    [/the\s+12\s*,/g, 'the 12,'],
    [/the\s+13\s*to\s+the\s+free version/g, 'the 13 to the free version'],
    [/14\s*,\s*upgrades skyrocketed/g, '14, upgrades skyrocketed'],
    [/version\.\{\{14\}\}/g, 'version. {{14}}'],
  ],
  2024: [
    [/with others,\s+1\s*_some/g, 'with others, 1 some'],
    [/finding a\s+2\s+in/g, 'finding a 2 in'],
    [/not\s+3\s*_others/g, 'not 3 others'],
    [/and\s+4\s*_Loneliness/g, 'and 4. Loneliness'],
    [/and\s+5\s*_a low mood/g, 'and 5 a low mood'],
    [/7\s*_on/g, '7 on'],
    [/8\s*_periods/g, '8 periods'],
    [/ways to\s+9\s+a social life/g, 'ways to 9 a social life'],
    [/can feel overwhelming\s+10\s*_\./g, 'can feel overwhelming 10.'],
    [/to\s+12\s*_a\s+new sport/g, 'to 12 a new sport'],
    [/never any\s+15\s*_in/g, 'never any 15 in'],
    [/social\s+16\s*\.We/g, 'social 16. We'],
    [/you\s+18\s+some\s+time/g, 'you 18 some time'],
    [/when you're\s+19\s+for/g, "when you're 19 for"],
    [/relax,\s+20\s*\.\s+and recover/g, 'relax, 20, and recover'],
    [/iskey/g, 'is key'],
    [/isknown/g, 'is known'],
    [/\{\{4\}\} Loneliness/g, '{{4}}. Loneliness'],
    [/\{\{6\}\},you/g, '{{6}}, you'],
    [/lifechanges/g, 'life changes'],
    [/life,but/g, 'life, but'],
    [/itcan/g, 'it can'],
    [/feellike/g, 'feel like'],
    [/life\.If/g, 'life. If'],
    [/it'simportant/g, "it's important"],
    [/it'sall/g, "it's all"],
  ],
  2025: [
    [/Asking\s+or help/g, 'Asking for help'],
    [/Itinvolves/g, 'It involves'],
    [/your  part-there's/g, "your part—there's"],
    [/Asking\s+or help\s+takes/g, 'Asking for help takes'],
    [/startsto/g, 'starts to'],
    [/help-seeker\s+generally/g, 'help-seekers generally'],
    [/Maybe\s+most\s+encouraging\s+of all/g, 'Perhaps most encouraging of all'],
    [/led tosome/g, 'led to some'],
    [/part-there’s/g, "part—there's"],
    [/talking it personally/g, 'taking it personally'],
    [/ability to help$/g, 'ability to help.'],
  ],
  2026: [
    [/thoughts/g, 'thoughts'],
    [/the\s+both\s+felt unwell/g, 'they both felt unwell'],
    [/it’sonly/g, "it's only"],
    [/is,to/g, 'is, to'],
    [/It’sjust/g, "It's just"],
    [/what’s/g, "what's"],
    [/you’re/g, "you're"],
    [/they’re/g, "they're"],
    [/staff\.Or/g, 'staff. Or'],
    [/itmight/g, 'it might'],
  ],
}

const OPTION_FIXES = {
  2025: {
    4: ['At any time', 'In other words', 'By all means', 'On the contrary'],
    5: ['unrealistic', 'deceptive', 'tiresome', 'uncomfortable'],
    10: ['reach out', 'settle down', 'turn over', 'look back'],
    16: ['recall', 'classify', 'analyse', 'compare'],
  },
  2023: {
    16: ['share', 'identify', 'divide', 'broaden'],
  },
  2022: {
    15: ['tough', 'gentle', 'rapid', 'funny'],
    20: ['at most', 'in turn', 'on average', 'above all'],
  },
}

const TITLE_BY_YEAR = {
  2022: '写作时间与优先级',
  2023: '小企业增长团队',
  2024: '社交生活与社交健康',
  2025: '为什么难以开口求助',
  2026: '自尊与两种心理防御',
}

const TOPIC_BY_YEAR = {
  2022: '职业成长',
  2023: '商业管理',
  2024: '社会心理',
  2025: '社会心理',
  2026: '心理科普',
}

function normalizeSpace(s) {
  return s.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
}

function stripHtml(s) {
  return s.replace(/\*\*/g, '').replace(/`/g, '').replace(/\\_/g, '_').trim()
}

function csvCell(value) {
  const s = String(value ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** 解析解析集里的完形逐题表 */
function parseNotes(year) {
  const file = path.join(SOURCE_DIR, `${year}-考研英语二真题.md`)
  const text = fs.readFileSync(file, 'utf8')
  const start = text.search(/##\s*Section\s*I\s*英语知识运用/)
  if (start < 0) throw new Error(`${year} 解析集缺少 Section I`)
  const rest = text.slice(start)
  const end = rest.search(/##\s*Section\s*II\s*阅读理解/)
  const block = end >= 0 ? rest.slice(0, end) : rest
  const rows = []
  for (const line of block.split('\n')) {
    if (!line.trim().startsWith('|')) continue
    const cols = line.split('|').map((c) => c.trim())
    if (cols.length < 7) continue
    const seq = Number(cols[1])
    if (!Number.isInteger(seq) || seq < 1 || seq > 20) continue
    rows.push({
      seq,
      answer: stripHtml(cols[2]).toUpperCase(),
      answerWord: stripHtml(cols[3]),
      point: stripHtml(cols[4]),
      explanation: stripHtml(cols[5]),
    })
  }
  if (rows.length !== 20) {
    throw new Error(`${year} 完形逐题表应有 20 行，实际 ${rows.length}`)
  }
  rows.sort((a, b) => a.seq - b.seq)
  return rows
}

/** 从 README 读取完形答案速查表（交叉校验用） */
function parseReadmeAnswers() {
  const file = path.join(SOURCE_DIR, 'README.md')
  const text = fs.readFileSync(file, 'utf8')
  const start = text.indexOf('### 完形填空')
  if (start < 0) return new Map()
  const block = text.slice(start, text.indexOf('### 阅读理解', start) > 0 ? text.indexOf('### 阅读理解', start) : undefined)
  const map = new Map()
  for (const line of block.split('\n')) {
    const m = line.match(/^\|\s*(20\d{2})\s*\|\s*([A-D ]+)\s*\|\s*([A-D ]+)\s*\|\s*([A-D ]+)\s*\|\s*([A-D ]+)\s*\|/)
    if (!m) continue
    const letters = [m[2], m[3], m[4], m[5]].join(' ').split(/\s+/).filter(Boolean)
    if (letters.length === 20) map.set(Number(m[1]), letters)
  }
  return map
}

/** 从 PDF 文本中切出完形段与选项段 */
function extractPdfParts(year) {
  const file = path.join(PDF_TEXT_DIR, `${year}-英语二-试题.txt`)
  const raw = fs.readFileSync(file, 'utf8')
  const lines = raw.split('\n')
  let start = lines.findIndex((l) => /Section\s+I\s+Use\s+of\s+English/i.test(l))
  if (start < 0) start = lines.findIndex((l) => /Use\s+of\s+English/i.test(l))
  if (start < 0) start = 0
  let end = lines.findIndex((l, i) => i > start && /Section\s*(II|Ⅱ)\s*Reading\s+Comprehension/i.test(l))
  if (end < 0) end = lines.length
  const part = lines.slice(start + 1, end)

  // 去掉 Directions / 页眉 / 页码
  const clean = part.filter((line) => {
    const t = line.trim()
    if (!t) return false
    if (/^=== PAGE \d+ ===$/.test(t)) return false
    if (/^\d{1,3}$/.test(t)) return false
    if (/^-\s*\d+\s*-$/.test(t)) return false
    if (/Directions|ANSWER\s+SHEET|numbered\s+blank|Choose\s+the\s+best|Read\s+the\s+following/i.test(t)) return false
    if (/全国硕士研究生|英语（二）|科目代码|试题$/i.test(t)) return false
    return true
  })

  const optionStart = clean.findIndex((l) => /^\s*1\s*[.)]?\s*(?:\[A\]|A\s*[.)])/i.test(l))
  if (optionStart < 0) throw new Error(`${year} 未找到完形选项起始行`)
  const passageLines = clean.slice(0, optionStart)
  const optionLines = clean.slice(optionStart)

  let passage = normalizeSpace(passageLines.join(' '))
  let optionText = normalizeSpace(optionLines.join(' '))

  // 部分年份 Directions 的尾行会混进正文（SHEET.(10points) / points)）
  passage = passage.replace(/^(?:SHEET\.?\s*\(?10\s*points\)?|points\))\s*/i, '')
  for (const [re, to] of [...PASSAGE_FIXES.common, ...(PASSAGE_FIXES[year] || [])]) {
    passage = passage.replace(re, to)
  }
  passage = normalizeSpace(passage)

  // 按空号切块，避免行内选项把文本吞掉
  return { passage, optionText }
}

function parseOptions(year, optionText) {
  // 去掉页眉/页码残留
  optionText = optionText
    .replace(/=== PAGE \d+ ===/g, ' ')
    .replace(/\s+\d{1,3}\s*$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  // 按题号切块：1. / 1 / 1.A. / 1. [A]
  const blocks = new Map()
  const re = /(?:^|\s)(\d{1,2})\s*[.)]?\s*(?=\[?[A-D]|[A-D]\s*[.)])/g
  const matches = [...optionText.matchAll(re)]
  for (let i = 0; i < matches.length; i++) {
    const seq = Number(matches[i][1])
    if (seq < 1 || seq > 20) continue
    const start = matches[i].index + matches[i][0].length
    const end = matches[i + 1]?.index ?? optionText.length
    if (!blocks.has(seq)) blocks.set(seq, optionText.slice(start, end).trim())
  }

  const questions = []
  for (let seq = 1; seq <= 20; seq++) {
    let block = blocks.get(seq) || ''
    if (!block) throw new Error(`${year} 第 ${seq} 空缺少选项块`)
    // 提取 A-D 标签；兼容 [A] 和 A.
    const labels = [...block.matchAll(/\[([A-D])\]|(?:^|\s)([A-D])\s*[.)]/g)]
    if (labels.length < 4 && !OPTION_FIXES[year]?.[seq]) {
      throw new Error(`${year} 第 ${seq} 空只解析到 ${labels.length} 个选项`)
    }
    const parsed = []
    for (let i = 0; i < Math.min(4, labels.length); i++) {
      const m = labels[i]
      const start = m.index + m[0].length
      const end = labels[i + 1]?.index ?? block.length
      let text = normalizeSpace(block.slice(start, end))
      text = text.replace(/\[[A-D]\]/g, ' ').replace(/\s+/g, ' ').trim()
      parsed.push(text.replace(/[.,;:]+$/, '').trim())
    }
    const fixed = OPTION_FIXES[year]?.[seq]
    questions.push(fixed || parsed)
  }
  return questions
}

/** 将原文中的 1-20 空号替换为 {{n}}，并校验恰好 20 个 */
function replaceBlanks(passage) {
  let count = 0
  const replaced = passage
    .replace(BLANK_RE, (_m, num) => {
      count += 1
      return `{{${num}}}`
    })
    .replace(/([A-Za-z])\{\{(\d+)\}\}/g, '$1 {{$2}}')
    .replace(/\{\{(\d+)\}\}([A-Za-z])/g, '{{$1}} $2')
    .replace(/\.\{\{(\d+)\}\}/g, '. {{$1}}')
    .replace(/\{\{(\d+)\}\}—/g, '{{$1}} —')
    .replace(/\{\{4\}\} Loneliness/g, '{{4}}. Loneliness')
    .replace(/\{\{(\d+)\}\},(?=[A-Za-z])/g, '{{$1}}, ')
    .replace(/\s+/g, ' ')
    .trim()
  return { replaced, count }
}

/** 正确词归一化：忽略 (on) 这类括号补充与标点 */
function normalizeWordForMatch(value) {
  return String(value)
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9' -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function sentenceAround(text, needle) {
  const idx = text.indexOf(needle)
  if (idx < 0) return text.slice(0, 200)
  let start = idx
  while (start > 0 && !'.!?'.includes(text[start - 1])) start--
  let end = idx + needle.length
  while (end < text.length && !'.!?'.includes(text[end])) end++
  if (end < text.length) end++
  return text.slice(start, end).trim().slice(0, 280)
}

function main() {
  if (!fs.existsSync(PDF_TEXT_DIR)) {
    throw new Error(`缺少 ${PDF_TEXT_DIR}，请先运行 python3 scripts/extract-reading-pdfs.py`)
  }
  const readmeAnswers = parseReadmeAnswers()
  const passages = []
  const review = []

  for (const year of YEARS) {
    const notes = parseNotes(year)
    const { passage: rawPassage, optionText } = extractPdfParts(year)
    const { replaced, count } = replaceBlanks(rawPassage)
    if (count !== 20) {
      review.push({ year, seq: '', issue: `空号数量 ${count} != 20`, text: replaced.slice(0, 160) })
    }
    const optionRows = parseOptions(year, optionText)
    const passageKey = `${year}-cloze`
    const questions = notes.map((row) => {
      const options = optionRows[row.seq - 1] || []
      const idx = 'ABCD'.indexOf(row.answer)
      const letterFromWord = options.findIndex((o) => normalizeWordForMatch(o) === normalizeWordForMatch(row.answerWord))
      if (options.length !== 4) review.push({ year, seq: row.seq, issue: `选项数 ${options.length}`, text: options.join(' | ') })
      if (idx < 0) review.push({ year, seq: row.seq, issue: `答案字母非法 ${row.answer}`, text: row.answerWord })
      if (letterFromWord >= 0 && letterFromWord !== idx) {
        review.push({
          year,
          seq: row.seq,
          issue: `答案字母 ${row.answer} 与正确词所在项 ${'ABCD'[letterFromWord]} 不一致`,
          text: `${row.answerWord} | ${options.join(' | ')}`,
        })
      }
      if (letterFromWord < 0) {
        review.push({ year, seq: row.seq, issue: `正确词不在选项中：${row.answerWord}`, text: options.join(' | ') })
      }
      const context = sentenceAround(replaced, `{{${row.seq}}}`)
      return {
        key: `${passageKey}-q${row.seq}`,
        seq: row.seq,
        context,
        options,
        answer: row.answer,
        answerWord: row.answerWord,
        qtype: row.point || '词义辨析',
        explanation: row.explanation,
      }
    })

    const readme = readmeAnswers.get(year)
    if (readme && readme.join('') !== notes.map((n) => n.answer).join('')) {
      review.push({
        year,
        seq: '',
        issue: '逐题答案与 README 答案速查不一致',
        text: `notes=${notes.map((n) => n.answer).join('')} readme=${readme.join('')}`,
      })
    }

    const wordCount = replaced.replace(/\{\{\d+\}\}/g, ' ').split(/\s+/).filter(Boolean).length
    passages.push({
      key: passageKey,
      year,
      title: TITLE_BY_YEAR[year],
      topic: TOPIC_BY_YEAR[year],
      difficulty: year >= 2025 ? 3 : 2,
      wordCount,
      paragraphs: [replaced],
      sourceRef: `${year}-英语二-试题.pdf`,
      questions,
    })
  }

  const bank = {
    version: 1,
    builtAt: new Date().toISOString(),
    paper: 'english2-cloze',
    dataset: {
      sourceDir: SOURCE_DIR,
      years: YEARS,
    },
    passages,
  }

  if (CHECK_ONLY) {
    console.log(JSON.stringify({ passages: passages.length, questions: passages.reduce((n, p) => n + p.questions.length, 0), review: review.length }, null, 2))
    if (review.length) {
      console.log(review.map((r) => `${r.year} Q${r.seq}: ${r.issue} ${r.text}`).join('\n'))
      process.exitCode = 1
    }
    return
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.mkdirSync(path.dirname(DRAFT_JSON), { recursive: true })
  fs.writeFileSync(OUT_JSON, JSON.stringify(bank, null, 2))
  fs.writeFileSync(DRAFT_JSON, JSON.stringify(bank, null, 2))
  const header = 'year,seq,issue,text\n'
  fs.writeFileSync(REVIEW_CSV, header + review.map((r) => [r.year, r.seq, r.issue, r.text].map(csvCell).join(',')).join('\n') + '\n')

  console.log(`wrote ${OUT_JSON}`)
  console.log(`passages ${passages.length}, questions ${passages.reduce((n, p) => n + p.questions.length, 0)}, review ${review.length}`)
  if (review.length) {
    console.log(review.map((r) => `${r.year} Q${r.seq}: ${r.issue} ${r.text.slice(0, 120)}`).join('\n'))
  }
}

main()
