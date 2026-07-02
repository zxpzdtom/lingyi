import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createRoot } from 'react-dom/client'
import { Streamdown } from 'streamdown'
import { t } from './i18n'
import { sendRuntimeMessage, type PageTranslateMode, type RuntimeMessage, type RuntimeResponse } from './messages'
import { getSettings } from './storage'
import { themeVars } from './theme'
import type { TranslateResult, UiLanguage } from './types'

type BubbleState = {
  visible: boolean
  phase: 'trigger' | 'card'
  anchorX: number
  anchorY: number
  anchorWidth: number
  anchorHeight: number
  text: string
  result: string
  loading: boolean
  error: string
  themeStyle: CSSProperties
  targetLanguage: string
  uiLanguage: UiLanguage
  isLocal: boolean
}

type PageHudState = {
  visible: boolean
  active: boolean
  label: string
  done: number
  total: number
  failed: number
  uiLanguage: UiLanguage
}

type PageSummaryState = {
  visible: boolean
  loading: boolean
  error: string
  text: string
  themeStyle: CSSProperties
  uiLanguage: UiLanguage
}

let lastRange: Range | null = null
const SELECTION_POPOVER_CLOSE_MS = 280
const AUTO_SUMMARY_DELAY_MS = 1400
const lingyiGlobal = globalThis as typeof globalThis & {
  __lingyiRuntimeListenerInstalled?: boolean
  __lingyiShowTranslationForText?: (text: string) => void
  __lingyiSetPageHud?: (state: PageHudState) => void
  __lingyiShowPageSummary?: (state: { status: 'loading' | 'success' | 'error'; text?: string; error?: string }) => void
}
const autoSummarizedUrls = new Set<string>()

const initialState: BubbleState = {
  visible: false,
  phase: 'trigger',
  anchorX: 24,
  anchorY: 24,
  anchorWidth: 1,
  anchorHeight: 1,
  text: '',
  result: '',
  loading: false,
  error: '',
  themeStyle: themeVars('lucid'),
  targetLanguage: '中文',
  uiLanguage: 'zh-CN',
  isLocal: true,
}

const initialSummaryState: PageSummaryState = {
  visible: false,
  loading: false,
  error: '',
  text: '',
  themeStyle: themeVars('lucid'),
  uiLanguage: 'zh-CN',
}

function collectPageText() {
  const title = document.title.trim()
  const text = document.body?.innerText?.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() ?? ''
  return [title, text].filter(Boolean).join('\n\n').slice(0, 12_000)
}

function isLingyiInteraction(event: Event) {
  return event.composedPath().some((node) => node instanceof HTMLElement && node.id === 'lingyi-root')
}

function getAppIconUrl() {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) return chrome.runtime.getURL('icons/icon-32.png')
  return '/icons/icon-32.png'
}

function getRangeAnchorRect(range: Range) {
  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 || rect.height > 0)
  const bounds = range.getBoundingClientRect()
  const first = rects[0] ?? bounds
  const anchorLeft = bounds.width || bounds.height ? bounds.left : first.left
  const anchorTop = bounds.width || bounds.height ? bounds.top : first.top
  return {
    anchorLeft,
    anchorTop,
    width: bounds.width || first.width,
    height: bounds.height || first.height,
  }
}

function getRangeAnchorState(range: Range) {
  const rect = getRangeAnchorRect(range)
  if (!rect.width && !rect.height) return null
  return {
    anchorX: rect.anchorLeft,
    anchorY: rect.anchorTop,
    anchorWidth: Math.max(1, rect.width),
    anchorHeight: Math.max(1, rect.height),
  }
}

const SELECTION_REPLACE_BLOCK_SELECTOR = 'p, li, blockquote, figcaption, td, th, h1, h2, h3, h4, h5, h6'

type TranslationResultBlock =
  | { kind: 'heading' | 'paragraph'; text: string }
  | { kind: 'list'; items: string[] }

function getRangeRootElement(range: Range) {
  const root = range.commonAncestorContainer
  if (root.nodeType === Node.ELEMENT_NODE) return root as Element
  return root.parentElement
}

function safelyIntersects(range: Range, element: Element) {
  try {
    return range.intersectsNode(element)
  } catch {
    return false
  }
}

function getSelectedReplacementBlocks(range: Range) {
  const root = getRangeRootElement(range)
  if (!root) return []
  const candidates = [
    ...(root.matches(SELECTION_REPLACE_BLOCK_SELECTOR) ? [root] : []),
    ...Array.from(root.querySelectorAll(SELECTION_REPLACE_BLOCK_SELECTOR)),
  ]
  return candidates.filter((element) => (
    safelyIntersects(range, element)
    && Boolean(element.textContent?.trim())
  ))
}

function splitReplacementLines(text: string) {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function splitSentences(text: string) {
  return text
    .match(/[^。！？!?]+[。！？!?]?/g)
    ?.map((sentence) => sentence.trim())
    .filter(Boolean) ?? []
}

function stripListPrefix(text: string) {
  return text.replace(/^([-*•]|\d+[.)])\s+/, '')
}

function isListLine(text: string) {
  return /^([-*•]|\d+[.)])\s+/.test(text)
}

function isHeadingLikeLine(text: string) {
  const clean = stripListPrefix(text).trim()
  return clean.length > 0 && clean.length <= 48 && !/[。！？!?；;。.]$/.test(clean)
}

function rangeContainsListItem(range: Range | null) {
  if (!range) return false
  const root = getRangeRootElement(range)
  if (!root) return false
  const items = [
    ...(root.matches('li') ? [root] : []),
    ...Array.from(root.querySelectorAll('li')),
  ]
  return items.some((item) => safelyIntersects(range, item))
}

function splitSingleLineResultBySource(sourceText: string, resultText: string) {
  const sourceLines = splitReplacementLines(sourceText)
  const resultLines = splitReplacementLines(resultText)
  if (sourceLines.length <= 1 || resultLines.length !== 1) return resultLines

  const resultLine = resultLines[0]
  const firstSourceLooksLikeHeading = isHeadingLikeLine(sourceLines[0])
  if (firstSourceLooksLikeHeading) {
    const firstSpace = resultLine.indexOf(' ')
    if (firstSpace > 0 && firstSpace <= 14) {
      const heading = resultLine.slice(0, firstSpace).trim()
      const rest = resultLine.slice(firstSpace + 1).trim()
      const restSentences = splitSentences(rest)
      if (heading && restSentences.length >= Math.max(2, sourceLines.length - 1)) {
        return [heading, ...restSentences]
      }
    }
  }

  const sentences = splitSentences(resultLine)
  return sentences.length > 1 ? sentences : resultLines
}

function getReplacementLines(sourceText: string, resultText: string) {
  const resultLines = splitReplacementLines(resultText)
  if (resultLines.length > 1) return resultLines
  return splitSingleLineResultBySource(sourceText, resultText)
}

function buildTranslationResultBlocks(sourceText: string, resultText: string, sourceRange: Range | null): TranslationResultBlock[] {
  const sourceLines = splitReplacementLines(sourceText)
  const lines = getReplacementLines(sourceText, resultText)
  if (!lines.length) return []

  const firstSourceLooksLikeHeading = sourceLines.length > 1 && isHeadingLikeLine(sourceLines[0])
  const sourceLooksLikeList = sourceLines.some(isListLine) || rangeContainsListItem(sourceRange)
  const blocks: TranslationResultBlock[] = []
  let index = 0

  if (firstSourceLooksLikeHeading && lines.length > 1) {
    blocks.push({ kind: 'heading', text: stripListPrefix(lines[0]) })
    index = 1
  }

  const rest = lines.slice(index).map(stripListPrefix)
  if (sourceLooksLikeList && rest.length > 1) {
    blocks.push({ kind: 'list', items: rest })
    return blocks
  }

  rest.forEach((line) => {
    blocks.push({ kind: 'paragraph', text: stripListPrefix(line) })
  })
  return blocks
}

function createTextFragmentWithBreaks(text: string) {
  const fragment = document.createDocumentFragment()
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  lines.forEach((line, index) => {
    if (index > 0) fragment.append(document.createElement('br'))
    if (line) fragment.append(document.createTextNode(line))
  })
  if (!fragment.childNodes.length) fragment.append(document.createTextNode(text))
  return fragment
}

function replaceRangeWithText(range: Range, text: string) {
  const fragment = createTextFragmentWithBreaks(text)
  const lastNode = fragment.lastChild
  range.deleteContents()
  range.insertNode(fragment)
  if (!lastNode) return
  const selection = window.getSelection()
  const afterInserted = document.createRange()
  afterInserted.setStartAfter(lastNode)
  afterInserted.collapse(true)
  selection?.removeAllRanges()
  selection?.addRange(afterInserted)
}

function replaceSelectedBlocks(range: Range, sourceText: string, text: string) {
  const blocks = getSelectedReplacementBlocks(range)
  const sourceLines = splitReplacementLines(sourceText)
  const lines = getReplacementLines(sourceText, text)
  if (blocks.length < 2 || blocks.length !== sourceLines.length || blocks.length !== lines.length) return false
  blocks.forEach((block, index) => {
    block.textContent = block.matches('li') ? stripListPrefix(lines[index]) : lines[index]
  })
  window.getSelection()?.removeAllRanges()
  return true
}

const PAGE_TRANSLATION_STYLE_ID = 'lingyi-page-translation-style'
const PAGE_TRANSLATION_SELECTOR = 'p, li, blockquote, figcaption, td, th, h1, h2, h3, h4, h5, h6, a, button, span, label'
const PAGE_TRANSLATION_CONCURRENCY = 3
const PAGE_TRANSLATION_INITIAL_VIEWPORTS = 2
const PAGE_TRANSLATION_INITIAL_BATCH = 24

const pageTranslation = {
  runId: 0,
  active: false,
  mode: 'replace' as PageTranslateMode,
  sourceLanguage: '自动检测',
  targetLanguage: '中文',
  uiLanguage: 'zh-CN' as UiLanguage,
  activeWorkers: 0,
  done: 0,
  failed: 0,
  total: 0,
  scrollTimer: 0,
  observer: undefined as IntersectionObserver | undefined,
  queue: [] as HTMLElement[],
  observed: new WeakSet<Element>(),
  translated: new WeakSet<Element>(),
}

function injectPageTranslationStyle() {
  if (document.getElementById(PAGE_TRANSLATION_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = PAGE_TRANSLATION_STYLE_ID
  style.textContent = `
    lingyi-trans{display:block;max-width:100%;margin:.32em 0 .12em;padding:0 0 0 .58em;border-left:2px solid rgba(79,91,213,.45);background:transparent;color:#5059b8;font:500 .9em/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:0;text-wrap:pretty}
    lingyi-trans[data-ly-kind="heading"]{margin-top:.18em;font-size:16px;line-height:1.45}
    lingyi-trans[data-ly-kind="control"]{display:block;margin:.16em 0 0;padding:0;border:0;color:#5360d6;font:600 11px/1.18 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:normal;text-wrap:balance}
    lingyi-trans[data-ly-kind="inline"]{display:inline;margin:0 0 0 .35em;padding:0;border:0;color:#5360d6;font:600 .82em/1.25 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:normal}
    lingyi-trans[data-ly-loading="true"]{display:flex;align-items:center;gap:.5em;width:fit-content;max-width:100%;min-height:1.35em;border-left-color:rgba(79,91,213,.22);font-weight:600;background:linear-gradient(90deg in oklch,rgba(80,89,184,.52),#5360d6,rgba(80,89,184,.52)) 0 0/220% 100%;background-clip:text;-webkit-background-clip:text;color:transparent;animation:lingyi-text-shimmer 1.35s ease-in-out infinite}
    lingyi-trans[data-ly-loading="true"]::before{content:"";display:inline-block;width:.82em;height:.82em;flex:none;border:2px solid rgba(79,91,213,.18);border-top-color:#5360d6;border-radius:999px;animation:lingyi-spin .72s linear infinite}
    @keyframes lingyi-spin{to{transform:rotate(360deg)}}
    @keyframes lingyi-text-shimmer{to{background-position:220% 0}}
    @media (prefers-reduced-motion: reduce){lingyi-trans[data-ly-loading="true"]{animation:none;color:rgba(80,89,184,.72)}lingyi-trans[data-ly-loading="true"]::before{animation:none}}
  `
  document.head.append(style)
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function normalizeComparableText(value: string) {
  return normalizeText(value)
    .replace(/^[`"'“”‘’《》「」『』]+|[`"'“”‘’《》「」『』]+$/g, '')
    .replace(/\s+/g, '')
    .replace(/[.,，。:：;；!?！？()[\]{}（）【】]/g, '')
    .toLocaleLowerCase()
}

function isSameTranslation(source: string, translated: string) {
  const normalizedSource = normalizeComparableText(source)
  const normalizedTranslated = normalizeComparableText(translated)
  return Boolean(normalizedSource && normalizedSource === normalizedTranslated)
}

function getDirectText(element: Element) {
  return normalizeText(Array.from(element.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent ?? '')
    .join(' '))
}

function replaceElementText(element: HTMLElement, text: string) {
  const directTextNodes = Array.from(element.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE && normalizeText(node.textContent ?? ''))

  if (!directTextNodes.length) {
    element.textContent = text
    return
  }

  directTextNodes[0].textContent = text
  for (const node of directTextNodes.slice(1)) {
    node.textContent = ''
  }
}

function getCandidateText(element: Element) {
  const tag = (element as HTMLElement).tagName
  if (['A', 'BUTTON', 'SPAN', 'LABEL'].includes(tag)) return getDirectText(element)
  return normalizeText((element as HTMLElement).innerText || element.textContent || '')
}

function isForbiddenCandidate(element: Element) {
  return Boolean(element.closest([
    '#lingyi-root',
    'lingyi-trans',
    'dialog',
    'script',
    'style',
    'noscript',
    'textarea',
    'input',
    'select',
    '[contenteditable="true"]',
    '[aria-hidden="true"]',
    '[data-lingyi-ignore="true"]',
  ].join(',')))
}

function isLikelyUiText(element: HTMLElement, text: string) {
  const tag = element.tagName
  const parentStyle = element.parentElement ? window.getComputedStyle(element.parentElement) : null
  const selfStyle = window.getComputedStyle(element)
  const isExplicitUi = ['A', 'BUTTON', 'SPAN', 'LABEL'].includes(tag)

  if (!text || text.length > 1800) return true
  if (!/[A-Za-z\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(text)) return true
  if (/^[\d\s.,:;!?()[\]{}'"“”‘’/\\|+-]+$/.test(text)) return true
  if (isExplicitUi) return false
  if (tag === 'LI' && parentStyle && ['flex', 'inline-flex', 'grid'].includes(parentStyle.display)) return false
  if (text.length < 2) return true
  if (text.length < 8 && ['flex', 'inline-flex', 'grid'].includes(selfStyle.display)) return false
  return false
}

function hasBetterAncestorCandidate(element: HTMLElement) {
  const parent = element.parentElement
  if (!parent || isForbiddenCandidate(parent)) return false
  if (!['P', 'LI', 'BLOCKQUOTE', 'FIGCAPTION', 'TD', 'TH', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(parent.tagName)) return false
  const ownText = getCandidateText(element)
  const parentText = getCandidateText(parent)
  return parentText.length > ownText.length + 20
}

function hasBetterDescendantCandidate(element: HTMLElement, text: string) {
  if (['A', 'BUTTON', 'SPAN', 'LABEL'].includes(element.tagName)) return false
  return Array.from(element.querySelectorAll<HTMLElement>('a, button, span, label'))
    .some((candidate) => {
      if (isForbiddenCandidate(candidate)) return false
      const childText = getCandidateText(candidate)
      return childText.length >= 2 && text.includes(childText)
    })
}

function getCandidateElements() {
  return Array.from(document.querySelectorAll<HTMLElement>(PAGE_TRANSLATION_SELECTOR))
    .filter((element) => {
      if (pageTranslation.translated.has(element)) return false
      if (element.dataset.lingyiTranslated === 'true') return false
      if (isForbiddenCandidate(element)) return false

      const style = window.getComputedStyle(element)
      if (style.display === 'none' || style.visibility === 'hidden') return false

      const text = getCandidateText(element)
      if (isLikelyUiText(element, text)) return false
      if (hasBetterAncestorCandidate(element)) return false
      if (hasBetterDescendantCandidate(element, text)) return false
      return true
    })
}

function updatePageHud(_label: string) {
  lingyiGlobal.__lingyiSetPageHud?.({
    visible: false,
    active: false,
    label: '',
    done: pageTranslation.done,
    total: pageTranslation.total,
    failed: pageTranslation.failed,
    uiLanguage: pageTranslation.uiLanguage,
  })
}

function stopVisiblePageTranslation() {
  pageTranslation.runId += 1
  pageTranslation.active = false
  pageTranslation.activeWorkers = 0
  pageTranslation.queue = []
  window.clearTimeout(pageTranslation.scrollTimer)
  pageTranslation.observer?.disconnect()
  pageTranslation.observer = undefined
  lingyiGlobal.__lingyiSetPageHud?.({
    visible: false,
    active: false,
    label: '',
    done: pageTranslation.done,
    total: pageTranslation.total,
    failed: pageTranslation.failed,
    uiLanguage: pageTranslation.uiLanguage,
  })
}

function cleanupPreviousPageTranslations() {
  document.querySelectorAll('lingyi-trans').forEach((element) => element.remove())
  document.querySelectorAll<HTMLElement>('[data-lingyi-translated],[data-lingyi-queued],[data-lingyi-loading]').forEach((element) => {
    delete element.dataset.lingyiTranslated
    delete element.dataset.lingyiQueued
    delete element.dataset.lingyiLoading
    element.removeAttribute('title')
  })
}

function getTranslationKind(element: HTMLElement) {
  if (/^H[1-6]$/.test(element.tagName)) return 'heading'
  if (element.closest('a,button,nav,header,footer,[role="navigation"],[role="button"]')) return 'control'
  if (['SPAN', 'LABEL'].includes(element.tagName)) return 'inline'
  return 'block'
}

function placeTranslationElement(element: HTMLElement, translation: HTMLElement) {
  if (translation.dataset.lyKind === 'control' || translation.dataset.lyKind === 'inline') {
    element.append(translation)
  } else if (element.tagName === 'LI' || element.tagName === 'TD' || element.tagName === 'TH') {
    element.append(translation)
  } else {
    element.insertAdjacentElement('afterend', translation)
  }
}

function insertTranslationPlaceholder(element: HTMLElement) {
  const kind = getTranslationKind(element)
  if (kind === 'control' || kind === 'inline') return null
  const translation = document.createElement('lingyi-trans')
  translation.dataset.lyKind = kind
  translation.dataset.lyLoading = 'true'
  translation.textContent = t(pageTranslation.uiLanguage, 'contentTranslating')
  placeTranslationElement(element, translation)
  element.dataset.lingyiLoading = 'true'
  return translation
}

function finishTranslationPlaceholder(element: HTMLElement, placeholder: HTMLElement | null, text: string) {
  delete element.dataset.lingyiLoading
  if (!placeholder) {
    insertParallelTranslation(element, text)
    return
  }
  delete placeholder.dataset.lyLoading
  placeholder.textContent = text
}

function removeTranslationPlaceholder(element: HTMLElement, placeholder: HTMLElement | null) {
  delete element.dataset.lingyiLoading
  placeholder?.remove()
}

function insertParallelTranslation(element: HTMLElement, text: string) {
  const translation = document.createElement('lingyi-trans')
  translation.dataset.lyKind = getTranslationKind(element)
  translation.textContent = text
  placeTranslationElement(element, translation)
}

async function translateElement(element: HTMLElement, runId: number) {
  if (runId !== pageTranslation.runId || !pageTranslation.active) return
  pageTranslation.translated.add(element)
  element.dataset.lingyiTranslated = 'true'
  const text = getCandidateText(element)
  const placeholder = insertTranslationPlaceholder(element)

  try {
    const result = await sendRuntimeMessage<TranslateResult>({
      type: 'LINGYI_TRANSLATE_TEXT',
      request: {
        text,
        sourceLanguage: pageTranslation.sourceLanguage,
        targetLanguage: pageTranslation.targetLanguage,
        mode: 'translate',
      },
    })
    if (!pageTranslation.active || runId !== pageTranslation.runId) {
      removeTranslationPlaceholder(element, placeholder)
      return
    }

    if (isSameTranslation(text, result.text)) {
      removeTranslationPlaceholder(element, placeholder)
      return
    }

    if (pageTranslation.mode === 'replace') {
      removeTranslationPlaceholder(element, placeholder)
      replaceElementText(element, result.text)
      return
    }

    finishTranslationPlaceholder(element, placeholder, result.text)
  } catch (error) {
    removeTranslationPlaceholder(element, placeholder)
    if (runId !== pageTranslation.runId) return
    pageTranslation.failed += 1
    element.dataset.lingyiTranslated = 'false'
    element.title = error instanceof Error ? error.message : String(error)
  }
}

function enqueuePageElement(element: HTMLElement) {
  if (!pageTranslation.active) return false
  if (pageTranslation.translated.has(element)) return false
  if (element.dataset.lingyiQueued === 'true') return false
  if (element.dataset.lingyiTranslated === 'true') return false

  element.dataset.lingyiQueued = 'true'
  pageTranslation.queue.push(element)
  pageTranslation.total += 1
  updatePageHud(t(pageTranslation.uiLanguage, 'queuedVisible'))
  void drainPageTranslationQueue()
  return true
}

async function drainPageTranslationQueue() {
  if (!pageTranslation.active) return
  while (
    pageTranslation.active
    && pageTranslation.activeWorkers < PAGE_TRANSLATION_CONCURRENCY
    && pageTranslation.queue.length > 0
  ) {
    const element = pageTranslation.queue.shift()
    if (!element) continue
    pageTranslation.activeWorkers += 1
    void translateQueuedElement(element, pageTranslation.runId)
  }
}

async function translateQueuedElement(element: HTMLElement, runId: number) {
  try {
    if (runId !== pageTranslation.runId || !pageTranslation.active) return
    element.dataset.lingyiQueued = 'false'
    if (!document.documentElement.contains(element)) return
    if (pageTranslation.translated.has(element) || element.dataset.lingyiTranslated === 'true') return
    await translateElement(element, runId)
    if (runId !== pageTranslation.runId || !pageTranslation.active) return
    pageTranslation.done += 1
  } finally {
    if (runId !== pageTranslation.runId) return
    pageTranslation.activeWorkers = Math.max(0, pageTranslation.activeWorkers - 1)
    if (pageTranslation.active && pageTranslation.queue.length > 0) {
      void drainPageTranslationQueue()
      return
    }
    if (pageTranslation.active && pageTranslation.activeWorkers === 0) {
      updatePageHud(pageTranslation.queue.length > 0 ? t(pageTranslation.uiLanguage, 'waitingToContinue') : t(pageTranslation.uiLanguage, 'scrollAutoTranslate'))
    }
  }
}

function observePageCandidates() {
  if (!pageTranslation.active) return
  const candidates = getCandidateElements()
  for (const element of candidates) {
    if (pageTranslation.observed.has(element)) continue
    pageTranslation.observed.add(element)
    pageTranslation.observer?.observe(element)
  }
}

function isWithinInitialTranslationWindow(element: HTMLElement) {
  const rect = element.getBoundingClientRect()
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 800
  return rect.bottom >= -viewportHeight * 0.15 && rect.top <= viewportHeight * PAGE_TRANSLATION_INITIAL_VIEWPORTS
}

function enqueueInitialPageElements() {
  if (!pageTranslation.active) return 0
  const candidates = getCandidateElements()
    .map((element) => ({ element, rect: element.getBoundingClientRect() }))
    .sort((a, b) => a.rect.top - b.rect.top)
  let queued = 0

  for (const { element } of candidates) {
    if (!isWithinInitialTranslationWindow(element)) continue
    if (enqueuePageElement(element)) queued += 1
  }

  if (queued > 0) return queued

  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 800
  const nearby = candidates
    .filter(({ rect }) => rect.bottom >= -viewportHeight)
    .slice(0, PAGE_TRANSLATION_INITIAL_BATCH)

  for (const { element } of nearby) {
    if (enqueuePageElement(element)) queued += 1
  }
  return queued
}

function scheduleCandidateScan() {
  if (!pageTranslation.active) return
  window.clearTimeout(pageTranslation.scrollTimer)
  pageTranslation.scrollTimer = window.setTimeout(() => {
    observePageCandidates()
  }, 700)
}

function startVisiblePageTranslation(config: {
  mode: PageTranslateMode
  sourceLanguage: string
  targetLanguage: string
  uiLanguage?: UiLanguage
}) {
  stopVisiblePageTranslation()
  cleanupPreviousPageTranslations()
  injectPageTranslationStyle()
  pageTranslation.runId += 1
  pageTranslation.active = true
  pageTranslation.mode = config.mode
  pageTranslation.sourceLanguage = config.sourceLanguage
  pageTranslation.targetLanguage = config.targetLanguage
  pageTranslation.uiLanguage = config.uiLanguage ?? 'zh-CN'
  pageTranslation.activeWorkers = 0
  pageTranslation.done = 0
  pageTranslation.failed = 0
  pageTranslation.total = 0
  pageTranslation.queue = []
  pageTranslation.observed = new WeakSet<Element>()
  pageTranslation.translated = new WeakSet<Element>()

  pageTranslation.observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) enqueuePageElement(entry.target as HTMLElement)
    }
  }, {
    root: null,
    rootMargin: '100% 0px 140% 0px',
    threshold: 0,
  })

  observePageCandidates()
  const initialQueued = enqueueInitialPageElements()
  window.requestAnimationFrame(() => {
    if (!pageTranslation.active) return
    observePageCandidates()
    enqueueInitialPageElements()
  })
  window.removeEventListener('scroll', scheduleCandidateScan)
  window.addEventListener('scroll', scheduleCandidateScan, { passive: true })
  updatePageHud(t(pageTranslation.uiLanguage, 'scanningPage'))

  const candidates = getCandidateElements().length

  return {
    queued: initialQueued || Math.min(candidates, 18),
    message: candidates
      ? t(pageTranslation.uiLanguage, 'immersiveStarted')
      : t(pageTranslation.uiLanguage, 'noPageTextFound'),
  }
}

function installRuntimeListener() {
  if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage || lingyiGlobal.__lingyiRuntimeListenerInstalled) return
  lingyiGlobal.__lingyiRuntimeListenerInstalled = true

  chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
    if (message.type === 'LINGYI_PING_CONTENT') {
      sendResponse({ ok: true, data: true } satisfies RuntimeResponse<boolean>)
      return false
    }
    if (message.type === 'LINGYI_COLLECT_PAGE_TEXT') {
      sendResponse({ ok: true, data: collectPageText() } satisfies RuntimeResponse<string>)
      return false
    }
    if (message.type === 'LINGYI_TRANSLATE_VISIBLE_PAGE') {
      sendResponse({
        ok: true,
        data: startVisiblePageTranslation({
          mode: message.mode,
          sourceLanguage: message.sourceLanguage,
          targetLanguage: message.targetLanguage,
          uiLanguage: message.uiLanguage,
        }),
      } satisfies RuntimeResponse<{ queued: number; message: string }>)
      return false
    }
    if (message.type === 'LINGYI_SHOW_TRANSLATION_FOR_TEXT') {
      lingyiGlobal.__lingyiShowTranslationForText?.(message.text)
      sendResponse({ ok: true, data: true } satisfies RuntimeResponse<boolean>)
      return false
    }
    if (message.type === 'LINGYI_SHOW_PAGE_SUMMARY') {
      lingyiGlobal.__lingyiShowPageSummary?.({
        status: message.status,
        text: message.text,
        error: message.error,
      })
      sendResponse({ ok: true, data: true } satisfies RuntimeResponse<boolean>)
      return false
    }
    return false
  })
}

function ContentApp() {
  const [state, setState] = useState<BubbleState>(initialState)
  const [pageHud, setPageHud] = useState<PageHudState>({
    visible: false,
    active: false,
    label: '',
    done: 0,
    total: 0,
    failed: 0,
    uiLanguage: 'zh-CN',
  })
  const [pageSummary, setPageSummary] = useState<PageSummaryState>(initialSummaryState)
  const suppressSelectionHideRef = useRef(false)
  const anchorFrameRef = useRef(0)
  const closeTimerRef = useRef(0)
  const autoSummaryTimerRef = useRef(0)

  const selectedPreview = useMemo(() => {
    return state.text.length > 96 ? `${state.text.slice(0, 96)}…` : state.text
  }, [state.text])
  const translationBlocks = useMemo(() => {
    return state.result ? buildTranslationResultBlocks(state.text, state.result, lastRange) : []
  }, [state.result, state.text])
  const appIconUrl = useMemo(getAppIconUrl, [])

  useEffect(() => {
    async function showSelection(event: MouseEvent) {
      if (isLingyiInteraction(event)) return
      const settings = await getSettings()
      if (!settings.selectionBubble) return

      const selection = window.getSelection()
      const text = selection?.toString().trim() ?? ''
      if (!selection || text.length < 2 || selection.rangeCount === 0) {
        setState((current) => current.phase === 'trigger' ? initialState : current)
        return
      }

      const range = selection.getRangeAt(0).cloneRange()
      const anchorState = getRangeAnchorState(range)
      if (!anchorState) return

      window.clearTimeout(closeTimerRef.current)
      lastRange = range
      setState({
        visible: true,
        phase: 'trigger',
        ...anchorState,
        text,
        result: '',
        loading: false,
        error: '',
        themeStyle: themeVars(settings.theme),
        targetLanguage: settings.targetLanguage,
        uiLanguage: settings.uiLanguage,
        isLocal: settings.provider === 'chromeBuiltIn',
      })
    }

    const onMouseUp = (event: MouseEvent) => window.setTimeout(() => void showSelection(event), 10)
    document.addEventListener('mouseup', onMouseUp)
    return () => document.removeEventListener('mouseup', onMouseUp)
  }, [])

  useEffect(() => {
    const updateAnchorFromSelection = () => {
      anchorFrameRef.current = 0
      if (!lastRange) return
      const anchorState = getRangeAnchorState(lastRange)
      if (!anchorState) return
      setState((current) => {
        if (!current.visible) return current
        return { ...current, ...anchorState }
      })
    }

    const scheduleAnchorUpdate = () => {
      if (anchorFrameRef.current) return
      anchorFrameRef.current = window.requestAnimationFrame(updateAnchorFromSelection)
    }

    document.addEventListener('scroll', scheduleAnchorUpdate, { capture: true, passive: true })
    window.addEventListener('resize', scheduleAnchorUpdate, { passive: true })
    return () => {
      if (anchorFrameRef.current) window.cancelAnimationFrame(anchorFrameRef.current)
      document.removeEventListener('scroll', scheduleAnchorUpdate, { capture: true })
      window.removeEventListener('resize', scheduleAnchorUpdate)
    }
  }, [])

  useEffect(() => {
    const hideIfSelectionCleared = () => {
      window.setTimeout(() => {
        if (suppressSelectionHideRef.current) return
        const text = window.getSelection()?.toString().trim() ?? ''
        if (!text) {
          setState((current) => {
            if (current.phase !== 'trigger') return current
            lastRange = null
            return initialState
          })
        }
      }, 30)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeSelectionPopover()
    }
    document.addEventListener('selectionchange', hideIfSelectionCleared)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('selectionchange', hideIfSelectionCleared)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  useEffect(() => {
    return () => window.clearTimeout(closeTimerRef.current)
  }, [])

  useEffect(() => {
    let currentUrl = location.href

    const scheduleAutoSummary = () => {
      window.clearTimeout(autoSummaryTimerRef.current)
      autoSummaryTimerRef.current = window.setTimeout(() => {
        void getSettings().then((settings) => {
          if (!settings.autoSummary) return
          const url = location.href
          if (autoSummarizedUrls.has(url)) return
          autoSummarizedUrls.add(url)
          void sendRuntimeMessage<boolean>({ type: 'LINGYI_SUMMARIZE_PAGE' }).catch(() => {
            autoSummarizedUrls.delete(url)
          })
        })
      }, AUTO_SUMMARY_DELAY_MS)
    }

    const checkUrlChange = () => {
      if (location.href === currentUrl) return
      currentUrl = location.href
      scheduleAutoSummary()
    }

    scheduleAutoSummary()
    const interval = window.setInterval(checkUrlChange, 1000)
    window.addEventListener('popstate', checkUrlChange)
    window.addEventListener('hashchange', checkUrlChange)

    return () => {
      window.clearTimeout(autoSummaryTimerRef.current)
      window.clearInterval(interval)
      window.removeEventListener('popstate', checkUrlChange)
      window.removeEventListener('hashchange', checkUrlChange)
    }
  }, [])

  useEffect(() => {
    lingyiGlobal.__lingyiSetPageHud = setPageHud
    return () => {
      if (lingyiGlobal.__lingyiSetPageHud === setPageHud) {
        lingyiGlobal.__lingyiSetPageHud = undefined
      }
    }
  }, [])

  useEffect(() => {
    const showPageSummary = (summary: { status: 'loading' | 'success' | 'error'; text?: string; error?: string }) => {
      void getSettings().then((settings) => {
        setPageSummary({
          visible: true,
          loading: summary.status === 'loading',
          error: summary.status === 'error' ? summary.error || t(settings.uiLanguage, 'summaryFailed') : '',
          text: summary.status === 'success' ? summary.text || '' : '',
          themeStyle: themeVars(settings.theme),
          uiLanguage: settings.uiLanguage,
        })
      })
    }
    lingyiGlobal.__lingyiShowPageSummary = showPageSummary
    return () => {
      if (lingyiGlobal.__lingyiShowPageSummary === showPageSummary) {
        lingyiGlobal.__lingyiShowPageSummary = undefined
      }
    }
  }, [])

  useEffect(() => {
    const showTranslationForText = (text: string) => {
      void getSettings().then((settings) => {
        setState({
          visible: true,
          phase: 'trigger',
          anchorX: 24,
          anchorY: 24,
          anchorWidth: 1,
          anchorHeight: 1,
          text,
          result: '',
          loading: false,
          error: '',
          themeStyle: themeVars(settings.theme),
          targetLanguage: settings.targetLanguage,
          uiLanguage: settings.uiLanguage,
          isLocal: settings.provider === 'chromeBuiltIn',
        })
      })
    }
    lingyiGlobal.__lingyiShowTranslationForText = showTranslationForText
    return () => {
      if (lingyiGlobal.__lingyiShowTranslationForText === showTranslationForText) {
        lingyiGlobal.__lingyiShowTranslationForText = undefined
      }
    }
  }, [])

  async function translate() {
    const text = state.text
    suppressSelectionHideRef.current = true
    window.setTimeout(() => {
      suppressSelectionHideRef.current = false
    }, 650)
    setState((current) => ({
      ...current,
      phase: 'card',
      loading: true,
      error: '',
      result: '',
    }))
    try {
      const settings = await getSettings()
      const result = await sendRuntimeMessage<TranslateResult>({
        type: 'LINGYI_TRANSLATE_TEXT',
        request: {
          text,
          sourceLanguage: settings.sourceLanguage,
          targetLanguage: settings.targetLanguage,
          mode: 'translate',
        },
      })
      setState((current) => ({ ...current, loading: false, result: result.text }))
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }))
    }
  }

  async function copyResult() {
    if (!state.result) return
    await navigator.clipboard.writeText(state.result)
  }

  async function copyPageSummary() {
    if (!pageSummary.text || pageSummary.loading) return
    await navigator.clipboard.writeText(pageSummary.text)
  }

  async function retryPageSummary() {
    if (pageSummary.loading) return
    setPageSummary((current) => ({
      ...current,
      loading: true,
      error: '',
      text: '',
    }))
    try {
      void sendRuntimeMessage<boolean>({ type: 'LINGYI_SUMMARIZE_PAGE' }).catch((error) => {
        setPageSummary((current) => ({
          ...current,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        }))
      })
    } catch (error) {
      setPageSummary((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }))
    }
  }

  function replaceSelection() {
    if (!state.result || !lastRange) return
    try {
      if (!replaceSelectedBlocks(lastRange, state.text, state.result)) {
        replaceRangeWithText(lastRange, state.result)
      }
      lastRange = null
      setState(initialState)
    } catch (error) {
      setState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : t(current.uiLanguage, 'staleSelection'),
      }))
    }
  }

  function closeSelectionPopover() {
    protectToolbarInteraction()
    window.clearTimeout(closeTimerRef.current)
    setState((current) => {
      if (!current.visible) return current
      if (current.phase === 'trigger') return initialState
      return {
        ...current,
        phase: 'trigger',
        loading: false,
        error: '',
        result: '',
      }
    })
    closeTimerRef.current = window.setTimeout(() => {
      lastRange = null
      setState(initialState)
    }, SELECTION_POPOVER_CLOSE_MS)
  }

  function protectToolbarInteraction() {
    suppressSelectionHideRef.current = true
    window.setTimeout(() => {
      suppressSelectionHideRef.current = false
    }, 650)
  }

  return (
    <>
      {state.visible && (
        <span
          className="ly-selection-anchor"
          style={{
            left: state.anchorX,
            top: state.anchorY,
            width: state.anchorWidth,
            height: state.anchorHeight,
            anchorName: '--lingyi-selection-anchor',
          } as CSSProperties & Record<string, string | number>}
        />
      )}

      {state.visible && (
        <div
          className="ly-selection-popover"
          data-open={state.phase === 'card' ? 'true' : 'false'}
          style={{
            positionAnchor: '--lingyi-selection-anchor',
            positionArea: 'bottom',
            marginBlockStart: state.phase === 'card' ? 10 : 12,
            positionTryFallbacks: 'flip-block, flip-inline, flip-block flip-inline',
            ...state.themeStyle,
          } as CSSProperties & Record<string, string | number>}
        >
          <button
            type="button"
            className="ly-floating-trigger ly-morph-trigger"
            aria-hidden={state.phase === 'card'}
            tabIndex={state.phase === 'card' ? -1 : 0}
            onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
              protectToolbarInteraction()
            }}
            onMouseDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
              protectToolbarInteraction()
            }}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              protectToolbarInteraction()
              void translate()
            }}
          >
            <span className="ly-mini-logo" aria-hidden="true"><img src={appIconUrl} alt="" /></span>
            <span>{t(state.uiLanguage, 'translate')}</span>
          </button>

          <div className="ly-card ly-morph-card" aria-hidden={state.phase === 'trigger'}>
            <div className="ly-head">
              <div className="ly-lang">
                <span>EN</span>
                <b>→</b>
                <span>{state.targetLanguage}</span>
                <em>{t(state.uiLanguage, 'autoDetect')}</em>
              </div>
              <div className="ly-head-actions">
                <button type="button" onClick={closeSelectionPopover} aria-label={t(state.uiLanguage, 'close')}>×</button>
              </div>
            </div>
            <div className={state.result ? 'ly-body has-actions' : 'ly-body'}>
              <p className="ly-source">{selectedPreview}</p>
              {!state.result && !state.loading && !state.error && (
                <button type="button" className="ly-trigger" onClick={() => void translate()}>
                  <span className="ly-mini-logo" aria-hidden="true"><img src={appIconUrl} alt="" /></span>
                  <span>{t(state.uiLanguage, 'translate')}</span>
                  <small>EN→{state.targetLanguage}</small>
                </button>
              )}
              {state.loading && (
                <>
                  <div className="ly-thinking">
                    <span />
                    <span>{state.isLocal ? t(state.uiLanguage, 'localThinking') : t(state.uiLanguage, 'cloudThinking')}</span>
                  </div>
                  <div className="ly-skeleton"><i /><i /></div>
                </>
              )}
              {state.error && <p className="ly-error">{state.error}</p>}
              {state.result && (
                <div className="ly-result">
                  {translationBlocks.map((block, index) => {
                    if (block.kind === 'list') {
                      return (
                        <ul key={`list-${index}`}>
                          {block.items.map((item, itemIndex) => (
                            <li key={`${index}-${itemIndex}`}>{item}</li>
                          ))}
                        </ul>
                      )
                    }
                    return <p key={`${block.kind}-${index}`} className={block.kind === 'heading' ? 'ly-result-heading' : undefined}>{block.text}</p>
                  })}
                </div>
              )}
            </div>
            {state.result && (
              <div className="ly-actions">
                <button type="button" className="ly-primary" onClick={replaceSelection}>{t(state.uiLanguage, 'replaceSource')}</button>
                <button type="button" onClick={() => void copyResult()}>{t(state.uiLanguage, 'copyTranslation')}</button>
              </div>
            )}
          </div>
        </div>
      )}

      {pageHud.visible && (
        <div className="ly-page-hud" style={state.themeStyle}>
          <div className="ly-page-hud-main">
            <span className={pageHud.active ? 'ly-page-dot is-active' : 'ly-page-dot'} />
            <div>
              <b>{pageHud.label || t(pageHud.uiLanguage, 'scrollAutoTranslate')}</b>
              <span>{pageHud.done}/{Math.max(pageHud.total, pageHud.done)} {t(pageHud.uiLanguage, 'segmentUnit')}{pageHud.failed ? ` · ${pageHud.failed} ${t(pageHud.uiLanguage, 'failedUnit')}` : ''}</span>
            </div>
          </div>
          <button type="button" onClick={stopVisiblePageTranslation} aria-label={t(pageHud.uiLanguage, 'stopPageTranslation')}>×</button>
        </div>
      )}

      {pageSummary.visible && (
        <aside className="ly-summary-panel" style={pageSummary.themeStyle}>
          <div className="ly-summary-head">
            <div>
              <b>{t(pageSummary.uiLanguage, 'pageSummary')}</b>
              <span>Summary</span>
            </div>
            <button type="button" onClick={() => setPageSummary(initialSummaryState)} aria-label={t(pageSummary.uiLanguage, 'closeSummary')}>×</button>
          </div>
          <div className="ly-summary-body">
            {pageSummary.loading && (
              <div className="ly-summary-loading" aria-live="polite">
                <div className="ly-summary-thinking">
                  <span />
                  <b>{t(pageSummary.uiLanguage, 'summarizingPage')}</b>
                </div>
                <div className="ly-summary-skeleton">
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
              </div>
            )}
            {pageSummary.error && <p className="ly-summary-error">{pageSummary.error}</p>}
            {!pageSummary.loading && !pageSummary.error && pageSummary.text && (
              <Streamdown
                className="ly-summary-markdown"
                controls={false}
                skipHtml
              >
                {pageSummary.text}
              </Streamdown>
            )}
          </div>
          {!pageSummary.loading && (pageSummary.text || pageSummary.error) && (
            <div className="ly-summary-actions">
              <button className="ly-secondary" type="button" onClick={() => void retryPageSummary()}>{t(pageSummary.uiLanguage, 'retrySummary')}</button>
              {pageSummary.text && !pageSummary.error && (
                <button type="button" onClick={() => void copyPageSummary()}>{t(pageSummary.uiLanguage, 'copySummary')}</button>
              )}
            </div>
          )}
        </aside>
      )}
    </>
  )
}

const style = document.createElement('style')
style.textContent = `
  :host{font-synthesis-weight:none;-webkit-font-smoothing:antialiased}
  .ly-selection-anchor{position:fixed;z-index:2147483646;width:1px;height:1px;pointer-events:none}
  .ly-selection-popover{position:fixed;z-index:2147483647;width:82px;height:40px;max-width:calc(100vw - 24px);max-height:40px;overflow:hidden;border:1px solid var(--ly-border);border-radius:12px;background:var(--ly-bg);color:var(--ly-text);box-shadow:0 14px 34px rgba(17,24,39,.16),0 2px 8px rgba(17,24,39,.08);font-family:var(--ly-font-body),-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;animation:ly-pop .18s ease;transition:width .25s cubic-bezier(.22,1,.36,1),max-height .25s cubic-bezier(.22,1,.36,1),border-radius .25s cubic-bezier(.22,1,.36,1),box-shadow .22s cubic-bezier(.2,0,0,1)}
  .ly-selection-popover[data-open="true"]{width:min(340px,calc(100vw - 24px));height:auto;max-height:min(420px,calc(100dvh - 24px));border-radius:var(--ly-radius);box-shadow:var(--ly-shadow);transition:width .35s cubic-bezier(.34,1.25,.64,1),max-height .35s cubic-bezier(.34,1.25,.64,1),border-radius .35s cubic-bezier(.34,1.25,.64,1),box-shadow .24s cubic-bezier(.2,0,0,1)}
  .ly-selection-popover,.ly-selection-popover *{box-sizing:border-box}
  .ly-floating-trigger{position:absolute;inset:0;display:inline-flex;width:100%;height:100%;align-items:center;gap:7px;margin:0;padding:8px 13px 8px 8px;border:0;border-radius:inherit;background:transparent;color:var(--ly-text);font:600 12px/1 var(--ly-font-body),-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:0;appearance:none;-webkit-appearance:none;text-transform:none;cursor:pointer;transition:opacity .2s cubic-bezier(.22,1,.36,1),transform .35s cubic-bezier(.22,1,.36,1),filter .2s cubic-bezier(.22,1,.36,1)}
  .ly-floating-trigger,.ly-floating-trigger *{box-sizing:border-box}
  .ly-selection-popover:not([data-open="true"]):hover{box-shadow:0 18px 38px rgba(17,24,39,.18),0 4px 10px rgba(17,24,39,.1)}
  .ly-selection-popover[data-open="true"] .ly-morph-trigger{opacity:0;transform:translateX(-40px) scale(.97);filter:blur(2px);pointer-events:none}
  .ly-floating-trigger:active{transform:translateY(0) scale(.96)}
  .ly-card{--ly-popover-pad-x:16px;position:absolute;inset:0;display:flex;width:100%;max-height:inherit;flex-direction:column;background:transparent;color:var(--ly-text);overflow:hidden;opacity:0;transform:translateX(40px) scale(.97);filter:blur(2px);pointer-events:none;transition:opacity .2s cubic-bezier(.22,1,.36,1),transform .35s cubic-bezier(.22,1,.36,1),filter .2s cubic-bezier(.22,1,.36,1)}
  .ly-selection-popover[data-open="true"] .ly-morph-card{position:relative;opacity:1;transform:translateX(0) scale(1);filter:blur(0);pointer-events:auto}
  .ly-card,.ly-card *{box-sizing:border-box}
  .ly-card *{transition:background-color .32s ease,color .32s ease,border-color .32s ease,box-shadow .32s ease}
  .ly-card button{appearance:none;-webkit-appearance:none;margin:0;border:0;font:inherit;letter-spacing:inherit;text-transform:none;text-align:inherit;cursor:pointer}
  .ly-head{display:flex;align-items:center;justify-content:space-between;padding:12px var(--ly-popover-pad-x);border-bottom:1px solid var(--ly-border)}
  .ly-lang{display:inline-flex;height:18px;align-items:center;gap:6px}
  .ly-lang span,.ly-lang b,.ly-lang em{display:inline-flex;height:18px;align-items:center;line-height:1}
  .ly-lang span{font:600 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--ly-accent-soft-ink)}
  .ly-lang b{font:600 12px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--ly-faint)}
  .ly-lang em{margin-left:3px;font:500 10px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--ly-faint);font-style:normal}
  .ly-head-actions{display:flex;gap:6px}.ly-head-actions button{width:26px;height:26px;border-radius:var(--ly-radius-xs);background:var(--ly-surface-2);color:var(--ly-muted);display:flex;align-items:center;justify-content:center;font-size:16px;line-height:1}
  .ly-body{min-height:0;flex:1;overflow:auto;padding:15px var(--ly-popover-pad-x);scrollbar-width:thin;scrollbar-color:color-mix(in srgb,var(--ly-muted) 42%,transparent) transparent;overscroll-behavior:contain}.ly-body.has-actions{padding-bottom:8px}.ly-body::-webkit-scrollbar{width:8px}.ly-body::-webkit-scrollbar-track{background:transparent}.ly-body::-webkit-scrollbar-thumb{border:2px solid transparent;border-radius:999px;background:color-mix(in srgb,var(--ly-muted) 38%,transparent);background-clip:padding-box}.ly-body::-webkit-scrollbar-thumb:hover{background:color-mix(in srgb,var(--ly-muted) 55%,transparent);background-clip:padding-box}.ly-source{margin:0 0 11px;color:var(--ly-faint);font-size:12px;line-height:1.55}.ly-result{margin:0;color:var(--ly-text);font-family:var(--ly-font-disp),var(--ly-font-body);font-size:15px;line-height:1.6;font-weight:600}.ly-result p{margin:0 0 8px}.ly-result p:last-child{margin-bottom:0}.ly-result-heading{font-size:13px;line-height:1.35;color:var(--ly-muted);font-weight:750}.ly-result ul{display:flex;flex-direction:column;gap:6px;margin:0;padding:0 0 0 1.15em}.ly-result li{margin:0;padding-left:.1em}
  .ly-trigger{display:inline-flex;align-items:center;gap:7px;margin-top:2px;padding:7px 12px 7px 8px;background:var(--ly-bg);border:1px solid var(--ly-border);border-radius:11px;box-shadow:var(--ly-shadow);animation:ly-pop .25s ease}
  .ly-trigger span:not(.ly-mini-logo){font-size:12px;font-weight:600;color:var(--ly-text)}.ly-trigger small{font:600 10px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--ly-faint)}
  .ly-mini-logo{width:24px;height:24px;flex:none;border-radius:7px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:var(--ly-bg);box-shadow:0 0 0 1px rgba(0,0,0,.10),0 1px 2px rgba(17,24,39,.14)}.ly-mini-logo img{display:block;width:100%;height:100%;object-fit:cover;outline:1px solid rgba(0,0,0,.10);outline-offset:-1px}
  .ly-thinking{display:flex;align-items:center;gap:9px;margin-bottom:13px;color:var(--ly-accent-soft-ink);font-size:12px;font-weight:600}.ly-thinking span:first-child{width:18px;height:18px;border-radius:999px;border:2px solid var(--ly-surface-2);border-top-color:var(--ly-accent);animation:ly-spin .7s linear infinite}
  .ly-skeleton{display:flex;flex-direction:column;gap:9px}.ly-skeleton i{height:13px;border-radius:5px;background:linear-gradient(90deg,var(--ly-surface),var(--ly-surface-2),var(--ly-surface));background-size:220px 100%;animation:ly-shimmer 1.1s infinite linear}.ly-skeleton i:last-child{width:72%;animation-delay:.15s}
  .ly-error{margin:0;color:#b42318;background:#fff1f0;border:1px solid #ffd6d2;border-radius:var(--ly-radius-xs);padding:10px;font-size:12px;line-height:1.45}
  .ly-actions{display:flex;flex:none;gap:8px;padding:7px var(--ly-popover-pad-x);border-top:1px solid color-mix(in srgb,var(--ly-border) 72%,transparent);background:var(--ly-bg)}.ly-actions button{flex:1;display:flex;align-items:center;justify-content:center;gap:6px;border-radius:var(--ly-radius-xs);background:var(--ly-surface-2);color:var(--ly-text);padding:9px;font-size:12px;font-weight:600}.ly-actions .ly-primary{background:var(--ly-accent-grad);color:var(--ly-accent-ink);box-shadow:var(--ly-glow)}
  .ly-page-hud{position:fixed;right:18px;bottom:18px;z-index:2147483647;display:flex;align-items:center;gap:12px;max-width:320px;padding:10px 10px 10px 12px;border:1px solid var(--ly-border);border-radius:14px;background:color-mix(in srgb,var(--ly-bg) 94%,transparent);color:var(--ly-text);box-shadow:0 18px 44px rgba(17,24,39,.18),0 4px 14px rgba(17,24,39,.1);font-family:var(--ly-font-body),-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;backdrop-filter:blur(14px);animation:ly-hud-in .18s ease}
  .ly-page-hud,.ly-page-hud *{box-sizing:border-box}
  .ly-page-hud-main{display:flex;align-items:center;gap:9px;min-width:0}.ly-page-hud-main div{display:flex;min-width:0;flex-direction:column;gap:2px}.ly-page-hud-main b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:650;line-height:1.2;color:var(--ly-text)}.ly-page-hud-main span:not(.ly-page-dot){font-variant-numeric:tabular-nums;font-size:11px;font-weight:600;line-height:1.2;color:var(--ly-faint)}
  .ly-page-dot{width:8px;height:8px;flex:none;border-radius:999px;background:var(--ly-accent);box-shadow:0 0 0 4px var(--ly-accent-soft)}.ly-page-dot.is-active{animation:ly-pulse 1s ease-in-out infinite}
  .ly-page-hud button{display:flex;width:30px;height:30px;flex:none;align-items:center;justify-content:center;margin:0;border:0;border-radius:10px;background:var(--ly-surface-2);color:var(--ly-muted);font:600 16px/1 var(--ly-font-body),-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;appearance:none;-webkit-appearance:none;cursor:pointer;transition-property:transform,background-color,color;transition-duration:.16s;transition-timing-function:cubic-bezier(.2,0,0,1)}.ly-page-hud button:active{transform:scale(.96)}
  .ly-summary-panel{position:fixed;right:18px;bottom:18px;z-index:2147483647;width:min(380px,calc(100vw - 36px));max-height:min(460px,calc(100dvh - 36px));display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--ly-border);border-radius:var(--ly-radius);background:var(--ly-bg);color:var(--ly-text);box-shadow:var(--ly-shadow);font-family:var(--ly-font-body),-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;animation:ly-hud-in .18s ease}.ly-summary-panel,.ly-summary-panel *{box-sizing:border-box}
  .ly-summary-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 14px;border-bottom:1px solid var(--ly-border)}.ly-summary-head div{display:flex;min-width:0;flex-direction:column;gap:2px}.ly-summary-head b{font-size:13px;font-weight:750;line-height:1.2;color:var(--ly-text)}.ly-summary-head span{font:600 10px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--ly-faint);text-transform:uppercase}.ly-summary-head button{display:flex;width:28px;height:28px;flex:none;align-items:center;justify-content:center;border:0;border-radius:9px;background:var(--ly-surface-2);color:var(--ly-muted);font:600 16px/1 var(--ly-font-body),-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer}
  .ly-summary-body{min-height:138px;overflow:auto;padding:14px;color:var(--ly-text);font-size:13px;font-weight:500;line-height:1.65;scrollbar-width:thin;scrollbar-color:color-mix(in srgb,var(--ly-muted) 42%,transparent) transparent}.ly-summary-actions{display:flex;justify-content:flex-end;gap:8px;border-top:1px solid var(--ly-border);padding:10px 14px;background:var(--ly-bg)}.ly-summary-actions button{border:0;border-radius:var(--ly-radius-xs);background:var(--ly-accent-grad);color:var(--ly-accent-ink);padding:8px 12px;font:700 12px/1 var(--ly-font-body),-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;box-shadow:var(--ly-glow)}.ly-summary-actions .ly-secondary{background:var(--ly-surface-2);color:var(--ly-text);box-shadow:inset 0 0 0 1px var(--ly-border)}
  .ly-summary-markdown{display:block;color:var(--ly-text);font-size:13px;font-weight:500;line-height:1.65;overflow-wrap:anywhere}.ly-summary-markdown :where(p,ul,ol,blockquote,pre,table){margin:0 0 10px}.ly-summary-markdown :where(p:last-child,ul:last-child,ol:last-child,blockquote:last-child,pre:last-child,table:last-child){margin-bottom:0}.ly-summary-markdown :where(h1,h2,h3,h4){margin:0 0 8px;color:var(--ly-text);font-family:var(--ly-font-disp),var(--ly-font-body),sans-serif;font-weight:750;letter-spacing:0;line-height:1.32}.ly-summary-markdown h1{font-size:18px}.ly-summary-markdown h2{font-size:16px}.ly-summary-markdown h3,.ly-summary-markdown h4{font-size:14px}.ly-summary-markdown :where(ul,ol){padding-left:1.25em}.ly-summary-markdown li{margin:3px 0;padding-left:.1em}.ly-summary-markdown li::marker{color:var(--ly-accent);font-weight:750}.ly-summary-markdown a{color:var(--ly-accent-soft-ink);font-weight:650;text-decoration:none;border-bottom:1px solid color-mix(in srgb,var(--ly-accent) 30%,transparent)}.ly-summary-markdown a:hover{border-bottom-color:var(--ly-accent)}.ly-summary-markdown code{border:1px solid var(--ly-border);border-radius:6px;background:var(--ly-surface);padding:1px 5px;color:var(--ly-accent-soft-ink);font:600 12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}.ly-summary-markdown pre{overflow:auto;border:1px solid var(--ly-border);border-radius:var(--ly-radius-xs);background:var(--ly-surface);padding:10px;white-space:pre}.ly-summary-markdown pre code{border:0;background:transparent;padding:0;color:var(--ly-text);font-weight:500}.ly-summary-markdown blockquote{border-left:3px solid color-mix(in srgb,var(--ly-accent) 45%,transparent);border-radius:0 8px 8px 0;background:var(--ly-surface);padding:8px 10px;color:var(--ly-muted)}.ly-summary-markdown table{display:block;width:100%;overflow:auto;border-collapse:collapse}.ly-summary-markdown :where(th,td){border:1px solid var(--ly-border);padding:6px 8px;text-align:left;vertical-align:top}.ly-summary-markdown th{background:var(--ly-surface);font-weight:750}.ly-summary-markdown hr{height:1px;margin:12px 0;border:0;background:var(--ly-border)}
  .ly-summary-loading{display:flex;flex-direction:column;gap:14px}.ly-summary-thinking{display:flex;align-items:center;gap:9px;color:var(--ly-accent-soft-ink)}.ly-summary-thinking span{width:18px;height:18px;border-radius:999px;border:2px solid var(--ly-surface-2);border-top-color:var(--ly-accent);animation:ly-spin .7s linear infinite}.ly-summary-thinking b{background:linear-gradient(90deg in oklch,color-mix(in srgb,var(--ly-accent-soft-ink) 68%,transparent),var(--ly-accent),color-mix(in srgb,var(--ly-accent-soft-ink) 68%,transparent)) 0 0/220% 100%;background-clip:text;-webkit-background-clip:text;color:transparent;font-size:12px;font-weight:750;animation:ly-text-shimmer 1.35s ease-in-out infinite}.ly-summary-skeleton{display:flex;flex-direction:column;gap:10px}.ly-summary-skeleton i{height:13px;border-radius:6px;background:linear-gradient(90deg,var(--ly-surface),var(--ly-surface-2),var(--ly-surface));background-size:220px 100%;animation:ly-shimmer 1.1s infinite linear}.ly-summary-skeleton i:nth-child(2){width:92%;animation-delay:.08s}.ly-summary-skeleton i:nth-child(3){width:78%;animation-delay:.16s}.ly-summary-skeleton i:nth-child(4){width:58%;animation-delay:.24s}.ly-summary-error{margin:0;border:1px solid #ffd6d2;border-radius:var(--ly-radius-xs);background:#fff1f0;color:#b42318;padding:10px;font-size:12px;font-weight:650;line-height:1.5}
  @media (prefers-reduced-motion: reduce){.ly-selection-popover,.ly-floating-trigger,.ly-card,.ly-summary-panel,.ly-summary-thinking span,.ly-summary-thinking b,.ly-summary-skeleton i{transition:none!important;animation:none!important}.ly-summary-thinking b{color:var(--ly-accent-soft-ink);background:none}}
  @keyframes ly-spin{to{transform:rotate(360deg)}}@keyframes ly-shimmer{from{background-position:-200px 0}to{background-position:240px 0}}@keyframes ly-text-shimmer{to{background-position:220% 0}}@keyframes ly-pop{from{transform:translateY(3px) scale(.96);opacity:0}to{transform:translateY(0) scale(1);opacity:1}}@keyframes ly-hud-in{from{transform:translateY(6px);opacity:0}to{transform:translateY(0);opacity:1}}@keyframes ly-pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(.72);opacity:.55}}
`
installRuntimeListener()
document.getElementById('lingyi-root')?.remove()
const host = document.createElement('div')
host.id = 'lingyi-root'
document.documentElement.appendChild(host)
const shadow = host.attachShadow({ mode: 'open' })
shadow.append(style)
const mount = document.createElement('div')
shadow.append(mount)
createRoot(mount).render(<ContentApp />)
