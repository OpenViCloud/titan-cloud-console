import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// Every word the portal shows comes from src/i18n (docs/features/customer-portal/design.md#portal-language),
// so it reads in the language the user picked. This scan finds text written straight into a component:
// JSX text, the text attributes below, toast messages, and label/title fields of object literals.
// It does not see text built elsewhere and passed in as a variable, or text inside lib/*.ts.
const TEXT_ATTRIBUTES = new Set(['title', 'placeholder', 'aria-label', 'alt', 'label', 'description'])
const TEXT_PROPERTIES = new Set(['label', 'title', 'description'])

// Text that is the same in both languages, each with its reason.
const SAME_IN_BOTH: Record<string, string> = {
  OpenViCloud: 'brand',
  TCP: 'protocol name',
  UDP: 'protocol name',
  ICMP: 'protocol name',
  Ingress: 'firewall direction, a technical term',
  Egress: 'firewall direction, a technical term',
  GB: 'unit',
  'incus config trust add-certificate titan.crt': 'the command an operator types on the cluster',
  'https://host:8443': 'an example address',
}

// Every component file. Skipped: shadcn primitives (no copy of their own), test helpers.
const SKIPPED = /^\/src\/(components\/ui|test)\//

const sources = import.meta.glob<string>(
  ['/src/**/*.tsx', '!/src/**/*.test.tsx', '!/src/components/ui/**', '!/src/test/**'],
  { query: '?raw', import: 'default', eager: true },
)

function hasWords(text: string): boolean {
  return /\p{L}{2,}/u.test(text)
}

function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text
  }
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.map(span => span.literal.text)].join(' ')
  }
  return null
}

// String literals that end up as the value: a literal itself, or either branch of a ternary.
function literalsIn(node: ts.Node): string[] {
  if (ts.isParenthesizedExpression(node)) {
    return literalsIn(node.expression)
  }
  if (ts.isConditionalExpression(node)) {
    return [...literalsIn(node.whenTrue), ...literalsIn(node.whenFalse)]
  }
  const valueOperators = [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandToken]
  if (ts.isBinaryExpression(node) && valueOperators.includes(node.operatorToken.kind)) {
    return literalsIn(node.right)
  }
  const text = literalText(node)
  if (text === null) {
    return []
  }
  return [text]
}

function isAllowed(text: string): boolean {
  if (Object.prototype.hasOwnProperty.call(SAME_IN_BOTH, text.trim())) {
    return true
  }
  const words = text.match(/\p{L}+/gu)
  if (words === null) {
    return true
  }
  return words.every(word => Object.prototype.hasOwnProperty.call(SAME_IN_BOTH, word))
}

export function findLiteralCopy(fileName: string, source: string): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const hits: string[] = []

  function report(node: ts.Node, kind: string, text: string) {
    if (!hasWords(text) || isAllowed(text)) {
      return
    }
    const line = file.getLineAndCharacterOfPosition(node.getStart()).line + 1
    hits.push(`${fileName}:${line} ${kind}: ${text.trim().replace(/\s+/g, ' ')}`)
  }

  function visit(node: ts.Node) {
    if (ts.isJsxText(node)) {
      report(node, 'jsx text', node.text)
    } else if (ts.isJsxExpression(node) && node.expression !== undefined && !ts.isJsxAttribute(node.parent)) {
      for (const text of literalsIn(node.expression)) {
        report(node, 'jsx expression', text)
      }
    } else if (ts.isJsxAttribute(node) && TEXT_ATTRIBUTES.has(node.name.getText(file)) && node.initializer !== undefined) {
      const value = ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer
      if (value !== undefined) {
        for (const text of literalsIn(value)) {
          report(node, `attribute ${node.name.getText(file)}`, text)
        }
      }
    } else if (ts.isCallExpression(node) && node.expression.getText(file).startsWith('toast')) {
      for (const argument of node.arguments) {
        for (const text of literalsIn(argument)) {
          report(node, 'toast', text)
        }
      }
    } else if (ts.isPropertyAssignment(node) && TEXT_PROPERTIES.has(node.name.getText(file))) {
      for (const text of literalsIn(node.initializer)) {
        report(node, `property ${node.name.getText(file)}`, text)
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(file)
  return hits
}

// An independent count of the same files, so a glob that silently matches nothing cannot pass.
function countOnDisk(dir: string, relative: string): number {
  let count = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = `${relative}/${entry.name}`
    if (entry.isDirectory()) {
      count += countOnDisk(join(dir, entry.name), rel)
    } else if (rel.endsWith('.tsx') && !rel.endsWith('.test.tsx') && !SKIPPED.test(rel)) {
      count += 1
    }
  }
  return count
}

describe('no literal copy in components', () => {
  it('scans every component file', () => {
    const onDisk = countOnDisk(join(process.cwd(), 'src'), '/src')
    expect(onDisk).toBeGreaterThan(30)
    expect(Object.keys(sources).length).toBe(onDisk)
  })

  it('finds planted text of every kind (the scan can fail)', () => {
    const planted = [
      'export function X({ ok }: { ok: boolean }) {',
      '  toast.success(`Deleted ${name}`)',
      '  const items = [{ label: "Overview" }]',
      '  return <div title="Hello there" aria-label={ok ? "Yes sir" : "No sir"}>Create VM {ok && "Ready now"} OpenViCloud</div>',
      '}',
    ].join('\n')
    expect(findLiteralCopy('/src/x.tsx', planted)).toEqual([
      '/src/x.tsx:2 toast: Deleted',
      '/src/x.tsx:3 property label: Overview',
      '/src/x.tsx:4 attribute title: Hello there',
      '/src/x.tsx:4 attribute aria-label: Yes sir',
      '/src/x.tsx:4 attribute aria-label: No sir',
      '/src/x.tsx:4 jsx text: Create VM',
      '/src/x.tsx:4 jsx expression: Ready now',
    ])
  })

  it('finds none in the portal', () => {
    const hits = Object.entries(sources).flatMap(([path, text]) => findLiteralCopy(path, text))
    expect(hits).toEqual([])
  })
})
