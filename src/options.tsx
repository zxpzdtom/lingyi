import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Check,
  Eye,
  EyeOff,
  Globe2,
  Hash,
  KeyRound,
  Keyboard,
  Languages,
  Loader2,
  Palette,
  Sparkles,
  Zap,
} from 'lucide-react'
import './index.css'
import { demoTranslate } from './ai'
import {
  formatChromeAiAvailability,
  isChromeBuiltInProvider,
  prepareChromeBuiltInAi,
  translateWithChromeBuiltIn,
  type ChromeBuiltInAiProgress,
} from './chrome-built-in'
import { displayLanguage, providerHint, providerLabel, t, themeDescription, UI_LANGUAGE_OPTIONS } from './i18n'
import { sendRuntimeMessage } from './messages'
import { getSettings, updateSettings } from './storage'
import { THEMES, themeVars } from './theme'
import { LANGUAGES, PROVIDER_PRESETS, defaultPromptsForUiLanguage, type LingyiSettings, type ProviderId, type TranslateResult, type UiLanguage } from './types'

const testText = 'They harvest energy from chemical reactions near hydrothermal vents.'
const SHORTCUT_SETTINGS_URL = 'chrome://extensions/shortcuts'
const DEFAULT_SHORTCUTS: Record<string, string> = {
  'lingyi-translate-page': '',
  'lingyi-summary-page': '',
}

type ShortcutCommand = {
  name?: string
  shortcut?: string
}

function hasChromeRuntime() {
  return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.sendMessage)
}

function parseShortcutKeys(shortcut: string) {
  const value = shortcut.trim()
  if (!value) return []
  if (value.includes('+')) return value.split('+').map((key) => key.trim()).filter(Boolean)

  const macModifierKeys = new Set(['⌘', '⇧', '⌥', '⌃'])
  const keys: string[] = []
  let current = ''

  for (const character of Array.from(value)) {
    if (macModifierKeys.has(character)) {
      if (current) {
        keys.push(current)
        current = ''
      }
      keys.push(character)
      continue
    }
    if (/\s/.test(character)) {
      if (current) {
        keys.push(current)
        current = ''
      }
      continue
    }
    current += character
  }

  if (current) keys.push(current)
  return keys.length ? keys : [value]
}

function formatShortcutKey(key: string) {
  const labels: Record<string, string> = {
    '⌘': 'Cmd',
    '⇧': 'Shift',
    '⌥': 'Alt',
    '⌃': 'Ctrl',
  }
  return labels[key] ?? key
}

async function readShortcutCommands() {
  if (typeof chrome === 'undefined' || !chrome.commands?.getAll) return DEFAULT_SHORTCUTS
  const commands = await chrome.commands.getAll() as ShortcutCommand[]
  return Object.fromEntries(commands
    .filter((command) => command.name)
    .map((command) => [command.name!, command.shortcut ?? '']))
}

function openShortcutSettings() {
  if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
    void chrome.tabs.create({ url: SHORTCUT_SETTINGS_URL })
    return
  }
  window.location.href = SHORTCUT_SETTINGS_URL
}

function getAppIconUrl() {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) return chrome.runtime.getURL('icons/icon-128.png')
  return '/icons/icon-128.png'
}

function Logo(props: { size?: number }) {
  const size = props.size ?? 44
  return (
    <img
      src={getAppIconUrl()}
      alt=""
      className="block flex-none shadow-[0_10px_22px_rgba(30,64,175,.18),0_1px_2px_rgba(17,24,39,.12)] outline outline-1 -outline-offset-1 outline-black/10"
      style={{ width: size, height: size, borderRadius: Math.max(10, Math.round(size * 0.22)) }}
    />
  )
}

function GeminiNanoIcon(props: { size?: number }) {
  const size = props.size ?? 38
  const gradientId = `gemini-nano-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  return (
    <div
      className="flex flex-none items-center justify-center rounded-[12px] bg-white shadow-[0_0_0_1px_rgba(0,0,0,.06),0_8px_18px_rgba(80,64,43,.10)]"
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 64 64" aria-hidden="true" className="h-[72%] w-[72%]">
        <defs>
          <linearGradient id={gradientId} x1="10" y1="54" x2="54" y2="10" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#4285f4" />
            <stop offset=".34" stopColor="#9b72f2" />
            <stop offset=".68" stopColor="#d96570" />
            <stop offset="1" stopColor="#fbbc04" />
          </linearGradient>
        </defs>
        <path fill={`url(#${gradientId})`} d="M32 6c2.4 13.2 10.8 21.6 24 24-13.2 2.4-21.6 10.8-24 24-2.4-13.2-10.8-21.6-24-24 13.2-2.4 21.6-10.8 24-24Z" />
        <path fill={`url(#${gradientId})`} d="M50 5c.8 4.5 3.5 7.2 8 8-4.5.8-7.2 3.5-8 8-.8-4.5-3.5-7.2-8-8 4.5-.8 7.2-3.5 8-8Z" opacity=".82" />
      </svg>
    </div>
  )
}

function IconTile(props: { children: React.ReactNode }) {
  return (
    <div className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] bg-[var(--ly-accent-soft)] text-[var(--ly-accent-soft-ink)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--ly-accent)_10%,transparent)]">
      {props.children}
    </div>
  )
}

function Segment(props: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`min-h-10 flex-1 rounded-[10px] px-3 py-2 text-center text-[13px] font-semibold transition-[background-color,color,box-shadow,transform] ${props.active ? 'bg-[var(--ly-bg)] text-[var(--ly-text)] shadow-[0_1px_2px_rgba(0,0,0,.08),0_0_0_1px_rgba(0,0,0,.04)]' : 'text-[var(--ly-muted)] hover:bg-[color-mix(in_srgb,var(--ly-bg)_48%,transparent)] hover:text-[var(--ly-text)]'}`}
    >
      {props.children}
    </button>
  )
}

function Switch(props: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => props.onChange(!props.checked)}
      className="flex h-10 w-11 flex-none items-center justify-center rounded-full transition-transform"
      aria-pressed={props.checked}
    >
      <span className={`relative h-[26px] w-11 rounded-full shadow-[inset_0_0_0_1px_rgba(0,0,0,.06)] transition-[background-color,box-shadow] ${props.checked ? 'bg-[var(--ly-accent)] shadow-[var(--ly-glow),inset_0_0_0_1px_rgba(0,0,0,.04)]' : 'bg-[var(--ly-border-2)]'}`}>
        <span
          className="absolute left-[3px] top-[3px] h-5 w-5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,.16)] transition-transform duration-200 ease-out"
          style={{ transform: `translateX(${props.checked ? 18 : 0}px)` }}
        />
      </span>
    </button>
  )
}

type AnchorStyle = React.CSSProperties & {
  anchorName?: string
  positionAnchor?: string
}

interface AnchorSelectOption<T extends string> {
  value: T
  label: string
  description?: string
}

function AnchorSelect<T extends string>(props: {
  value: T
  options: AnchorSelectOption<T>[]
  onChange: (value: T) => void
  align?: 'start' | 'end'
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [direction, setDirection] = useState<'up' | 'down'>('down')
  const rawId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const anchorName = useMemo(() => `--lingyi-select-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`, [rawId])
  const supportsAnchorPositioning = useMemo(
    () => typeof CSS !== 'undefined'
      && CSS.supports('position-anchor: --lingyi-select-anchor')
      && CSS.supports('top: anchor(bottom)')
      && CSS.supports('width: anchor-size(width)'),
    [],
  )
  const selected = props.options.find((option) => option.value === props.value) ?? props.options[0]
  const align = props.align ?? 'start'

  useEffect(() => {
    if (!open) return

    const updateDirection = () => {
      const trigger = triggerRef.current
      if (!trigger) return
      const rect = trigger.getBoundingClientRect()
      const estimatedHeight = Math.min(Math.max(props.options.length * 58, 46), 288)
      const spaceBelow = window.innerHeight - rect.bottom
      const spaceAbove = rect.top
      setDirection(spaceBelow < estimatedHeight + 8 && spaceAbove > spaceBelow ? 'up' : 'down')
    }

    updateDirection()
    window.addEventListener('resize', updateDirection)
    window.addEventListener('scroll', updateDirection, true)
    return () => {
      window.removeEventListener('resize', updateDirection)
      window.removeEventListener('scroll', updateDirection, true)
    }
  }, [open, props.options.length])

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (!dropdownRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const dropdownStyle: AnchorStyle = supportsAnchorPositioning
    ? {
        position: 'fixed',
        positionAnchor: anchorName,
        width: 'anchor-size(width)',
        visibility: open ? 'visible' : 'hidden',
        transformOrigin: direction === 'up' ? 'bottom' : 'top',
        ...(align === 'end' ? { right: 'anchor(right)' } : { left: 'anchor(left)' }),
        ...(direction === 'up' ? { bottom: 'anchor(top)', marginBottom: 8 } : { top: 'anchor(bottom)', marginTop: 8 }),
      }
    : {
        visibility: open ? 'visible' : 'hidden',
        transformOrigin: direction === 'up' ? 'bottom' : 'top',
      }

  return (
    <div className={`relative ${props.className ?? ''}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setOpen(true)
          }
        }}
        className={`flex min-h-[54px] w-full min-w-0 items-center justify-between gap-3 rounded-[12px] border px-4 py-2.5 text-left outline-none transition-[background-color,border-color,box-shadow] ${
          open
            ? 'border-[var(--ly-accent)] bg-[var(--ly-bg)] shadow-[0_0_0_4px_color-mix(in_srgb,var(--ly-accent)_12%,transparent)]'
            : 'border-[var(--ly-border-2)] bg-[var(--ly-surface)] shadow-[0_1px_0_rgba(255,255,255,.55)_inset] hover:border-[var(--ly-accent)]'
        }`}
        style={{ anchorName } as AnchorStyle}
      >
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold text-[var(--ly-text)]">{selected?.label}</span>
          {selected?.description && <span className="mt-0.5 block truncate text-[11px] leading-[1.35] text-[var(--ly-faint)]">{selected.description}</span>}
        </span>
        <svg
          className={`h-4 w-4 flex-none text-[var(--ly-muted)] transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      <div
        ref={dropdownRef}
        role="listbox"
        className={`soft-scrollbar absolute z-50 max-h-72 w-full overflow-auto rounded-[14px] border border-[var(--ly-border)] bg-[var(--ly-bg)] p-1.5 shadow-[0_12px_28px_rgba(0,0,0,.14)] backdrop-blur-xl transition-[opacity,transform] duration-150 ${
          direction === 'up' ? 'bottom-[calc(100%+8px)]' : 'top-[calc(100%+8px)]'
        } ${align === 'end' ? 'right-0' : 'left-0'} ${open ? 'scale-100 opacity-100' : 'pointer-events-none scale-[.98] opacity-0'}`}
        style={dropdownStyle}
      >
        {props.options.map((option) => {
          const active = option.value === props.value
          return (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={active}
              className={`flex min-h-11 w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left transition-[background-color,color] ${
                active ? 'bg-[var(--ly-accent-soft)] text-[var(--ly-accent-soft-ink)]' : 'text-[var(--ly-text)] hover:bg-[var(--ly-surface)]'
              }`}
              onClick={() => {
                props.onChange(option.value)
                setOpen(false)
              }}
            >
              <span className={`h-1.5 w-1.5 flex-none rounded-full ${active ? 'bg-[var(--ly-accent)]' : 'bg-[var(--ly-border-2)]'}`} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">{option.label}</span>
                {option.description && <span className="mt-0.5 block truncate text-[11px] text-[var(--ly-faint)]">{option.description}</span>}
              </span>
              {active && <Check size={14} strokeWidth={3} className="flex-none text-[var(--ly-accent)]" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function FieldLabel(props: { title: string; description?: string }) {
  return (
    <div>
      <div className="mb-1.5 text-[13px] font-semibold text-[var(--ly-text)]">{props.title}</div>
      {props.description && <div className="mb-2.5 text-[12px] font-normal leading-[1.45] text-[var(--ly-faint)]">{props.description}</div>}
    </div>
  )
}

function SectionHeader(props: {
  icon: React.ReactNode
  title: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3">
        <IconTile>{props.icon}</IconTile>
        <div className="min-w-0">
          <h2 className="font-display text-[17px] font-bold leading-tight text-[var(--ly-text)] [text-wrap:balance]">{props.title}</h2>
          <p className="mt-1 text-[13px] leading-[1.5] text-[var(--ly-faint)] [text-wrap:pretty]">{props.description}</p>
        </div>
      </div>
      {props.action}
    </div>
  )
}

function PrimaryButton(props: {
  children: React.ReactNode
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[10px] px-4 py-2.5 text-[13px] font-semibold text-[var(--ly-accent-ink)] shadow-[var(--ly-glow)] transition-[opacity,transform,filter] [background:var(--ly-accent-grad)] hover:brightness-[1.03] disabled:opacity-70"
    >
      {props.children}
    </button>
  )
}

function ResetButton(props: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="flex-none rounded-[10px] bg-[var(--ly-surface-2)] px-3 py-2 text-[12px] font-semibold text-[var(--ly-muted)] transition-[background-color,color,transform] hover:bg-[var(--ly-border-2)] hover:text-[var(--ly-text)]"
    >
      {props.children}
    </button>
  )
}

function SettingRow(props: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-[var(--ly-border)] py-4 first:border-t-0 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <div className="text-[14px] font-semibold text-[var(--ly-text)]">{props.title}</div>
        <div className="mt-1 max-w-[250px] text-[12px] leading-[1.45] text-[var(--ly-faint)] [text-wrap:pretty]">{props.description}</div>
      </div>
      {props.children}
    </div>
  )
}

function getEditablePlainText(element: HTMLElement) {
  return element.innerText.replace(/\u00a0/g, ' ')
}

function getSelectionTextRange(root: HTMLElement) {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer)) return null
  const beforeStart = range.cloneRange()
  beforeStart.selectNodeContents(root)
  beforeStart.setEnd(range.startContainer, range.startOffset)
  const beforeEnd = range.cloneRange()
  beforeEnd.selectNodeContents(root)
  beforeEnd.setEnd(range.endContainer, range.endOffset)
  return {
    start: beforeStart.toString().length,
    end: beforeEnd.toString().length,
  }
}

function getSelectionTextOffset(root: HTMLElement) {
  return getSelectionTextRange(root)?.start ?? null
}

function restoreSelectionTextOffset(root: HTMLElement, offset: number) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  let remaining = Math.max(0, offset)
  let node = walker.nextNode()

  while (node) {
    const length = node.textContent?.length ?? 0
    if (remaining <= length) {
      range.setStart(node, remaining)
      range.collapse(true)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      return
    }
    remaining -= length
    node = walker.nextNode()
  }

  range.selectNodeContents(root)
  range.collapse(false)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

function renderPromptEditorDom(root: HTMLElement, prompt: string, variables: Record<string, string>) {
  const nodes: Node[] = []
  const pattern = /\{\{\s*([a-zA-Z][\w-]*)\s*\}\}/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(prompt)) !== null) {
    if (match.index > lastIndex) nodes.push(document.createTextNode(prompt.slice(lastIndex, match.index)))
    const token = match[0]
    const value = variables[match[1]]
    if (value == null) {
      nodes.push(document.createTextNode(token))
    } else {
      const tokenNode = document.createElement('span')
      tokenNode.contentEditable = 'false'
      tokenNode.title = `${token} -> ${value}`
      tokenNode.dataset.tooltip = value
      tokenNode.className = 'prompt-editor-token rounded-md px-1 font-semibold'
      tokenNode.textContent = token
      nodes.push(tokenNode)
    }
    lastIndex = pattern.lastIndex
  }

  if (lastIndex < prompt.length) nodes.push(document.createTextNode(prompt.slice(lastIndex)))
  root.replaceChildren(...nodes)
}

function findAdjacentPromptToken(value: string, offset: number, direction: 'backward' | 'forward') {
  const pattern = /\{\{\s*([a-zA-Z][\w-]*)\s*\}\}/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(value)) !== null) {
    const start = match.index
    const end = start + match[0].length
    if (direction === 'backward' && end === offset) return { start, end }
    if (direction === 'forward' && start === offset) return { start, end }
  }
  return null
}

function PromptEditor(props: {
  value: string
  variables: Record<string, string>
  onChange: (value: string) => void
  placeholder: string
}) {
  const editorRef = useRef<HTMLDivElement>(null)
  const caretOffsetRef = useRef<number | null>(null)
  const composingRef = useRef(false)

  useLayoutEffect(() => {
    const editor = editorRef.current
    if (!editor || composingRef.current) return
    const active = document.activeElement === editor
    const requestedOffset = caretOffsetRef.current
    const shouldRestoreSelection = active || requestedOffset != null
    const offset = shouldRestoreSelection ? requestedOffset ?? getSelectionTextOffset(editor) ?? getEditablePlainText(editor).length : null
    renderPromptEditorDom(editor, props.value, props.variables)
    if (shouldRestoreSelection && offset != null) {
      editor.focus({ preventScroll: true })
      restoreSelectionTextOffset(editor, offset)
    }
    caretOffsetRef.current = null
  }, [props.value, props.variables])

  function commitEditorValue() {
    const editor = editorRef.current
    if (!editor) return
    const nextValue = getEditablePlainText(editor)
    caretOffsetRef.current = getSelectionTextOffset(editor) ?? nextValue.length
    props.onChange(nextValue)
  }

  function handleInput() {
    if (composingRef.current) return
    commitEditorValue()
  }

  function applyEditorValue(nextValue: string, offset: number) {
    caretOffsetRef.current = offset
    props.onChange(nextValue)
    editorRef.current?.focus()
  }

  function deletePromptRange(start: number, end: number) {
    applyEditorValue(`${props.value.slice(0, start)}${props.value.slice(end)}`, start)
  }

  function handleDelete(direction: 'backward' | 'forward') {
    const editor = editorRef.current
    if (!editor) return false
    const range = getSelectionTextRange(editor)
    if (!range) return false

    if (range.start !== range.end) {
      deletePromptRange(Math.min(range.start, range.end), Math.max(range.start, range.end))
      return true
    }

    const adjacentToken = findAdjacentPromptToken(props.value, range.start, direction)
    if (!adjacentToken) return false
    deletePromptRange(adjacentToken.start, adjacentToken.end)
    return true
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (composingRef.current || event.nativeEvent.isComposing) return
    if (!event.metaKey && !event.ctrlKey && (event.key === 'Backspace' || event.key === 'Delete')) {
      if (handleDelete(event.key === 'Backspace' ? 'backward' : 'forward')) event.preventDefault()
      return
    }
    if ((event.metaKey || event.ctrlKey) && ['z', 'y'].includes(event.key.toLowerCase())) event.preventDefault()
  }

  function handleBeforeInput(event: React.FormEvent<HTMLDivElement>) {
    if (composingRef.current || (event.nativeEvent as InputEvent).isComposing) return
    const inputType = (event.nativeEvent as InputEvent).inputType
    if (inputType !== 'deleteContentBackward' && inputType !== 'deleteContentForward') return
    if (handleDelete(inputType === 'deleteContentBackward' ? 'backward' : 'forward')) event.preventDefault()
  }

  function handlePaste(event: React.ClipboardEvent<HTMLDivElement>) {
    event.preventDefault()
    document.execCommand('insertText', false, event.clipboardData.getData('text/plain'))
  }

  return (
    <div
      ref={editorRef}
      role="textbox"
      aria-multiline="true"
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      data-placeholder={props.placeholder}
      onInput={handleInput}
      onBeforeInput={handleBeforeInput}
      onCompositionStart={() => {
        composingRef.current = true
      }}
      onCompositionEnd={() => {
        composingRef.current = false
        commitEditorValue()
      }}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      className="prompt-editor-input soft-scrollbar max-h-[42dvh] min-h-[230px] overflow-auto rounded-[12px] border border-[var(--ly-border-2)] bg-[var(--ly-bg)] px-3.5 py-3 font-mono text-[12px] leading-[1.65] text-[var(--ly-text)] shadow-[0_1px_0_rgba(255,255,255,.55)_inset] outline-none transition-[border-color,box-shadow] focus:border-[var(--ly-accent)] focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--ly-accent)_10%,transparent)]"
    />
  )
}

function OptionsApp() {
  const [settings, setSettings] = useState<LingyiSettings | null>(null)
  const [saved, setSaved] = useState(false)
  const [testResult, setTestResult] = useState('')
  const [testError, setTestError] = useState('')
  const [testing, setTesting] = useState(false)
  const [keyShown, setKeyShown] = useState(false)
  const [chromeAiMessage, setChromeAiMessage] = useState('')
  const [chromeAiProgress, setChromeAiProgress] = useState<number | null>(null)
  const [preparingChromeAi, setPreparingChromeAi] = useState(false)
  const [shortcuts, setShortcuts] = useState<Record<string, string>>(DEFAULT_SHORTCUTS)

  useEffect(() => {
    void getSettings().then(setSettings)
    void readShortcutCommands().then(setShortcuts).catch(() => setShortcuts(DEFAULT_SHORTCUTS))
  }, [])

  useEffect(() => {
    if (!settings) return
    document.title = t(settings.uiLanguage, 'optionsTitle')
    document.documentElement.lang = settings.uiLanguage
  }, [settings])

  async function patch(next: Partial<LingyiSettings>) {
    const savedSettings = await updateSettings(next)
    setSettings(savedSettings)
    setSaved(true)
    window.setTimeout(() => setSaved(false), 2200)
  }

  function updateChromeAiProgress(progress: ChromeBuiltInAiProgress) {
    setChromeAiMessage(formatChromeAiAvailability(progress.availability, settings?.uiLanguage))
    setChromeAiProgress(progress.percent ?? (progress.availability === 'available' ? 100 : null))
  }

  async function setLocalModel() {
    await patch({ provider: 'chromeBuiltIn' })
    setChromeAiMessage('')
    setChromeAiProgress(null)
    setTestError('')
    setTestResult('')
  }

  async function setThirdParty() {
    const preset = PROVIDER_PRESETS.find((item) => item.id === 'openai')!
    await patch({ provider: 'openai', baseUrl: preset.baseUrl, model: preset.model })
    setTestError('')
    setTestResult('')
  }

  async function setProvider(provider: ProviderId) {
    const preset = PROVIDER_PRESETS.find((item) => item.id === provider)
    if (!preset) return
    await patch({ provider, baseUrl: preset.baseUrl, model: preset.model })
    setTestError('')
    setTestResult('')
  }

  async function prepareLocalModel() {
    setPreparingChromeAi(true)
    setTestError('')
    setChromeAiMessage(t(settings?.uiLanguage, 'checkingGemini'))
    setChromeAiProgress(null)
    try {
      await prepareChromeBuiltInAi(updateChromeAiProgress, settings?.uiLanguage)
      setChromeAiMessage(t(settings?.uiLanguage, 'geminiReadyLong'))
      setChromeAiProgress(100)
    } catch (error) {
      setChromeAiMessage(error instanceof Error ? error.message : String(error))
      setChromeAiProgress(null)
    } finally {
      setPreparingChromeAi(false)
    }
  }

  async function runTest() {
    if (!settings) return
    setTesting(true)
    setTestError('')
    setTestResult('')
    try {
      if (isChromeBuiltInProvider(settings.provider)) {
        if (!hasChromeRuntime()) {
          setTestError(t(settings.uiLanguage, 'geminiPreviewUnavailable'))
          return
        }
        await prepareChromeBuiltInAi(updateChromeAiProgress, settings.uiLanguage)
        const result = await translateWithChromeBuiltIn({
          text: testText,
          sourceLanguage: settings.sourceLanguage,
          targetLanguage: settings.targetLanguage,
          mode: 'translate',
          uiLanguage: settings.uiLanguage,
          translatePrompt: settings.translatePrompt,
          summaryPrompt: settings.summaryPrompt,
        })
        setTestResult(result.text)
        return
      }

      if (!hasChromeRuntime()) {
        setTestResult(demoTranslate({ text: testText, sourceLanguage: settings.sourceLanguage, targetLanguage: settings.targetLanguage, mode: 'translate' }).text)
        return
      }
      const result = await sendRuntimeMessage<TranslateResult>({
        type: 'LINGYI_TRANSLATE_TEXT',
        request: {
          text: testText,
          sourceLanguage: settings.sourceLanguage,
          targetLanguage: settings.targetLanguage,
          mode: 'translate',
        },
      })
      setTestResult(result.text)
    } catch (error) {
      setTestError(error instanceof Error ? error.message : String(error))
    } finally {
      setTesting(false)
    }
  }

  if (!settings) return null

  const vars = themeVars(settings.theme)
  const isLocal = isChromeBuiltInProvider(settings.provider)
  const activePreset = PROVIDER_PRESETS.find((item) => item.id === settings.provider) ?? PROVIDER_PRESETS[0]
  const providerOptions = PROVIDER_PRESETS
    .filter((provider) => !isChromeBuiltInProvider(provider.id))
    .map((provider) => ({ value: provider.id, label: providerLabel(provider.id, settings.uiLanguage), description: providerHint(provider.id, settings.uiLanguage) }))
  const languageOptions = LANGUAGES
    .filter((language) => language !== '自动检测')
    .map((language) => ({ value: language, label: displayLanguage(language, settings.uiLanguage), description: language === settings.targetLanguage ? t(settings.uiLanguage, 'currentTargetLanguage') : undefined }))
  const uiLanguageOptions = UI_LANGUAGE_OPTIONS.map((language) => ({
    value: language.value,
    label: language.label,
    description: settings.uiLanguage === 'en-US'
      ? (language.value === 'zh-CN' ? 'Chinese interface' : 'English interface')
      : language.description,
  }))
  const promptVariables = {
    targetLanguage: settings.targetLanguage,
  }
  const promptDefaults = defaultPromptsForUiLanguage(settings.uiLanguage)

  return (
    <main style={vars} className="min-h-screen bg-[var(--ly-page)] px-4 py-6 text-[var(--ly-text)] sm:px-6 sm:py-8">
      <div className="mx-auto w-full max-w-[1180px] pb-[72px]">
        <header className="mb-6 rounded-[22px] bg-[var(--ly-bg)] px-4 py-4 shadow-[0_0_0_1px_var(--ly-border),0_8px_22px_rgba(0,0,0,.045)] sm:px-5">
          <div className="flex flex-wrap items-center gap-4">
            <Logo size={46} />
            <div className="min-w-[220px] flex-1">
              <h1 className="m-0 font-display text-[24px] font-bold leading-tight text-[var(--ly-text)] [text-wrap:balance]">{t(settings.uiLanguage, 'optionsTitle')}</h1>
              <p className="mt-1 font-mono text-[11px] font-medium leading-[1.4] text-[var(--ly-faint)]">{t(settings.uiLanguage, 'tagline')}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex min-h-9 items-center gap-2 rounded-full bg-[var(--ly-surface)] px-3 py-2 shadow-[inset_0_0_0_1px_var(--ly-border)]">
                <span className="h-2 w-2 rounded-full bg-[var(--ly-accent)] shadow-[0_0_0_4px_color-mix(in_srgb,var(--ly-accent)_14%,transparent)]" />
                <span className="text-[12px] font-semibold text-[var(--ly-text)]">{isLocal ? t(settings.uiLanguage, 'connected') : t(settings.uiLanguage, 'apiMode')}</span>
              </div>
              {saved && (
                <div className="flex min-h-9 items-center gap-1.5 rounded-full bg-[var(--ly-accent-soft)] px-3 py-2 text-[12px] font-semibold text-[var(--ly-accent-soft-ink)]">
                  <Check size={13} strokeWidth={3} />
                  {t(settings.uiLanguage, 'saved')}
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-5">
            <section className="rounded-[20px] bg-[var(--ly-bg)] p-5 shadow-[0_0_0_1px_var(--ly-border),0_10px_26px_rgba(0,0,0,.05)] sm:p-6">
              <SectionHeader
                icon={<Zap size={17} />}
                title={t(settings.uiLanguage, 'modelSectionTitle')}
                description={t(settings.uiLanguage, 'modelSectionDesc')}
              />

              <div className="grid gap-5 md:grid-cols-[320px_minmax(0,1fr)]">
                <div className="space-y-4">
                  <div className="flex gap-1 rounded-[14px] bg-[var(--ly-surface-2)] p-1 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--ly-border-2)_72%,transparent)]">
                    <Segment active={isLocal} onClick={() => void setLocalModel()}>{t(settings.uiLanguage, 'localGeminiTab')}</Segment>
                    <Segment active={!isLocal} onClick={() => void setThirdParty()}>{t(settings.uiLanguage, 'thirdPartyTab')}</Segment>
                  </div>

                  {isLocal ? (
                    <div className="rounded-[16px] bg-[var(--ly-accent-soft)] p-4 shadow-[0_0_0_1px_color-mix(in_srgb,var(--ly-accent)_32%,transparent)]">
                      <div className="mb-4 flex items-center gap-3">
                        <GeminiNanoIcon size={38} />
                        <div className="min-w-0 flex-1">
                          <div className="font-display text-[15px] font-bold text-[var(--ly-text)]">Gemini Nano</div>
                          <div className="mt-1 truncate font-mono text-[11px] font-medium text-[var(--ly-accent-soft-ink)]">
                            {t(settings.uiLanguage, 'geminiLine', { status: chromeAiProgress === 100 ? t(settings.uiLanguage, 'geminiReady') : t(settings.uiLanguage, 'geminiFirstRun') })}
                          </div>
                        </div>
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--ly-accent)] text-[var(--ly-accent-ink)]">
                          <Check size={14} strokeWidth={3} />
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {[t(settings.uiLanguage, 'localBadgeOffline'), t(settings.uiLanguage, 'localBadgePrivate'), t(settings.uiLanguage, 'localBadgeFree')].map((item) => (
                          <span key={item} className="rounded-full bg-[var(--ly-bg)] px-3 py-1.5 text-[12px] font-semibold text-[var(--ly-accent-soft-ink)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--ly-accent)_10%,transparent)]">{item}</span>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-[16px] bg-[var(--ly-surface)] p-4 shadow-[inset_0_0_0_1px_var(--ly-border)]">
                      <FieldLabel title={t(settings.uiLanguage, 'provider')} description={providerHint(activePreset.id, settings.uiLanguage)} />
                      <AnchorSelect value={settings.provider} options={providerOptions} onChange={(provider) => void setProvider(provider)} />
                    </div>
                  )}
                </div>

                {isLocal ? (
                  <div className="flex flex-col justify-between rounded-[18px] bg-[var(--ly-surface)] p-5 shadow-[inset_0_0_0_1px_var(--ly-border)]">
                    <div>
                      <div className="text-[14px] font-semibold text-[var(--ly-text)]">{t(settings.uiLanguage, 'localFirstTitle')}</div>
                      <p className="mt-2 text-[13px] leading-[1.6] text-[var(--ly-muted)] [text-wrap:pretty]">{t(settings.uiLanguage, 'localFirstDesc')}</p>
                    </div>
                    <div className="mt-5">
                      <PrimaryButton onClick={() => void prepareLocalModel()} disabled={preparingChromeAi}>
                        {preparingChromeAi ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                        {t(settings.uiLanguage, 'prepareLocalModel')}
                      </PrimaryButton>
                      {(chromeAiMessage || chromeAiProgress !== null) && (
                        <div className="mt-4">
                          <div className="h-2 overflow-hidden rounded-full bg-[var(--ly-bg)] shadow-[inset_0_0_0_1px_var(--ly-border)]">
                            <div className="h-full rounded-full bg-[var(--ly-accent)] transition-[width]" style={{ width: `${chromeAiProgress ?? 12}%` }} />
                          </div>
                          {chromeAiMessage && <p className="mt-2 text-[12px] font-medium leading-[1.55] text-[var(--ly-muted)]">{chromeAiMessage}</p>}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-4 rounded-[18px] bg-[var(--ly-surface)] p-5 shadow-[inset_0_0_0_1px_var(--ly-border)] md:grid-cols-2">
                    <div>
                      <FieldLabel title={t(settings.uiLanguage, 'modelName')} description={t(settings.uiLanguage, 'modelNameHint')} />
                      <div className="relative">
                        <Hash size={14} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--ly-faint)]" />
                        <input
                          value={settings.model}
                          onChange={(event) => void patch({ model: event.target.value })}
                          className="min-h-[54px] w-full rounded-[12px] border border-[var(--ly-border-2)] bg-[var(--ly-bg)] py-3 pl-10 pr-4 font-mono text-[14px] font-medium text-[var(--ly-text)] shadow-[0_1px_0_rgba(255,255,255,.55)_inset] outline-none transition-[border-color,box-shadow] focus:border-[var(--ly-accent)] focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--ly-accent)_10%,transparent)]"
                        />
                      </div>
                    </div>
                    <div className="md:col-span-2">
                      <FieldLabel title={t(settings.uiLanguage, 'baseUrl')} description={t(settings.uiLanguage, 'baseUrlHint')} />
                      <div className="relative">
                        <Globe2 size={15} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--ly-faint)]" />
                        <input
                          value={settings.baseUrl}
                          onChange={(event) => void patch({ baseUrl: event.target.value })}
                          placeholder={activePreset.baseUrl || 'https://api.example.com/v1'}
                          className="min-h-[54px] w-full rounded-[12px] border border-[var(--ly-border-2)] bg-[var(--ly-bg)] py-3 pl-10 pr-4 font-mono text-[14px] font-medium text-[var(--ly-text)] shadow-[0_1px_0_rgba(255,255,255,.55)_inset] outline-none transition-[border-color,box-shadow] focus:border-[var(--ly-accent)] focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--ly-accent)_10%,transparent)]"
                        />
                      </div>
                    </div>
                    <div className="md:col-span-2">
                      <div className="mb-1.5 flex items-center gap-2 whitespace-nowrap">
                        <span className="text-[13px] font-semibold text-[var(--ly-text)]">API Key</span>
                        {settings.apiKey && (
                          <span className="flex items-center gap-1 rounded-full bg-[var(--ly-accent-soft)] px-2 py-0.5 font-mono text-[10px] font-semibold text-[var(--ly-accent-soft-ink)]">
                            <Check size={9} strokeWidth={3} />{t(settings.uiLanguage, 'verified')}
                          </span>
                        )}
                      </div>
                      <div className="mb-2.5 text-[12px] font-normal leading-[1.45] text-[var(--ly-faint)]">{t(settings.uiLanguage, 'apiKeyHint')}</div>
                      <div className="relative flex min-h-[54px] items-center gap-2 rounded-[12px] border border-[var(--ly-accent)] bg-[var(--ly-accent-soft)] px-4 py-3 shadow-[0_0_0_4px_color-mix(in_srgb,var(--ly-accent)_7%,transparent)]">
                        <KeyRound size={15} className="flex-none text-[var(--ly-accent-soft-ink)]" />
                        <input
                          type={keyShown ? 'text' : 'password'}
                          value={settings.apiKey}
                          onChange={(event) => void patch({ apiKey: event.target.value })}
                          placeholder="sk-..."
                          className="min-w-0 flex-1 bg-transparent font-mono text-[14px] font-medium tracking-[.06em] text-[var(--ly-text)] outline-none placeholder:text-[var(--ly-faint)]"
                        />
                        <button type="button" onClick={() => setKeyShown(!keyShown)} className="flex h-9 w-9 items-center justify-center rounded-[9px] text-[var(--ly-accent-soft-ink)] hover:bg-[color-mix(in_srgb,var(--ly-accent)_10%,transparent)]" aria-label={keyShown ? 'Hide API key' : 'Show API key'}>
                          {keyShown ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-5 flex flex-col gap-4 rounded-[18px] bg-[var(--ly-surface)] p-4 shadow-[inset_0_0_0_1px_var(--ly-border)] sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-[var(--ly-text)]">{t(settings.uiLanguage, 'testTranslation')}</div>
                  <div className="mt-1 text-[13px] leading-[1.5] text-[var(--ly-faint)] [text-wrap:pretty]">{testText}</div>
                  {(testResult || testError) && (
                    <div className="mt-3 rounded-[12px] bg-[var(--ly-bg)] p-3 text-[13px] leading-[1.55] shadow-[inset_0_0_0_1px_var(--ly-border)]">
                      {testError ? <p className="font-semibold text-red-600">{testError}</p> : <p className="font-medium text-[var(--ly-text)]">{testResult}</p>}
                    </div>
                  )}
                </div>
                <PrimaryButton onClick={() => void runTest()} disabled={testing}>
                  {testing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  {isLocal ? t(settings.uiLanguage, 'testGemini') : t(settings.uiLanguage, 'testApi')}
                </PrimaryButton>
              </div>
            </section>

            <section className="rounded-[20px] bg-[var(--ly-bg)] p-5 shadow-[0_0_0_1px_var(--ly-border),0_10px_26px_rgba(0,0,0,.05)] sm:p-6">
              <SectionHeader
                icon={<Sparkles size={17} />}
                title={t(settings.uiLanguage, 'promptsTitle')}
                description={t(settings.uiLanguage, 'promptsDesc')}
              />
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-[18px] bg-[var(--ly-surface)] p-4 shadow-[inset_0_0_0_1px_var(--ly-border)]">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[14px] font-semibold text-[var(--ly-text)]">{t(settings.uiLanguage, 'translatePrompt')}</div>
                      <div className="mt-1 text-[12px] leading-[1.45] text-[var(--ly-faint)]">{t(settings.uiLanguage, 'translatePromptHint')}</div>
                    </div>
                    <ResetButton onClick={() => void patch({ translatePrompt: promptDefaults.translatePrompt })}>{t(settings.uiLanguage, 'resetDefault')}</ResetButton>
                  </div>
                  <PromptEditor
                    value={settings.translatePrompt}
                    variables={promptVariables}
                    onChange={(translatePrompt) => void patch({ translatePrompt })}
                    placeholder={t(settings.uiLanguage, 'translatePromptPlaceholder')}
                  />
                </div>
                <div className="rounded-[18px] bg-[var(--ly-surface)] p-4 shadow-[inset_0_0_0_1px_var(--ly-border)]">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[14px] font-semibold text-[var(--ly-text)]">{t(settings.uiLanguage, 'summaryPrompt')}</div>
                      <div className="mt-1 text-[12px] leading-[1.45] text-[var(--ly-faint)]">{t(settings.uiLanguage, 'summaryPromptHint')}</div>
                    </div>
                    <ResetButton onClick={() => void patch({ summaryPrompt: promptDefaults.summaryPrompt })}>{t(settings.uiLanguage, 'resetDefault')}</ResetButton>
                  </div>
                  <PromptEditor
                    value={settings.summaryPrompt}
                    variables={promptVariables}
                    onChange={(summaryPrompt) => void patch({ summaryPrompt })}
                    placeholder={t(settings.uiLanguage, 'summaryPromptPlaceholder')}
                  />
                </div>
              </div>
            </section>
          </div>

          <aside className="space-y-5 lg:sticky lg:top-6">
            <section className="rounded-[20px] bg-[var(--ly-bg)] p-5 shadow-[0_0_0_1px_var(--ly-border),0_10px_26px_rgba(0,0,0,.05)]">
              <SectionHeader
                icon={<Palette size={17} />}
                title={t(settings.uiLanguage, 'themeTitle')}
                description={t(settings.uiLanguage, 'themeDesc')}
              />
              <div className="grid gap-2.5">
                {(['lucid', 'halo', 'sage'] as const).map((themeId) => {
                  const active = settings.theme === themeId
                  return (
                    <button
                      key={themeId}
                      type="button"
                      onClick={() => void patch({ theme: themeId })}
                      className={`flex min-h-[64px] items-center justify-between gap-3 rounded-[14px] px-4 py-3 text-left transition-[background-color,box-shadow,transform] ${active ? 'bg-[var(--ly-accent-soft)] shadow-[0_0_0_1px_var(--ly-accent)]' : 'bg-[var(--ly-surface)] shadow-[inset_0_0_0_1px_var(--ly-border)] hover:shadow-[inset_0_0_0_1px_var(--ly-border-2)]'}`}
                    >
                      <span className="min-w-0">
                        <span className="block text-[14px] font-semibold text-[var(--ly-text)]">{THEMES[themeId].name}</span>
                        <span className="mt-1 block truncate font-mono text-[11px] font-medium text-[var(--ly-faint)]">{THEMES[themeId].accent} · {themeDescription(themeId, settings.uiLanguage)}</span>
                      </span>
                      <span className="flex flex-none items-center gap-2.5">
                        {active && <span className="text-[11px] font-semibold text-[var(--ly-accent-soft-ink)]">{t(settings.uiLanguage, 'current')}</span>}
                        <span className="h-5 w-5 rounded-full shadow-[0_0_0_1px_rgba(0,0,0,.10)_inset]" style={{ background: THEMES[themeId].dot }} />
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>

            <section className="rounded-[20px] bg-[var(--ly-bg)] p-5 shadow-[0_0_0_1px_var(--ly-border),0_10px_26px_rgba(0,0,0,.05)]">
              <SectionHeader
                icon={<Languages size={17} />}
                title={t(settings.uiLanguage, 'languageEntryTitle')}
                description={t(settings.uiLanguage, 'languageEntryDesc')}
              />
              <div className="space-y-4">
                <div>
                  <div className="mb-2 text-[13px] font-semibold text-[var(--ly-text)]">{t(settings.uiLanguage, 'targetLanguage')}</div>
                  <AnchorSelect value={settings.targetLanguage} options={languageOptions} onChange={(targetLanguage) => void patch({ targetLanguage })} />
                </div>
                <div>
                  <div className="mb-2 text-[13px] font-semibold text-[var(--ly-text)]">{t(settings.uiLanguage, 'uiLanguage')}</div>
                  <AnchorSelect value={settings.uiLanguage} options={uiLanguageOptions} onChange={(uiLanguage) => void patch({ uiLanguage: uiLanguage as UiLanguage })} />
                  <div className="mt-2 text-[12px] leading-[1.45] text-[var(--ly-faint)]">{t(settings.uiLanguage, 'uiLanguageDesc')}</div>
                </div>
                <div className="rounded-[16px] bg-[var(--ly-surface)] p-4 shadow-[inset_0_0_0_1px_var(--ly-border)]">
                  <SettingRow title={t(settings.uiLanguage, 'selectionBubble')} description={t(settings.uiLanguage, 'selectionBubbleDesc')}>
                    <Switch checked={settings.selectionBubble} onChange={(selectionBubble) => void patch({ selectionBubble })} />
                  </SettingRow>
                  <SettingRow title={t(settings.uiLanguage, 'contextMenuTranslation')} description={t(settings.uiLanguage, 'contextMenuDesc')}>
                    <Switch checked={settings.contextMenu} onChange={(contextMenu) => void patch({ contextMenu })} />
                  </SettingRow>
                  <SettingRow title={t(settings.uiLanguage, 'autoSummary')} description={t(settings.uiLanguage, 'autoSummaryDesc')}>
                    <Switch checked={settings.autoSummary} onChange={(autoSummary) => void patch({ autoSummary })} />
                  </SettingRow>
                </div>
              </div>
            </section>

            <section className="rounded-[20px] bg-[var(--ly-bg)] p-5 shadow-[0_0_0_1px_var(--ly-border),0_10px_26px_rgba(0,0,0,.05)]">
              <SectionHeader
                icon={<Keyboard size={17} />}
                title={t(settings.uiLanguage, 'shortcutsTitle')}
                description={t(settings.uiLanguage, 'shortcutsDesc')}
              />
              <div className="space-y-2.5">
                {[
                  ['lingyi-translate-page', t(settings.uiLanguage, 'shortcutTranslatePage')],
                  ['lingyi-summary-page', t(settings.uiLanguage, 'shortcutSummaryPage')],
                ].map(([command, label]) => {
                  const keys = parseShortcutKeys(shortcuts[command] ?? '')
                  return (
                    <div key={command} className="flex min-h-[52px] items-center justify-between gap-3 rounded-[14px] bg-[var(--ly-surface)] px-3.5 py-3 shadow-[inset_0_0_0_1px_var(--ly-border)]">
                      <span className="min-w-0 flex-1 text-[13px] font-semibold text-[var(--ly-text)]">{label}</span>
                      <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
                        {keys.length ? keys.map((key) => (
                          <kbd key={key} className="inline-flex h-[24px] min-w-[27px] shrink-0 items-center justify-center rounded-[7px] bg-[var(--ly-bg)] px-[7px] text-center font-mono text-[10px] font-bold leading-none text-[var(--ly-muted)] shadow-[0_0_0_1px_var(--ly-border-2),0_2px_0_color-mix(in_srgb,var(--ly-border-2)_88%,#b7a895),0_4px_8px_rgba(55,39,25,.10),0_1px_0_rgba(255,255,255,.92)_inset]">{formatShortcutKey(key)}</kbd>
                        )) : (
                          <span className="rounded-[8px] bg-[var(--ly-bg)] px-2.5 py-1.5 font-mono text-[10px] font-bold text-[var(--ly-faint)] shadow-[inset_0_0_0_1px_var(--ly-border-2)]">{t(settings.uiLanguage, 'shortcutUnassigned')}</span>
                        )}
                      </span>
                    </div>
                  )
                })}
              </div>
              <div className="mt-3 rounded-[14px] bg-[var(--ly-surface)] px-3 py-2.5 text-[12px] leading-[1.5] text-[var(--ly-faint)] shadow-[inset_0_0_0_1px_var(--ly-border)]">
                {t(settings.uiLanguage, 'shortcutsHelpBefore')}{' '}
                <button type="button" onClick={openShortcutSettings} className="font-semibold text-[var(--ly-accent-soft-ink)] underline decoration-[color-mix(in_srgb,var(--ly-accent)_35%,transparent)] underline-offset-2 hover:text-[var(--ly-accent)]">
                  {SHORTCUT_SETTINGS_URL}
                </button>
                {' '}{t(settings.uiLanguage, 'shortcutsHelpAfter')}
              </div>
            </section>
          </aside>
        </div>

        <div className={`pointer-events-none fixed left-1/2 bottom-[26px] z-30 flex -translate-x-1/2 items-center gap-[9px] rounded-full bg-[var(--ly-text)] py-[11px] pl-[13px] pr-[18px] text-[13px] font-semibold text-[var(--ly-bg)] shadow-[0_10px_28px_rgba(0,0,0,.24)] transition-all duration-300 ${saved ? 'translate-y-0 opacity-100' : 'translate-y-[14px] opacity-0'}`}>
          <span className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full bg-[var(--ly-accent)] text-[var(--ly-accent-ink)]">
            <Check size={11} strokeWidth={3.4} />
          </span>
          <span>{t(settings.uiLanguage, 'saved')}</span>
          <span className="font-medium opacity-60">{t(settings.uiLanguage, 'savedHint')}</span>
        </div>
      </div>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <OptionsApp />
  </React.StrictMode>,
)
