import { translateWithProvider } from './ai'
import { t } from './i18n'
import { sendTabMessage, type RuntimeMessage, type RuntimeResponse } from './messages'
import { getSettings, saveSettings } from './storage'
import type { TranslateRequest, TranslateResult } from './types'

const CONTEXT_MENU_SELECTION_ID = 'lingyi-translate-selection'
const CONTEXT_MENU_PAGE_ID = 'lingyi-translate-page'
const CONTEXT_MENU_SUMMARY_ID = 'lingyi-summary-page'

async function updateContextMenu() {
  const settings = await getSettings()
  chrome.contextMenus.removeAll(() => {
    if (!settings.contextMenu) return
    chrome.contextMenus.create({
      id: CONTEXT_MENU_SELECTION_ID,
      title: t(settings.uiLanguage, 'contextSelection'),
      contexts: ['selection'],
    })
    chrome.contextMenus.create({
      id: CONTEXT_MENU_PAGE_ID,
      title: t(settings.uiLanguage, 'contextPage'),
      contexts: ['page'],
    })
    chrome.contextMenus.create({
      id: CONTEXT_MENU_SUMMARY_ID,
      title: t(settings.uiLanguage, 'contextSummary'),
      contexts: ['page'],
    })
  })
}

chrome.runtime.onInstalled.addListener(() => {
  void updateContextMenu()
})

chrome.runtime.onStartup.addListener(() => {
  void updateContextMenu()
})

chrome.storage?.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes['lingyi.settings']) void updateContextMenu()
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return
  const tabId = tab.id
  if (info.menuItemId === CONTEXT_MENU_SELECTION_ID && info.selectionText) {
    void sendTabMessage(tabId, {
      type: 'LINGYI_SHOW_TRANSLATION_FOR_TEXT',
      text: info.selectionText,
    }).catch(() => undefined)
    return
  }
  if (info.menuItemId === CONTEXT_MENU_PAGE_ID) {
    void translatePage(tabId).catch(() => undefined)
    return
  }
  if (info.menuItemId === CONTEXT_MENU_SUMMARY_ID) {
    void summarizePageFromContextMenu(tabId).catch(() => undefined)
  }
})

chrome.commands?.onCommand.addListener((command) => {
  void getActiveTabId()
    .then((tabId) => {
      if (!tabId) return undefined
      if (command === 'lingyi-translate-page') return translatePage(tabId)
      if (command === 'lingyi-summary-page') return summarizePageFromContextMenu(tabId)
      return undefined
    })
    .catch(() => undefined)
})

async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab?.id
}

async function translatePage(tabId: number) {
  const settings = await getSettings()
  await sendTabMessage(tabId, {
    type: 'LINGYI_TRANSLATE_VISIBLE_PAGE',
    mode: settings.pageTranslationMode,
    sourceLanguage: settings.sourceLanguage,
    targetLanguage: settings.targetLanguage,
    uiLanguage: settings.uiLanguage,
  })
}

async function summarizePageFromContextMenu(tabId: number) {
  const settings = await getSettings()
  await sendTabMessage(tabId, {
    type: 'LINGYI_SHOW_PAGE_SUMMARY',
    status: 'loading',
  })

  try {
    const text = await sendTabMessage<string>(tabId, { type: 'LINGYI_COLLECT_PAGE_TEXT' })
    const result = await translateWithProvider(settings, normalizeRequest({
      text,
      sourceLanguage: settings.sourceLanguage,
      targetLanguage: settings.targetLanguage,
      mode: 'summary',
    }))
    await sendTabMessage(tabId, {
      type: 'LINGYI_SHOW_PAGE_SUMMARY',
      status: 'success',
      text: result.text,
    })
  } catch (error) {
    await sendTabMessage(tabId, {
      type: 'LINGYI_SHOW_PAGE_SUMMARY',
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined)
  }
}

async function handleMessage(message: RuntimeMessage, sender?: chrome.runtime.MessageSender): Promise<unknown> {
  if (message.type === 'LINGYI_GET_SETTINGS') return getSettings()
  if (message.type === 'LINGYI_SAVE_SETTINGS') return saveSettings(message.settings)
  if (message.type === 'LINGYI_TRANSLATE_TEXT') {
    const settings = await getSettings()
    return translateWithProvider(settings, normalizeRequest(message.request))
  }
  if (message.type === 'LINGYI_SUMMARIZE_PAGE') {
    const tabId = message.tabId ?? sender?.tab?.id
    if (!tabId) {
      const settings = await getSettings()
      throw new Error(t(settings.uiLanguage, 'noActivePage'))
    }
    await summarizePageFromContextMenu(tabId)
    return true
  }
  throw new Error('Unsupported message')
}

function normalizeRequest(request: TranslateRequest): TranslateRequest {
  return {
    ...request,
    text: request.text.slice(0, 12_000),
  }
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  void handleMessage(message, sender)
    .then((data) => sendResponse({ ok: true, data } satisfies RuntimeResponse<TranslateResult | unknown>))
    .catch((error: unknown) => {
      const messageText = error instanceof Error ? error.message : String(error)
      sendResponse({ ok: false, error: messageText } satisfies RuntimeResponse<never>)
    })
  return true
})
