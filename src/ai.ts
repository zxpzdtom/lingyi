import { generateText } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { isChromeBuiltInProvider, translateWithChromeBuiltIn } from './chrome-built-in'
import { t } from './i18n'
import type { LingyiSettings, TranslateRequest, TranslateResult } from './types'

const REQUEST_TIMEOUT_MS = 60_000

function compactText(value: string) {
  return value.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim()
}

function providerHeaders(settings: LingyiSettings): Record<string, string> | undefined {
  if (settings.provider !== 'openrouter') return undefined
  return {
    'HTTP-Referer': 'https://lingyi.local',
    'X-OpenRouter-Title': 'Lingyi',
  }
}

function assertReady(settings: LingyiSettings) {
  if (!settings.apiKey.trim()) throw new Error(t(settings.uiLanguage, 'apiKeyRequired'))
  if (!settings.baseUrl.trim()) throw new Error(t(settings.uiLanguage, 'baseUrlRequired'))
  if (!settings.model.trim()) throw new Error(t(settings.uiLanguage, 'modelRequired'))
}

function fillPromptTemplate(template: string, request: TranslateRequest) {
  return template
    .replaceAll('{{targetLanguage}}', request.targetLanguage)
    .replaceAll('{{sourceLanguage}}', 'the detected source language')
}

function buildPrompt(request: TranslateRequest, settings: LingyiSettings) {
  const intent = request.mode === 'summary'
    ? fillPromptTemplate(settings.summaryPrompt, request)
    : fillPromptTemplate(settings.translatePrompt, request)

  return [
    intent,
    `The output language must be ${request.targetLanguage}.`,
    'Return only the transformed content. Do not repeat these instructions.',
    '',
    'Content:',
    compactText(request.text),
  ].filter(Boolean).join('\n')
}

function stripPromptEcho(value: string) {
  const result = compactText(value)
  const promptLike = [
    'The output language must be',
    'Return only the transformed content',
    'Return only the final user-facing translation',
    '只返回最终给用户看的译文',
    '自动识别源语言',
    '将内容翻译成',
    'Translate the content into',
    'Detect the source language automatically',
  ].some((marker) => result.includes(marker))

  if (!promptLike) return result

  const contentMarkers = ['\nContent:\n', '\nContent:', 'Content:', '内容：', '内容:']
  for (const marker of contentMarkers) {
    const index = result.lastIndexOf(marker)
    if (index === -1) continue
    const candidate = compactText(result.slice(index + marker.length))
    if (candidate) return candidate
  }

  return result
}

export async function translateWithProvider(settings: LingyiSettings, request: TranslateRequest): Promise<TranslateResult> {
  if (isChromeBuiltInProvider(settings.provider)) {
    return translateWithChromeBuiltIn({
      ...request,
      uiLanguage: settings.uiLanguage,
      translatePrompt: settings.translatePrompt,
      summaryPrompt: settings.summaryPrompt,
    })
  }

  assertReady(settings)

  const provider = createOpenAICompatible({
    name: `lingyi-${settings.provider}`,
    baseURL: settings.baseUrl.trim().replace(/\/+$/, ''),
    apiKey: settings.apiKey.trim(),
    headers: providerHeaders(settings),
  })

  const { text } = await generateText({
    model: provider.chatModel(settings.model.trim()),
    temperature: 0.2,
    prompt: buildPrompt(request, settings),
    timeout: REQUEST_TIMEOUT_MS,
  })

  const result = stripPromptEcho(text)
  if (!result) throw new Error(t(settings.uiLanguage, 'emptyModelResult'))

  return {
    text: result,
    provider: settings.provider,
    model: settings.model.trim(),
  }
}

export function demoTranslate(request: TranslateRequest): TranslateResult {
  const text = request.mode === 'summary'
    ? '这段内容说明深海微生物可以依靠化学反应获取能量，不依赖阳光，因此拓展了人类对生命存在条件的理解。'
    : request.targetLanguage === '中文'
    ? '它们从热液喷口附近的化学反应中获取能量。'
    : 'They harvest energy from chemical reactions near hydrothermal vents.'

  return {
    text,
    provider: 'openai',
    model: 'demo',
  }
}
