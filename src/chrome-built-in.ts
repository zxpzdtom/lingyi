import { t } from './i18n'
import type { TranslateRequest, TranslateResult } from './types'

export const CHROME_BUILT_IN_AI_PREPARE_TIMEOUT_MS = 10 * 60_000
const CHROME_BUILT_IN_AI_REQUEST_TIMEOUT_MS = 180_000

export interface ChromeBuiltInAiProgress {
  availability: ChromeAiAvailability
  percent?: number
}

export function isChromeBuiltInProvider(provider: string | undefined) {
  return provider === 'chromeBuiltIn'
}

export function formatChromeAiAvailability(availability: ChromeAiAvailability, uiLanguage?: TranslateRequest['uiLanguage']) {
  if (availability === 'available') return t(uiLanguage, 'chromeAvailable')
  if (availability === 'downloadable') return t(uiLanguage, 'chromeDownloadable')
  if (availability === 'downloading') return t(uiLanguage, 'chromeDownloading')
  return t(uiLanguage, 'chromeUnavailable')
}

export async function prepareChromeBuiltInAi(onProgress?: (progress: ChromeBuiltInAiProgress) => void, uiLanguage?: TranslateRequest['uiLanguage']): Promise<void> {
  if (typeof LanguageModel === 'undefined') {
    throw new Error(t(uiLanguage, 'chromePromptApiUnavailable'))
  }

  const availability = await LanguageModel.availability()
  onProgress?.({ availability })
  if (availability === 'unavailable') {
    throw new Error(t(uiLanguage, 'chromeUnavailable'))
  }
  if (availability === 'available') return

  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), CHROME_BUILT_IN_AI_PREPARE_TIMEOUT_MS)
  let session: ChromeAiLanguageModelSession | undefined

  try {
    session = await LanguageModel.create({
      signal: controller.signal,
      monitor(monitor) {
        monitor.addEventListener('downloadprogress', (event) => {
          const loaded = typeof (event as ProgressEvent).loaded === 'number' ? (event as ProgressEvent).loaded : undefined
          const percent = loaded === undefined ? undefined : Math.max(0, Math.min(100, Math.round(loaded * 100)))
          onProgress?.({ availability: 'downloading', percent })
        })
      },
    })
    onProgress?.({ availability: 'available', percent: 100 })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(t(uiLanguage, 'chromeDownloadTimeout'), { cause: error })
    }
    throw error
  } finally {
    session?.destroy()
    globalThis.clearTimeout(timeout)
  }
}

function compactText(value: string) {
  return value.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim()
}

function fillPromptTemplate(template: string, request: TranslateRequest) {
  return template
    .replaceAll('{{targetLanguage}}', request.targetLanguage)
    .replaceAll('{{sourceLanguage}}', 'the detected source language')
}

function buildPromptMessages(request: TranslateRequest): ChromeAiPromptMessage[] {
  const intent = request.mode === 'summary'
    ? fillPromptTemplate(request.summaryPrompt || `Summarize the content in ${request.targetLanguage}. Keep it concise and useful.`, request)
    : fillPromptTemplate(request.translatePrompt || `Translate the content into ${request.targetLanguage}. Detect the source language automatically.`, request)

  return [
    {
      role: 'system',
      content: [
        intent,
        `The output language must be ${request.targetLanguage}.`,
        'Return only the transformed content. Do not repeat these instructions.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: compactText(request.text),
    },
  ]
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

export async function translateWithChromeBuiltIn(request: TranslateRequest): Promise<TranslateResult> {
  if (typeof LanguageModel === 'undefined') {
    throw new Error(t(request.uiLanguage, 'chromeUseCloudFallback'))
  }

  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), CHROME_BUILT_IN_AI_REQUEST_TIMEOUT_MS)
  let session: ChromeAiLanguageModelSession | undefined

  try {
    const availability = await LanguageModel.availability()
    if (availability !== 'available') {
      throw new Error(t(request.uiLanguage, 'chromePrepareFirst', { status: formatChromeAiAvailability(availability, request.uiLanguage) }))
    }
    session = await LanguageModel.create({
      signal: controller.signal,
    })
    const text = await session.prompt(buildPromptMessages(request), { signal: controller.signal })
    const result = stripPromptEcho(text)
    if (!result) throw new Error(t(request.uiLanguage, 'chromeEmptyResult'))
    return {
      text: result,
      provider: 'chromeBuiltIn',
      model: 'chrome-built-in',
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(t(request.uiLanguage, 'chromeRequestTimeout'), { cause: error })
    }
    throw error
  } finally {
    session?.destroy()
    globalThis.clearTimeout(timeout)
  }
}
