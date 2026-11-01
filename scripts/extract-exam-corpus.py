#!/usr/bin/env python3
"""
从「考研英语（二）」历年试题 PDF 提取正文语料，供 scripts/build-examples.mjs
生成单词卡片的「真题语境」。

数据源目录（默认 ~/data/work-buddy/考研英语二真题/原件存档）：
  文件名约定 YYYY-英语二-试题.pdf，PDF 需带文字层。
  源目录可用参数或环境变量 NETEM_PDF_DIR 覆盖。

运行：python3 scripts/extract-exam-corpus.py [源目录]
产物：scripts/.exam-corpus/corpus.json（中间产物，不进版本库）
  [{ "year": 2026, "section": "Text 1", "text": "Ask people about public libraries and ..." }]

取舍：
- 完形填空原文挖空密集且答案需回填，噪声大 → 整段跳过，只收阅读（Text 1-4）、
  新题型（Part B）与翻译正文。
- 扫描件 OCR 质量参差（2022 最差），用词典校验 + 数字/粘连检测把关，
  宁可少收，也不让错误原文进入词卡。

依赖：pypdf（python3 -m pip install pypdf）
"""
import json
import os
import re
import sys
from pathlib import Path

DEFAULT_DIR = Path.home() / 'data' / 'work-buddy' / '考研英语二真题' / '原件存档'
OUT_PATH = Path(__file__).resolve().parent / '.exam-corpus' / 'corpus.json'
DICT_PATHS = [Path('/usr/share/dict/words'), Path('/usr/share/dict/web2')]
FIXES_PATH = Path(__file__).resolve().parent / 'exam-corpus-fixes.json'
CLOZE_PATH = Path(__file__).resolve().parent / 'exam-cloze-answers.json'
# 只有官方试题卷（带可靠文字层）收进语料；2022–2024 为院校托管扫描件，
# OCR 讹误密度过高（'ga me' / 'address address' / 'fora tip'），不宜直接做词卡语境。
# 校对完成后可用 NETEM_YEARS=2022,2023,2024,2025,2026 重跑。
RELIABLE_YEARS = [2025, 2026]

NOISE = [
    re.compile(r'^\s*\d{1,3}\s*$'),
    re.compile(r'^\s*-\s*\d{1,3}\s*-\s*$'),
    re.compile(r'^\s*第\s*\d+\s*页'),
    re.compile(r'^\s*\d+\s*/\s*\d+\s*$'),
]
SECTION_RE = re.compile(r'Section\s*(I{1,3}V?|IV|II|I|1|2|3|4)\b', re.I)
TEXT_RE = re.compile(r'\btext\s*(\d)\b', re.I)
PARTB_RE = re.compile(r'Part\s*B\b')
PARTA_RE = re.compile(r'Part\s*A\b')
WRITING_RE = re.compile(r'Section\s*(IV|Ⅳ)\b')
CJK = re.compile(r'[\u4e00-\u9fff]')
TOKEN = re.compile(r"[A-Za-z][A-Za-z'’\-]*")
# 题干/选项/Directions 残片
BAD_SENTENCE = [
    re.compile(r'\bDirections\b', re.I),
    re.compile(r'ANSWER SHEET', re.I),
    re.compile(r'Read the following', re.I),
    re.compile(r'numbered (blank|paragraph)', re.I),
    re.compile(r'choos(e|ing) A, B, C', re.I),
    re.compile(r'^\s*[A-D]\s*[.、]'),
    re.compile(r'\bwrite your (answer|essay)', re.I),
]
SUFFIXES = [
    ('ies', 'y'), ('ier', 'y'), ('iest', 'y'), ('ies', ''),
    ('ing', ''), ('ing', 'e'), ('ed', ''), ('ed', 'e'), ('es', ''), ('s', ''), ('d', ''),
    ('ly', ''), ('er', ''), ('est', ''), ('ment', ''), ('ness', ''), ('tion', 't'), ('tion', ''),
]


def load_dict() -> set:
    for p in DICT_PATHS:
        if p.exists():
            return {w.strip().lower() for w in p.read_text(errors='ignore').splitlines() if w.strip()}
    return set()


APOSTROPHE = re.compile(r"[’'](s|re|ll|ve|d|m|t)$", re.I)
BRITISH = [('ise', 'ize'), ('ised', 'ized'), ('ising', 'izing'), ('isation', 'ization'),
           ('re', 'er'), ('our', 'or'), ('ogue', 'og'), ('ll', 'l')]


def is_known(word: str, vocab: set) -> bool:
    if not vocab:
        return True
    raw = word
    w = word.lower().replace('’', "'")
    orig = w
    if w in vocab:
        return True
    # 连字符复合词逐段判断：high-speed / climate-friendly
    if '-' in raw:
        parts = [p for p in re.split(r'[-\u2013\u2014]', raw) if p]
        return bool(parts) and all(is_known(p, vocab) for p in parts)
    # 全大写缩写：GDP / RFI / NHS
    if raw.isupper() and 1 < len(raw) <= 5:
        return True
    # 撇号缩写：you’re / it's / Italy's
    m = APOSTROPHE.search(w)
    if m:
        w = w[: -len(m.group(0))]
        if w in vocab:
            return True
    for suf, rep in SUFFIXES:
        if w.endswith(suf) and len(w) - len(suf) >= 3:
            stem = w[: -len(suf)] + rep
            if stem in vocab:
                return True
            if len(stem) > 4 and stem[-1] == stem[-2] and stem[:-1] in vocab:
                return True
    # 英式拼写回退：travelling / centres / utilised
    for a, b in BRITISH:
        if w.endswith(a):
            cand = w[: -len(a)] + b
            if cand in vocab or is_known(cand, vocab):
                return True
    for suf, rep in SUFFIXES:
        if w.endswith(suf) and len(w) - len(suf) >= 3:
            for a, b in BRITISH:
                stem = w[: -len(suf)] + rep
                if stem.endswith(a) and (stem[: -len(a)] + b) in vocab:
                    return True
    if len(w) > 4 and w[-1] == w[-2] and w[:-1] in vocab:
        return True
    return orig in vocab


def repair_spaces(text: str, vocab: set) -> str:
    """合并被 OCR 拆开的词：'increa sed' → 'increased'、'mon ste rs' → 'monsters'。
    仅在「合并后在词典、且至少有一段本身不是词」时合并，避免误伤正常空格。"""
    if not vocab:
        return text
    tokens = text.split(' ')

    def core(t: str) -> str:
        return re.sub(r"[^A-Za-z'’\-]", '', t)

    for _ in range(4):
        changed = False
        i = 0
        while i < len(tokens) - 1:
            # 优先尝试 3 段合并（'mon ste rs'），再退回 2 段
            for span in (3, 2):
                if i + span > len(tokens):
                    continue
                raw = tokens[i: i + span]
                if any(re.search(r'\d', t) for t in raw):
                    continue
                parts = [core(t) for t in raw]
                if not all(parts) or any(len(p) > 8 for p in parts):
                    continue
                joined = ''.join(parts)
                known = [is_known(p, vocab) for p in parts]
                known_join = is_known(joined, vocab)
                if not all(known):
                    # 至少有一段本身不是词：靠词典救回；人名允许「尾段极短」的拼合
                    proper = (parts[0][:1].isupper() and len(parts[0]) >= 3
                              and len(parts[-1]) <= 2 and not known[-1])
                    if known_join or proper:
                        tokens[i] = ''.join(raw)
                        del tokens[i + 1: i + span]
                        changed = True
                        break
                elif known_join and len(parts[0]) >= 3 and len(parts[-1]) <= 3:
                    # 各段都像词，但词尾被切开（'renew al' / 'car s'）
                    tokens[i] = ''.join(raw)
                    del tokens[i + 1: i + span]
                    changed = True
                    break
            i += 1
        if not changed:
            break
    return ' '.join(tokens)


def fix_quote_spaces(t: str) -> str:
    """按配对清理引号内首尾多余空格：'set aside " cold wards "' → 'set aside "cold wards"'。"""
    marks = list(re.finditer(r'["\u201c\u201d]', t))
    if not marks or len(marks) % 2:
        return t
    out = []
    prev = 0
    for i, m in enumerate(marks):
        out.append(t[prev: m.start()])
        if i % 2 == 0:
            out.append(m.group(0))
            prev = m.end()
            while prev < len(t) and t[prev] == ' ':
                prev += 1
        else:
            if out and out[-1].endswith(' '):
                out[-1] = out[-1].rstrip(' ')
            out.append(m.group(0))
            prev = m.end()
    out.append(t[prev:])
    return ''.join(out)


def normalize(text: str) -> str:
    t = text.replace('\u00a0', ' ').replace('\u3000', ' ')
    t = re.sub(r'\s+', ' ', t)
    # 撇号被空格拆开：'It 's' → "It's"
    t = re.sub(r"(?<=[A-Za-z])\s+['’](?=(?:s|re|ll|ve|d|m|t)\b)", "'", t, flags=re.I)
    # 断词连字符：'time -consuming' → 'time-consuming'
    t = re.sub(r'(?<=[A-Za-z])\s+-\s*(?=[A-Za-z])', '-', t)
    # 丢空白后的标点：'random,but' → 'random, but'
    t = re.sub(r'(?<=[,;:])(?=[A-Za-z])', ' ', t)
    # 标点前多余空格：'Similarly ,' → 'Similarly,'
    t = re.sub(r'\s+([,;:.!?])', r'\1', t)
    # 句号后无空格：'successful.it' → 'successful. it'（缩写已保护）
    t = re.sub(r'(?<=[a-z])\.(?=[A-Za-z])', '. ', t)
    # 句号被 OCR 认成斜杠：'served/Nearly' → 'served. Nearly'
    t = re.sub(r'(?<=[a-z])/(?=[A-Z])', '. ', t)
    # 双引号被挤掉空格（只在引号前补，避免破坏开引号后的正常连写）
    t = re.sub(r'(?<=[A-Za-z])([\u201c\u201d"])', r' \1', t)
    return re.sub(r'\s+', ' ', t).strip()


def clean_lines(text: str) -> list:
    out = []
    for line in text.split('\n'):
        line = line.replace('\u00a0', ' ').strip()
        if not line or any(p.match(line) for p in NOISE):
            continue
        out.append(line)
    return out


def find_body_end(lines: list) -> int:
    """部分试卷把答案/解析附在正文之后（第二次出现 Text 1 / Section），定位正文结束。"""
    first = next((i for i, l in enumerate(lines) if TEXT_RE.search(l)), None)
    if first is None:
        return len(lines)
    for i in range(first + 1, len(lines)):
        m = TEXT_RE.search(lines[i])
        if m and m.group(1) == '1' and i > first + 15:
            for j in range(i, max(first, i - 40), -1):
                if SECTION_RE.search(lines[j]) or PARTB_RE.search(lines[j]) or PARTA_RE.search(lines[j]):
                    return j
            return i
    return len(lines)


def split_sentences(text: str) -> list:
    if not text:
        return []
    protected = text
    for abbr in ['Mr.', 'Mrs.', 'Ms.', 'Dr.', 'St.', 'Jr.', 'Prof.', 'U.S.', 'U.K.', 'e.g.', 'i.e.', 'etc.', 'vs.', 'a.m.', 'p.m.']:
        protected = protected.replace(abbr, abbr.replace('.', '\u2024'))
    protected = re.sub(r'(\d)\.(\d)', lambda m: f'{m.group(1)}\u2024{m.group(2)}', protected)
    parts = re.split(r'(?<=[.!?])\s+', protected)
    return [p.replace('\u2024', '.').strip() for p in parts if p.strip()]


def sentence_ok(s: str, vocab: set) -> bool:
    if '_' in s or '[' in s or ']' in s or CJK.search(s):
        return False
    if any(p.search(s) for p in BAD_SENTENCE):
        return False
    if re.search(r'[A-Za-z]\d', s):
        return False  # 'day13.000'：字母与数字粘连，多为 OCR 讹误
    if re.search(r'\d\.\d{3}(?!\d)', s):
        return False  # '13.000 chickens'：千分位误用点号
    if re.search(r'[a-z]{2,}[A-Z]', s):
        return False  # 丢失空格的粘连
    words = TOKEN.findall(s)
    if len(words) < 5 or len(words) > 34:
        return False
    if not re.match(r'^["(*]?[A-Z]', s):
        return False
    if not re.search(r'[.!?"]$', s):
        return False
    letters = sum(1 for c in s if c.isalpha())
    if letters < len(s) * 0.7:
        return False
    # 词典校验：小写生词视为 OCR 讹误（允许 1 个短单位/缩略语）；
    # 大写生词可能是人名地名，最多 4 个
    unknown_proper = 0
    unknown_short = 0
    for w in words:
        if is_known(w, vocab):
            continue
        if w[0].isupper():
            unknown_proper += 1
            if unknown_proper > 4:
                return False
        elif len(w) <= 3:
            unknown_short += 1
            if unknown_short > 1:
                return False
        else:
            return False
    return True


def load_fixes() -> dict:
    if not FIXES_PATH.exists():
        return {'replacements': [], 'drop': []}
    return json.loads(FIXES_PATH.read_text(encoding='utf8'))


def apply_fixes(text: str, fixes: dict) -> str:
    for wrong, right in fixes.get('replacements', []):
        text = text.replace(wrong, right)
    return text


def is_dropped(sentence: str, fixes: dict) -> bool:
    return any(sentence.startswith(d) for d in fixes.get('drop', []))


def fill_cloze(text: str, answers: list) -> str:
    """把完形填空原文里的空号（1–20 的独立数字）替换为正确答案。"""
    if not answers:
        return text

    def repl(m):
        n = int(m.group(0))
        return answers[n - 1] if 0 < n <= len(answers) else m.group(0)

    return re.sub(r'(?<![\w,.])\d{1,2}(?![\w,.])', repl, text)


def parse_pdf(pdf_path: Path, vocab: set, fixes: dict, cloze: dict) -> tuple:
    year = int(pdf_path.name[:4])
    lines = clean_lines(extract(pdf_path))
    end = find_body_end(lines)

    # 先扫描分节标记，记录每行归属
    blocks = []  # [(label, kind, [lines])]
    label, kind = '阅读理解', 'skip'
    blocks.append([label, kind, []])
    text_numbers = []
    for line in lines[:end]:
        if WRITING_RE.search(line):
            label, kind = '写作', 'skip'
            blocks.append([label, kind, []])
            continue
        m = TEXT_RE.search(line)
        if m:
            n = int(m.group(1))
            text_numbers.append(n)
            label, kind = f'Text {n}', 'body'
            blocks.append([label, kind, []])
            continue
        if PARTB_RE.search(line) and kind != 'skip':
            label, kind = 'Part B', 'body'
            blocks.append([label, kind, []])
            continue
        sec = SECTION_RE.search(line)
        if sec:
            num = sec.group(1).upper().replace('Ⅱ', 'II').replace('Ⅳ', 'IV')
            if num in ('I', '1'):
                # 有回填答案时才收完形原文，否则挖空句无法成句
                label, kind = '完形填空', ('body' if str(year) in cloze else 'skip')
            elif num in ('III', '3'):
                label, kind = '翻译', 'body'
            elif num in ('IV', '4'):
                label, kind = '写作', 'skip'
            else:
                label, kind = '阅读理解', 'skip'
            blocks.append([label, kind, []])
            continue
        blocks[-1][2].append(line)

    # 篇目标注是否可信：Text 1-4 必须齐全，否则该年不标篇目
    labelable = sorted(set(text_numbers)) == [1, 2, 3, 4]

    result = []
    for label, kind, body in blocks:
        if kind != 'body':
            continue
        kept = []
        for line in body:
            if re.match(r'^\s*[\[(]?[A-D][\])]?\s*[.、](\s|$)', line):
                break  # 选项行 → 正文结束
            # 题号出现即正文结束，保留题号前可能残留的正文尾部
            m = re.search(r'(?:^|\s)\d{1,2}\s*[.、]\s*(?=[A-Z"“\[])', line)
            if m:
                head = line[: m.start()].strip()
                if head:
                    kept.append(head)
                break
            kept.append(line)
        raw_text = ' '.join(kept)
        if label == '完形填空':
            raw_text = fill_cloze(raw_text, cloze.get(str(year), []))
        text = apply_fixes(normalize(repair_spaces(normalize(raw_text), vocab)), fixes)
        section = label if labelable else ('Part B' if label == 'Part B' else ('翻译' if label == '翻译' else '阅读理解'))
        for s in (fix_quote_spaces(x) for x in split_sentences(text)):
            if is_dropped(s, fixes):
                continue
            if sentence_ok(s, vocab):
                result.append({'year': year, 'section': section, 'text': s})
    return result, labelable


def extract(pdf_path: Path) -> str:
    try:
        import pypdf
    except ImportError:
        raise SystemExit('缺少依赖 pypdf，请先执行：python3 -m pip install pypdf')

    reader = pypdf.PdfReader(str(pdf_path))
    return '\n'.join((page.extract_text() or '') for page in reader.pages)


def main() -> None:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(os.environ.get('NETEM_PDF_DIR', DEFAULT_DIR))
    pdfs = sorted(src.glob('*英语二*试题.pdf'))
    if not pdfs:
        raise SystemExit(f'未找到试题 PDF：{src}')
    vocab = load_dict()
    if not vocab:
        print('[corpus] 警告：未找到系统词典，OCR 校验关闭')
    fixes = load_fixes()
    cloze = json.loads(CLOZE_PATH.read_text(encoding='utf8')) if CLOZE_PATH.exists() else {}
    years = {int(y) for y in os.environ.get('NETEM_YEARS', ','.join(str(y) for y in RELIABLE_YEARS)).split(',') if y.strip()}
    corpus = []
    for pdf in pdfs:
        year = int(pdf.name[:4])
        if year not in years:
            print(f'[corpus] {pdf.name}: 跳过（OCR 质量不足，未列入可信年份 {sorted(years)}）')
            continue
        rows, labelable = parse_pdf(pdf, vocab, fixes, cloze)
        corpus.extend(rows)
        by_sec = {}
        for r in rows:
            by_sec[r['section']] = by_sec.get(r['section'], 0) + 1
        print(f'[corpus] {pdf.name}: {len(rows)} 句 {"（篇目标注可信）" if labelable else "（篇目缺失，已降级标注）"} {by_sec}')
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(corpus, ensure_ascii=False, indent=0), encoding='utf8')
    print(f'[corpus] 共 {len(corpus)} 句 → {OUT_PATH}')


if __name__ == '__main__':
    main()
