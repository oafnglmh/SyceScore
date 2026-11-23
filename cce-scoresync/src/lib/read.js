import { blobToBase64 } from './ai'
import { focusPrompt, HAND_PROMPT, HAND_SCHEMA, SYSTEM_PROMPT, SYSTEM_SCHEMA } from './prompts'
import { formatScore, parseHandDigits, parseSystemScore, parseWords, sameScore } from './score'
import { classFromRows, clean, cleanDate, cleanId, deconfuse } from './text'

// Mỗi trang (của cả hai loại tài liệu) được chuẩn hóa về cùng một dạng để bỏ phiếu giữa các lần đọc:
//   { blocks: [{ meta: { field: string }, rows: [{ key, tt, f: { field: string }, …chi tiết }] }] }
// - Bảng điểm hệ thống: mỗi học phần trên trang là một block.
// - Biên bản viết tay: cả trang là một block.

export const ABSENT = 'VẮNG'
const MISSING = '∅'

// ─── Bỏ phiếu ────────────────────────────────────────────────────────────────

function vote(values) {
  const counts = new Map()
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1)
  let best = values[0]
  let bestCount = 0
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v
      bestCount = c
    }
  }
  return {
    value: best,
    strict: bestCount > values.length / 2,
    unanimous: counts.size === 1,
    candidates: [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count),
  }
}

function keyed(rows) {
  const tts = rows.map((r) => r.tt)
  const unique = tts.every((t) => t !== null) && new Set(tts).size === tts.length
  rows.forEach((r, i) => (r.key = unique ? `tt${r.tt}` : `#${i}`))
  return rows
}

const toTT = (v) => (Number.isInteger(v) ? v : parseInt(v, 10) || null)
const toY = (v) => (Number.isFinite(v) ? v : null)

// ─── Chuẩn hóa từng loại ─────────────────────────────────────────────────────

function systemValue(v) {
  const n = parseSystemScore(v)
  return n === null ? clean(v) : formatScore(n)
}

function normalizeSystem(raw) {
  return {
    blocks: (raw?.sections || []).map((s) => {
      const columns = (s.columns || []).map(clean)
      const rows = (s.rows || []).map((r) => {
        const f = { ma: cleanId(r.ma_sv), ho_ten: clean(r.ho_ten), ngay_sinh: cleanDate(r.ngay_sinh) }
        columns.forEach((_, i) => (f[`v${i}`] = systemValue(r.values?.[i])))
        return { tt: toTT(r.tt), f, row_y: toY(r.row_y) }
      })
      return { meta: { title: clean(s.title), lop: cleanId(s.lop), columns: columns.join(' | ') }, rows: keyed(rows) }
    }),
  }
}

function normalizeHand(raw) {
  const h = raw?.header || {}
  const hasHeader = !!raw?.has_header && !!clean(h.lop || h.mon || h.bai)
  const rows = (raw?.rows || []).map((r) => {
    const digitsRaw = clean(r.diem_so)
    const wordsRaw = clean(r.diem_chu)
    const digits = parseHandDigits(digitsRaw)
    const absent = !!r.vang || (!digitsRaw && !wordsRaw)
    let wordsValue = parseWords(wordsRaw)
    if (wordsValue === null && typeof r.diem_chu_so === 'number' && r.diem_chu_so >= 0 && r.diem_chu_so <= 10) {
      wordsValue = r.diem_chu_so
    }
    return {
      tt: toTT(r.tt),
      f: {
        ma: cleanId(r.ma_hv),
        ho_ten: clean(`${clean(r.ho_dem)} ${clean(r.ten)}`),
        ngay_sinh: cleanDate(r.ngay_sinh),
        score: absent ? ABSENT : digits === null ? `?${digitsRaw}` : formatScore(digits),
      },
      digitsRaw,
      digits,
      wordsRaw,
      wordsValue,
      absent,
      row_y: toY(r.row_y),
    }
  })
  return {
    blocks: [
      {
        meta: {
          has_header: hasHeader ? 'có' : '',
          tieu_de: hasHeader ? clean(h.tieu_de) : '',
          lop: hasHeader ? cleanId(h.lop) : '',
          mon: hasHeader ? clean(h.mon) : '',
          bai: hasHeader ? clean(h.bai) : '',
          nganh: hasHeader ? clean(h.nganh) : '',
          hoc_ky: hasHeader ? clean(h.hoc_ky) : '',
          khoa: hasHeader ? clean(h.khoa) : '',
          thoi_gian: hasHeader ? clean(h.thoi_gian) : '',
          so_bai_thi: clean(raw?.footer?.so_bai_thi).replace(/[^\d]/g, ''),
          so_hoc_vien: clean(raw?.footer?.so_hoc_vien).replace(/[^\d]/g, ''),
        },
        rows: keyed(rows),
      },
    ],
  }
}

export const KINDS = {
  system: { prompt: SYSTEM_PROMPT, schema: SYSTEM_SCHEMA, normalize: normalizeSystem, keyMeta: ['title', 'columns'] },
  hand: { prompt: HAND_PROMPT, schema: HAND_SCHEMA, normalize: normalizeHand, keyMeta: ['has_header', 'lop', 'mon', 'bai'] },
}

const META_LABEL = { title: 'tên học phần', columns: 'tên cột', has_header: 'phần đầu', lop: 'Lớp', mon: 'Môn thi', bai: 'Bài' }
const FIELD_LABEL = { ma: 'Mã HV', ho_ten: 'Họ tên', ngay_sinh: 'Ngày sinh', score: 'điểm' }

// ─── Đối chiếu giữa các lần đọc ──────────────────────────────────────────────

function rowKeys(blocks) {
  const seen = new Map()
  for (const b of blocks) for (const r of b.rows) if (!seen.has(r.key)) seen.set(r.key, r.tt ?? 9999)
  return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([k]) => k)
}

const fieldsOf = (rows) => [...new Set(rows.flatMap((r) => Object.keys(r.f)))]

/** Ô "Số" khác ô "Chữ" ở bản đa số → đọc lại một lần cho chắc. */
function wordsDisagree(present) {
  const win = vote(present.map((r) => r.f.score)).value
  const winners = present.filter((r) => r.f.score === win)
  if (win === ABSENT || winners[0].digits === null) return false
  const w = winners.map((r) => r.wordsValue).filter((x) => x !== null)
  return w.length > 0 && !w.some((x) => sameScore(x, winners[0].digits))
}

/** Những chỗ các lần đọc chưa có đa số rõ ràng → mô tả để đọc lại có trọng tâm. */
function unresolved(reads, kind, { checkWords }) {
  const bc = vote(reads.map((r) => r.blocks.length))
  if (!bc.strict) return ['số bảng điểm trên trang']
  const aligned = reads.filter((r) => r.blocks.length === bc.value)
  const spots = []
  for (let b = 0; b < bc.value; b++) {
    const blocks = aligned.map((r) => r.blocks[b])
    const prefix = bc.value > 1 ? `bảng thứ ${b + 1} – ` : ''
    const badMeta = KINDS[kind].keyMeta.filter((f) => !vote(blocks.map((x) => x.meta[f])).strict)
    if (badMeta.length) spots.push(`${prefix}${badMeta.map((f) => META_LABEL[f]).join(', ')}`)
    const tts = []
    for (const key of rowKeys(blocks)) {
      const rows = blocks.map((x) => x.rows.find((r) => r.key === key))
      const present = rows.filter(Boolean)
      const bad =
        !vote(rows.map((r) => (r ? 'có' : MISSING))).strict ||
        fieldsOf(present).some((f) => !vote(rows.map((r) => (r ? (r.f[f] ?? '') : MISSING))).strict) ||
        (checkWords && kind === 'hand' && wordsDisagree(present))
      if (bad) tts.push(present[0].tt ?? key)
    }
    if (tts.length) spots.push(`${prefix}TT ${tts.join(', ')}`)
  }
  return spots
}

function mergeHandScore(present, voted, flags) {
  const winners = present.filter((r) => r.f.score === voted)
  const absent = voted === ABSENT
  const w = winners[0]
  const wv = vote(winners.map((r) => (r.wordsValue === null ? MISSING : formatScore(r.wordsValue))))
  const wordsValue = wv.value === MISSING ? null : Number(wv.value)
  const out = { absent, digitsRaw: w.digitsRaw, wordsRaw: w.wordsRaw, wordsValue, score: absent ? null : w.digits }

  if (absent) {
    if (wordsValue !== null) flags.push({ level: 'error', source: 'sheet', field: 'score', msg: `Ô Số để trống nhưng ô Chữ ghi “${w.wordsRaw}”.` })
  } else if (w.digits === null) {
    if (wordsValue !== null) {
      out.score = wordsValue
      flags.push({ level: 'warn', source: 'read', field: 'score', msg: `Không đọc được ô Số (“${w.digitsRaw}”) – tạm lấy theo ô Chữ “${w.wordsRaw}”.` })
    } else {
      flags.push({ level: 'error', source: 'read', field: 'score', msg: `Không đọc được điểm (Số “${w.digitsRaw}”, Chữ “${w.wordsRaw}”).` })
    }
  } else if (wordsValue === null) {
    if (w.wordsRaw) flags.push({ level: 'warn', source: 'read', field: 'score', msg: `Không đọc được ô Chữ (“${w.wordsRaw}”) để đối chiếu với ô Số.` })
  } else if (!sameScore(w.digits, wordsValue)) {
    flags.push({
      level: 'error',
      source: 'sheet',
      field: 'score',
      msg: `Ô Số “${w.digitsRaw}” (${formatScore(w.digits)}) khác ô Chữ “${w.wordsRaw}” (${formatScore(wordsValue)}).`,
    })
  }
  return out
}

function mergeReads(reads, kind) {
  const bc = vote(reads.map((r) => r.blocks.length))
  const aligned = reads.filter((r) => r.blocks.length === bc.value)
  const n = aligned.length
  const pageFlags = bc.strict ? [] : [`Các lần đọc không thống nhất số bảng trên trang (${bc.candidates.map((c) => c.value).join(' / ')}).`]

  const blocks = []
  for (let b = 0; b < bc.value; b++) {
    const parts = aligned.map((r) => r.blocks[b])
    const meta = {}
    const metaFlags = []
    for (const f of Object.keys(parts[0].meta)) {
      const v = vote(parts.map((x) => x.meta[f]))
      meta[f] = v.value
      if (!v.strict && KINDS[kind].keyMeta.includes(f)) metaFlags.push(META_LABEL[f])
    }

    const colNames = meta.columns ? meta.columns.split(' | ') : []
    const rows = []
    for (const key of rowKeys(parts)) {
      const present = parts.map((x) => x.rows.find((r) => r.key === key)).filter(Boolean)
      const flags = []
      if (present.length < n) {
        flags.push({
          level: present.length > n / 2 ? 'warn' : 'error',
          source: 'read',
          field: 'row',
          msg: `Dòng chỉ xuất hiện ở ${present.length}/${n} lần đọc – kiểm tra dòng này trên giấy.`,
        })
      }
      const f = {}
      for (const field of fieldsOf(present)) {
        const v = vote(present.map((r) => r.f[field] ?? ''))
        f[field] = v.value
        if (!v.strict && n > 1) {
          const label = FIELD_LABEL[field] || `cột ${colNames[+field.slice(1)] || field}`
          flags.push({
            level: 'error',
            source: 'read',
            field,
            msg: `AI đọc ${label} không thống nhất: ${v.candidates.map((c) => `“${c.value.replace(/^\?/, '')}”`).join(' / ')}.`,
          })
        }
      }
      const ys = present.map((r) => r.row_y).filter((y) => y !== null)
      const row = { tt: present[0].tt, ...f, row_y: ys.length ? Math.round(ys.reduce((a, c) => a + c, 0) / ys.length) : null, flags }
      if (kind === 'hand') Object.assign(row, mergeHandScore(present, f.score, flags))
      rows.push(row)
    }
    blocks.push({ meta, metaFlags, rows })
  }
  return { blocks, flags: pageFlags }
}

// ─── Đọc một trang ───────────────────────────────────────────────────────────

export const MAX_PASSES = 5

/**
 * Đọc chéo: luôn 2 lần độc lập (ảnh màu + ảnh xám tương phản cao) song song.
 * Còn chỗ lệch thì đọc thêm có trọng tâm (tối đa MAX_PASSES lần) tới khi mọi trường có đa số rõ ràng.
 */
export async function readPage({ client, kind, page, signal, onProgress }) {
  const { prompt, schema, normalize } = KINDS[kind]
  const call = async (variant, text) =>
    normalize(
      await client.generate({
        prompt: text,
        schema,
        imageBase64: await blobToBase64(page.images[variant]),
        mimeType: 'image/jpeg',
        signal,
        onWait: (ms) => onProgress?.({ waitingMs: ms }),
      }),
    )

  let done = 0
  const tick = () => onProgress?.({ passes: ++done })

  onProgress?.({ label: 'Đọc chéo lần 1 + 2' })
  const reads = await Promise.all([call('A', prompt).then((r) => (tick(), r)), call('B', prompt).then((r) => (tick(), r))])

  while (reads.length < MAX_PASSES) {
    const spots = unresolved(reads, kind, { checkWords: reads.length < 3 })
    if (!spots.length) break
    const n = reads.length + 1
    onProgress?.({ label: `Đọc lần ${n} để phân xử ${spots.join('; ')}` })
    reads.push(await call(n % 2 ? 'A' : 'B', focusPrompt(prompt, spots)))
    tick()
  }
  return { passes: reads.length, merged: mergeReads(reads, kind) }
}

// ─── Ghép trang thành tài liệu ──────────────────────────────────────────────

let seq = 0
const uid = (p) => `${p}${++seq}`

/** Nếu Mã HV lệch mã lớp chỉ vì ký tự dễ nhầm (I/1, O/0) thì sửa phần tiền tố theo mã lớp. */
function fixIdPrefix(id, lop) {
  if (!id || !lop || id.startsWith(lop)) return id
  const head = id.slice(0, lop.length)
  return deconfuse(head) === deconfuse(lop) ? lop + id.slice(lop.length) : id
}

/**
 * Bảng điểm hệ thống → danh sách học phần:
 * [{ id, title, lop, columns, rows: [{ id, tt, ma, ho_ten, ngay_sinh, values, flags, fileId, pageNumber, row_y }], issues }]
 */
export function buildSections(files) {
  const sections = []
  for (const file of files) {
    let current = null
    for (const page of file.pages) {
      const m = page.merged
      if (!m) continue
      m.blocks.forEach((block, bi) => {
        const columns = block.meta.columns ? block.meta.columns.split(' | ') : []
        const continues = !block.meta.title && bi === 0 && current
        if (!continues) {
          current = {
            id: uid('sec'),
            fileId: file.id,
            fileName: file.name,
            title: block.meta.title,
            lop: block.meta.lop,
            columns,
            rows: [],
            pageNumbers: [],
            issues: [...m.flags],
          }
          if (!block.meta.title) current.issues.push('Bảng không đọc được tên học phần.')
          if (block.metaFlags.length) current.issues.push(`Các lần đọc chưa thống nhất: ${block.metaFlags.join(', ')}.`)
          sections.push(current)
        } else if (!current.columns.length) {
          current.columns = columns
        }
        if (!current.pageNumbers.includes(page.pageNumber)) current.pageNumbers.push(page.pageNumber)
        for (const r of block.rows) {
          current.rows.push({
            id: uid('sr'),
            tt: r.tt,
            ma: r.ma,
            ho_ten: r.ho_ten,
            ngay_sinh: r.ngay_sinh,
            values: current.columns.map((_, i) => r[`v${i}`] ?? ''),
            flags: r.flags,
            fileId: file.id,
            pageNumber: page.pageNumber,
            row_y: r.row_y,
          })
        }
      })
    }
  }
  for (const s of sections) s.lop = s.lop || classFromRows(s.rows)
  return sections
}

/**
 * Biên bản viết tay → danh sách biên bản:
 * [{ id, header: { tieu_de, lop, mon, bai, … }, footer, rows: [{ id, tt, ma, ho_ten, ngay_sinh, score, absent, … }], issues }]
 */
export function buildSheets(files) {
  const sheets = []
  for (const file of files) {
    let current = null
    for (const page of file.pages) {
      const m = page.merged
      if (!m) continue
      const block = m.blocks[0]
      if (!block) continue
      const meta = block.meta
      if (meta.has_header || (!current && block.rows.length)) {
        current = {
          id: uid('sh'),
          fileId: file.id,
          fileName: file.name,
          header: {
            tieu_de: meta.tieu_de,
            lop: meta.lop,
            mon: meta.mon,
            bai: meta.bai,
            nganh: meta.nganh,
            hoc_ky: meta.hoc_ky,
            khoa: meta.khoa,
            thoi_gian: meta.thoi_gian,
          },
          footer: { so_bai_thi: '', so_hoc_vien: '' },
          rows: [],
          pageNumbers: [],
          issues: [...m.flags],
        }
        if (!meta.has_header) current.issues.push('Trang đầu không có phần đầu biên bản (Lớp, Môn thi).')
        if (block.metaFlags.length) current.issues.push(`Các lần đọc phần đầu chưa thống nhất: ${block.metaFlags.join(', ')}.`)
        sheets.push(current)
      } else if (!block.rows.length) {
        continue
      }
      current.pageNumbers.push(page.pageNumber)
      if (meta.so_bai_thi) current.footer.so_bai_thi = meta.so_bai_thi
      if (meta.so_hoc_vien) current.footer.so_hoc_vien = meta.so_hoc_vien
      for (const r of block.rows) {
        current.rows.push({
          id: uid('hr'),
          tt: r.tt,
          ma: fixIdPrefix(r.ma, current.header.lop),
          ho_ten: r.ho_ten,
          ngay_sinh: r.ngay_sinh,
          score: r.score,
          absent: r.absent,
          digitsRaw: r.digitsRaw,
          wordsRaw: r.wordsRaw,
          wordsValue: r.wordsValue,
          flags: r.flags,
          fileId: file.id,
          pageNumber: page.pageNumber,
          row_y: r.row_y,
        })
      }
    }
  }
  for (const s of sheets) {
    s.classFromIds = classFromRows(s.rows)
    if (!s.header.lop) s.header.lop = s.classFromIds
  }
  return sheets
}
