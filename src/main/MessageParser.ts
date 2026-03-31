// Responsável por normalizar payloads de mensagem (TipTap/Texto),
// aplicar variáveis e resolver spintax antes do envio.
const VARIABLE_TOKENS = ['nome_do_cliente', 'nome', 'name', 'first_name']
const INVALID_NAME_VALUES = new Set([
  '',
  '-',
  '--',
  'null',
  'undefined',
  'n/a',
  'na',
  'none',
  'sem nome',
  'desconhecido',
  'unknown'
])

const normalizeWhitespace = (value: string): string => {
  return value
    .replace(/[\t ]+/g, ' ')
    .replace(/\s+([,.;!?])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const sanitizeName = (contactName: string | null | undefined): string | null => {
  if (typeof contactName !== 'string') {
    return null
  }

  const sanitized = contactName.replace(/\s+/g, ' ').trim()
  if (!sanitized) {
    return null
  }

  const normalized = sanitized.toLowerCase()
  if (INVALID_NAME_VALUES.has(normalized)) {
    return null
  }

  if (/^\d+$/.test(sanitized)) {
    return null
  }

  return sanitized
}

const parseNode = (node: any): string => {
  if (!node || typeof node !== 'object') {
    return ''
  }

  if (node.type === 'text') {
    return typeof node.text === 'string' ? node.text : ''
  }

  if (node.type === 'hardBreak') {
    return '\n'
  }

  if (node.type === 'variable') {
    const variableName = typeof node.attrs?.name === 'string' ? node.attrs.name : 'nome_do_cliente'
    return `{{${variableName}}}`
  }

  if (node.type === 'spintax') {
    const options = Array.isArray(node.attrs?.options)
      ? node.attrs.options
          .map((option: unknown) => (typeof option === 'string' ? option.trim() : ''))
          .filter(Boolean)
      : []

    return options.length > 0 ? `{${options.join('|')}}` : ''
  }

  const children = Array.isArray(node.content) ? node.content.map(parseNode).join('') : ''

  if (node.type === 'paragraph') {
    return `${children}\n`
  }

  return children
}

export const parseTipTapToText = (doc: any): string => {
  if (!doc) {
    return ''
  }

  if (typeof doc === 'string') {
    return normalizeWhitespace(doc)
  }

  const rawText = parseNode(doc)
  return normalizeWhitespace(rawText)
}

export const applySpintax = (text: string): string => {
  if (!text) {
    return ''
  }

  let output = text.replace(/\{spin:([^{}]+)\}/gi, '{$1}')
  const spintaxRegex = /\{([^{}]*\|[^{}]*)\}/g

  let guard = 0
  while (guard < 10 && spintaxRegex.test(output)) {
    output = output.replace(spintaxRegex, (_match, group: string) => {
      const options = group
        .split('|')
        .map((option) => option.trim())
        .filter(Boolean)

      if (options.length === 0) {
        return ''
      }

      const randomIndex = Math.floor(Math.random() * options.length)
      return options[randomIndex]
    })

    guard += 1
  }

  return normalizeWhitespace(output)
}

export const applyVariables = (text: string, contactName: string): string => {
  if (!text) {
    return ''
  }

  // Fallback inteligente para evitar mensagens quebradas quando o nome não existe.
  const safeName = sanitizeName(contactName)
  const fallback = safeName ?? 'cliente'
  const variableRegex = new RegExp(`\\{\\{\\s*(${VARIABLE_TOKENS.join('|')})\\s*\\}\\}`, 'gi')

  return normalizeWhitespace(text.replace(variableRegex, fallback))
}

export const parseMessagePayload = (payload: unknown): string => {
  if (typeof payload === 'string') {
    return normalizeWhitespace(payload)
  }

  if (!payload || typeof payload !== 'object') {
    return ''
  }

  const maybePayload = payload as { doc?: unknown; text?: unknown }

  if (typeof maybePayload.text === 'string' && maybePayload.text.trim().length > 0) {
    return normalizeWhitespace(maybePayload.text)
  }

  if (maybePayload.doc) {
    return parseTipTapToText(maybePayload.doc)
  }

  return parseTipTapToText(payload)
}

export const compileMessageForContact = (payload: unknown, contactName: string): string => {
  const parsedText = parseMessagePayload(payload)
  const withVariables = applyVariables(parsedText, contactName)
  return applySpintax(withVariables)
}
