// Responsável por normalizar payloads de mensagem (TipTap/Texto),
// aplicar variáveis e resolver spintax antes do envio.
const VARIABLE_TOKENS = ['nome_do_cliente', 'nome', 'name', 'first_name']
const GREETING_TOKENS = ['saudacao']
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

const formatHumanizedName = (fullName: string): string => {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ''

  const commonCompoundFirstNames = new Set([
    'maria',
    'ana',
    'joao',
    'joão',
    'pedro',
    'carlos',
    'paulo',
    'luiz',
    'luis',
    'jose',
    'josé',
    'julio',
    'júlio'
  ])

  const prepositions = new Set(['da', 'de', 'do'])
  const firstLower = parts[0].toLocaleLowerCase('pt-BR')
  const selectedTokens =
    parts.length > 1 && commonCompoundFirstNames.has(firstLower) ? [parts[0], parts[1]] : [parts[0]]

  return selectedTokens
    .map((token, index) => {
      const lower = token.toLocaleLowerCase('pt-BR')

      if (index > 0 && prepositions.has(lower)) {
        return lower
      }

      const chars = Array.from(lower)
      if (chars.length === 0) {
        return ''
      }

      const [firstChar, ...restChars] = chars
      return `${firstChar.toLocaleUpperCase('pt-BR')}${restChars.join('')}`
    })
    .join(' ')
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

  return formatHumanizedName(sanitized)
}

const getCurrentGreeting = (): string => {
  const hour = new Date().getHours()

  if (hour >= 5 && hour <= 11) {
    return 'Bom dia'
  }

  if (hour >= 12 && hour <= 17) {
    return 'Boa tarde'
  }

  return 'Boa noite'
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

  const safeName = sanitizeName(contactName)
  const fallback = safeName ?? 'cliente'
  const greeting = getCurrentGreeting()
  const nameRegex = new RegExp(`\\{\\{\\s*(${VARIABLE_TOKENS.join('|')})\\s*\\}\\}`, 'gi')
  const greetingRegex = new RegExp(`\\{\\{\\s*(${GREETING_TOKENS.join('|')})\\s*\\}\\}`, 'gi')

  const withName = text.replace(nameRegex, fallback)
  return normalizeWhitespace(withName.replace(greetingRegex, greeting))
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
