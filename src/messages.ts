import type { LingyiSettings, TranslateRequest, TranslateResult, UiLanguage } from './types'

export type PageTranslateMode = 'replace' | 'parallel' | 'summary'

export type RuntimeMessage =
  | { type: 'LINGYI_GET_SETTINGS' }
  | { type: 'LINGYI_SAVE_SETTINGS'; settings: LingyiSettings }
  | { type: 'LINGYI_TRANSLATE_TEXT'; request: TranslateRequest }
  | { type: 'LINGYI_SUMMARIZE_PAGE'; tabId?: number }
  | { type: 'LINGYI_PING_CONTENT' }
  | { type: 'LINGYI_COLLECT_PAGE_TEXT' }
  | { type: 'LINGYI_SHOW_TRANSLATION_FOR_TEXT'; text: string }
  | {
    type: 'LINGYI_SHOW_PAGE_SUMMARY'
    status: 'loading' | 'success' | 'error'
    text?: string
    error?: string
  }
  | {
    type: 'LINGYI_TRANSLATE_VISIBLE_PAGE'
    mode: PageTranslateMode
    sourceLanguage: string
    targetLanguage: string
    uiLanguage?: UiLanguage
  }

export type RuntimeResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

export async function sendRuntimeMessage<T>(message: RuntimeMessage): Promise<T> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
    throw new Error('Chrome runtime is not available in this preview.')
  }
  const response = await chrome.runtime.sendMessage(message) as RuntimeResponse<T>
  if (!response.ok) throw new Error(response.error)
  return response.data
}

export async function sendTabMessage<T>(tabId: number, message: RuntimeMessage): Promise<T> {
  const response = await chrome.tabs.sendMessage(tabId, message) as RuntimeResponse<T>
  if (!response.ok) throw new Error(response.error)
  return response.data
}

export type TranslationPayload = TranslateResult
