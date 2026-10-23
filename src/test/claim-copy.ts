import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { render } from '@testing-library/react'
import ts from 'typescript'

// Text-node whitespace is rendered inside a block. Only the boundaries we
// insert for elements may become matcher clause boundaries: a JSX {"\n"}
// must read as a space, rather than hiding the rest of a sentence.
const SPACE = /[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+/gu
const BLOCK_TAGS = new Set([
  'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'DIV', 'TD', 'TH', 'DD', 'DT',
  'BUTTON', 'CAPTION', 'FIGCAPTION', 'PRE', 'SECTION', 'ARTICLE', 'BLOCKQUOTE',
  'HEADER', 'FOOTER', 'FIGURE', 'SUMMARY', 'LABEL', 'NAV', 'MAIN', 'ASIDE',
  'UL', 'OL', 'TABLE', 'TR', 'BR', 'HR',
])
const OMIT_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE'])
const TEXT_ATTRIBUTES = ['aria-label', 'aria-description', 'alt', 'title', 'placeholder']
type CopyToken = string | null

function blockText(tokens: CopyToken[]): string {
  const blocks: string[] = []
  let inline: string[] = []
  const flush = () => {
    const text = inline.join('').replace(SPACE, ' ').trim()
    if (text) blocks.push(text)
    inline = []
  }
  for (const token of tokens) {
    if (token === null) flush()
    else inline.push(token)
  }
  flush()
  return blocks.join('\n')
}

/** Visible DOM text, with structural boundaries kept separate from whitespace
 * inside text nodes. Table cells are separate blocks, as are accessible names. */
export function renderedText(root: Node): string {
  const tokens: CopyToken[] = []
  const attributes: string[] = []
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) tokens.push(node.textContent ?? '')
    else if (node instanceof Element) {
      if (OMIT_TAGS.has(node.tagName)) return
      for (const name of TEXT_ATTRIBUTES) {
        const value = node.getAttribute(name)
        if (value) attributes.push(value.replace(SPACE, ' ').trim())
      }
      const block = BLOCK_TAGS.has(node.tagName)
      if (block) tokens.push(null)
      node.childNodes.forEach(walk)
      if (block) tokens.push(null)
    } else if (node.nodeType === Node.DOCUMENT_NODE || node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
      node.childNodes.forEach(walk)
    }
  }
  walk(root)
  return [blockText(tokens), ...attributes].filter(Boolean).join('\n')
}

export function pageText(renderSurface: () => ReturnType<typeof render>): string {
  const { container, unmount } = renderSurface()
  try {
    return renderedText(container)
  } finally {
    unmount()
  }
}

// Let the HTML parser decode its entire entity set, including decimal/hex
// references. A hand-maintained named-entity list misses visible words.
function decodeEntities(text: string): string {
  if (!text.includes('&')) return text
  const element = document.createElement('textarea')
  element.innerHTML = text
  return element.value
}

/** HTML owned by this website, including the PDF print source and embedded
 * public papers. DOM parsing also handles unquoted/single-quoted attributes. */
export function htmlCopy(html: string): string {
  return renderedText(new DOMParser().parseFromString(html, 'text/html'))
}
export const htmlText = htmlCopy

/** Every string in an exported copy object, including nested audience panels. */
export function stringsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(stringsIn)
  if (value && typeof value === 'object') return Object.values(value).flatMap(stringsIn)
  return []
}

type StaticValue = string | number | boolean | null | undefined
type KnownValue = { value: StaticValue }

/** Statically readable page copy; this never evaluates source code. JSX child
 * literals belong to their containing JSX sentence, rather than becoming
 * standalone assertions with their surrounding negation removed. */
export function sourceCopy(path: string, source: string): string[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const copy: string[] = []
  const valueOf = (node: ts.Node): KnownValue | undefined => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return { value: node.text }
    if (ts.isNumericLiteral(node)) return { value: Number(node.text) }
    if (node.kind === ts.SyntaxKind.TrueKeyword) return { value: true }
    if (node.kind === ts.SyntaxKind.FalseKeyword) return { value: false }
    if (node.kind === ts.SyntaxKind.NullKeyword) return { value: null }
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return valueOf(node.expression)
    if (ts.isTemplateExpression(node)) {
      const values = node.templateSpans.map((span) => valueOf(span.expression))
      if (values.some((value) => value === undefined)) return undefined
      return { value: node.head.text + node.templateSpans.map((span, index) => String(values[index]!.value) + span.literal.text).join('') }
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = valueOf(node.left)
      const right = valueOf(node.right)
      if (!left || !right) return undefined
      if (typeof left.value === 'string' || typeof right.value === 'string') return { value: String(left.value) + String(right.value) }
      if (typeof left.value === 'number' && typeof right.value === 'number') return { value: left.value + right.value }
    }
    return undefined
  }
  const literal = (node: ts.Node): string | null => {
    const known = valueOf(node)
    if (known && typeof known.value === 'string') return known.value
    // Keep readable parts of dynamic templates/concatenations as the old
    // backstop did, while resolving any interpolation that is static.
    if (ts.isTemplateExpression(node)) {
      return node.head.text + node.templateSpans.map((span) => {
        const value = valueOf(span.expression)
        return (value ? String(value.value) : ' ') + span.literal.text
      }).join('')
    }
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return literal(node.expression)
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = literal(node.left)
      const right = literal(node.right)
      return left === null && right === null ? null : (left ?? ' ') + (right ?? ' ')
    }
    return null
  }
  const tagName = (node: ts.JsxElement | ts.JsxSelfClosingElement) =>
    (ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName).getText(file).toUpperCase()
  // Read each dynamic branch/callback with the static JSX around it. Keeping
  // the alternatives also preserves the old sweep's callback-string coverage
  // without treating a child literal as a sentence on its own. Vary one child
  // at a time to avoid multiplying unrelated conditional branches.
  const combine = (children: CopyToken[][][]): CopyToken[][] => {
    const base = children.flatMap((variants) => variants[0] ?? [])
    return [base, ...children.flatMap((variants, index) => variants.slice(1).map((variant) =>
      children.flatMap((other, otherIndex) => otherIndex === index ? variant : other[0] ?? []),
    ))]
  }
  const expressionTokens = (node: ts.Node): CopyToken[][] => {
    const known = valueOf(node)
    if (known) return [[typeof known.value === 'string' || typeof known.value === 'number' ? String(known.value) : '']]
    const text = literal(node)
    if (text !== null) return [[text]]
    if (ts.isJsxElement(node) || ts.isJsxFragment(node) || ts.isJsxSelfClosingElement(node)) return jsxTokens(node)
    if (ts.isConditionalExpression(node)) return [...expressionTokens(node.whenTrue), ...expressionTokens(node.whenFalse)]
    const candidates: CopyToken[][] = []
    node.forEachChild((child) => {
      if (ts.isJsxElement(child) || ts.isJsxFragment(child) || ts.isJsxSelfClosingElement(child) || literal(child) !== null) {
        candidates.push(...expressionTokens(child))
      } else {
        const nested = expressionTokens(child)
        if (nested.some((tokens) => tokens.some((token) => token !== null && token.trim()))) candidates.push(...nested)
      }
    })
    return candidates.length ? candidates : [[' ']]
  }
  const jsxTokens = (node: ts.JsxChild | ts.JsxElement | ts.JsxFragment): CopyToken[][] => {
    if (ts.isJsxText(node)) return [[decodeEntities(node.text)]]
    if (ts.isJsxExpression(node)) {
      return node.expression ? expressionTokens(node.expression) : [[]]
    }
    if (ts.isJsxSelfClosingElement(node)) return [BLOCK_TAGS.has(tagName(node)) ? [null] : [' ']]
    const inner = combine(node.children.map(jsxTokens))
    if (ts.isJsxFragment(node)) return inner
    if (OMIT_TAGS.has(tagName(node))) return [[]]
    return BLOCK_TAGS.has(tagName(node)) ? inner.map((tokens) => [null, ...tokens, null]) : inner
  }
  const visit = (node: ts.Node, inJsx: boolean) => {
    if (ts.isJsxElement(node) || ts.isJsxFragment(node) || ts.isJsxSelfClosingElement(node)) {
      if (!inJsx) {
        const texts = new Set(jsxTokens(node).map(blockText).filter(Boolean))
        copy.push(...texts)
      }
      node.forEachChild((child) => visit(child, true))
      return
    }
    if (ts.isJsxAttribute(node)) {
      if (node.initializer) {
        // Attributes are independent copy contexts. Preserve custom component
        // string props too: they may become visible when the component renders.
        const value = ts.isStringLiteral(node.initializer)
          ? decodeEntities(node.initializer.text)
          : ts.isJsxExpression(node.initializer) && node.initializer.expression && literal(node.initializer.expression)
        if (value) copy.push(value.replace(SPACE, ' '))
        else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) visit(node.initializer.expression, false)
      }
      return
    }
    if (ts.isJsxSpreadAttribute(node)) {
      visit(node.expression, false)
      return
    }
    if (!inJsx) {
      const text = literal(node)
      if (text !== null) {
        copy.push(text)
        return
      }
    }
    node.forEachChild((child) => visit(child, inJsx))
  }
  visit(file, false)
  return copy
}

/** Source backstop, excluding tests and the fixture directory. */
export function copyFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'test' ? [] : copyFiles(path)
    return /\.(tsx?|mdx?|json)$/.test(entry.name) && !/\.(test|spec)\.tsx?$|\.d\.ts$/.test(entry.name) ? [path] : []
  })
}

/** Website-owned HTML can be visible through iframes even when no selected
 * React surface renders it in jsdom. Runtime Ghost posts remain outside this
 * build-time sweep because their content is not committed in this repository. */
export function publicHtmlFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return publicHtmlFiles(path)
    return /\.html?$/i.test(entry.name) ? [path] : []
  })
}

export function fileCopy(path: string): string[] {
  const source = readFileSync(path, 'utf8')
  if (path.endsWith('.json')) return stringsIn(JSON.parse(source))
  if (/\.mdx?$/.test(path)) return [source]
  if (/\.html?$/i.test(path)) return [htmlCopy(source)]
  return sourceCopy(path, source)
}
export const copyOf = fileCopy
