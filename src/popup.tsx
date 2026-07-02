import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  BookOpenText,
  Check,
  ChevronDown,
  ChevronUp,
  Columns2,
  FileText,
  Loader2,
  Search,
  Settings,
} from 'lucide-react'
import './index.css'
import { demoTranslate } from './ai'
import { isChromeBuiltInProvider } from './chrome-built-in'
import { compactLanguage, displayLanguage, t } from './i18n'
import { sendRuntimeMessage, sendTabMessage, type PageTranslateMode } from './messages'
import { getSettings, updateSettings } from './storage'
import { THEMES, themeVars } from './theme'
import { LANGUAGES, type LingyiSettings } from './types'

const sampleText = 'They harvest energy from chemical reactions near hydrothermal vents.'
type LanguageSide = 'target'
type PageMode = PageTranslateMode

function hasChromeRuntime() {
  return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.sendMessage)
}

function isSupportedTabUrl(url: string | undefined) {
  return Boolean(url?.startsWith('http://') || url?.startsWith('https://'))
}

function formatContentScriptError(tab: chrome.tabs.Tab, uiLanguage: LingyiSettings['uiLanguage'], error?: unknown) {
  const detail = error instanceof Error ? error.message : String(error ?? '')
  const host = tab.url ? new URL(tab.url).hostname : ''
  const urlHint = host ? (uiLanguage === 'en-US' ? ` (${host})` : `（${host}）`) : ''
  if (detail.includes('Cannot access') || detail.includes('extensions gallery') || detail.includes('chrome://')) {
    return t(uiLanguage, 'unsupportedInjectionBlocked', { host: urlHint })
  }
  return t(uiLanguage, 'unsupportedConnection', { host: urlHint })
}

function getAppIconUrl() {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) return chrome.runtime.getURL('icons/icon-128.png')
  return '/icons/icon-128.png'
}

async function getActiveTab() {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) return null
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab ?? null
}

async function ensureContentScript(tab: chrome.tabs.Tab, uiLanguage: LingyiSettings['uiLanguage']) {
  if (!tab.id) throw new Error(t(uiLanguage, 'noActivePage'))
  if (!isSupportedTabUrl(tab.url)) {
    throw new Error(t(uiLanguage, 'unsupportedPage'))
  }
  if (tab.status === 'loading') {
    throw new Error(t(uiLanguage, 'pageLoading'))
  }

  try {
    await sendTabMessage<boolean>(tab.id, { type: 'LINGYI_PING_CONTENT' })
    return
  } catch (firstError) {
    if (!chrome.scripting?.executeScript) throw new Error(t(uiLanguage, 'dynamicInjectionUnsupported'))
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js'],
      })
    } catch (injectionError) {
      throw new Error(formatContentScriptError(tab, uiLanguage, injectionError), { cause: injectionError })
    }
    await new Promise((resolve) => window.setTimeout(resolve, 80))
    try {
      await sendTabMessage<boolean>(tab.id, { type: 'LINGYI_PING_CONTENT' })
    } catch (retryError) {
      throw new Error(formatContentScriptError(tab, uiLanguage, retryError ?? firstError), { cause: retryError })
    }
  }
}

async function getActivePageText(uiLanguage: LingyiSettings['uiLanguage']) {
  const tab = await getActiveTab()
  if (!tab?.id) return sampleText
  await ensureContentScript(tab, uiLanguage)
  return sendTabMessage<string>(tab.id, { type: 'LINGYI_COLLECT_PAGE_TEXT' })
}

function Logo(props: { size?: number }) {
  const size = props.size ?? 36
  return (
    <img
      src={getAppIconUrl()}
      alt=""
      className="block flex-none shadow-[0_10px_22px_rgba(30,64,175,.18),0_1px_2px_rgba(17,24,39,.12)] outline outline-1 -outline-offset-1 outline-black/10"
      style={{ width: size, height: size, borderRadius: Math.max(9, Math.round(size * 0.22)) }}
    />
  )
}

function LanguageDropdown(props: {
  side: LanguageSide
  value: string
  uiLanguage: LingyiSettings['uiLanguage']
  onPick: (language: string) => void
}) {
  const [query, setQuery] = useState('')
  const normalizedValue = displayLanguage(props.value, props.uiLanguage)
  const languages = LANGUAGES
    .map((language) => ({ value: language, label: displayLanguage(language, props.uiLanguage) }))
    .filter((language) => language.value !== '自动检测')
    .filter((language) => language.label.toLowerCase().includes(query.trim().toLowerCase()))
  const pinned = languages.filter((language) => ['中文', 'English', '日本語'].includes(language.value))
  const rest = languages.filter((language) => !pinned.includes(language))

  function pick(language: { value: string }) {
    props.onPick(language.value)
  }

  function Row(props: { language: { value: string; label: string }; pinned?: boolean }) {
    const active = normalizedValue === props.language.label
    return (
      <button
        type="button"
        onClick={() => pick(props.language)}
        className={`flex min-h-10 w-full items-center justify-between rounded-[10px] px-[12px] py-[9px] text-left transition-[background-color,color,box-shadow] ${active ? 'bg-[var(--ly-surface)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--ly-accent)_14%,transparent)]' : 'hover:bg-[var(--ly-surface)]'}`}
      >
        <span className={`${props.pinned ? 'font-semibold' : 'font-medium'} text-[14px] text-[var(--ly-text)]`}>{props.language.label}</span>
        {active && <Check size={14} strokeWidth={3} className="text-[var(--ly-accent)]" />}
      </button>
    )
  }

  return (
    <div className="mt-2 overflow-hidden rounded-[16px] bg-[var(--ly-bg)] shadow-[0_0_0_1px_var(--ly-border),0_14px_30px_rgba(38,27,18,.10),0_1px_0_rgba(255,255,255,.72)_inset]">
      <div className="flex items-center gap-[9px] border-b border-[var(--ly-border)] px-[14px] py-[11px] text-[var(--ly-faint)]">
        <Search size={14} strokeWidth={2.2} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t(props.uiLanguage, 'searchLanguage')}
          className="min-w-0 flex-1 bg-transparent text-[13px] font-normal text-[var(--ly-text)] outline-none placeholder:text-[var(--ly-faint)]"
          autoFocus
        />
      </div>
      <div className="soft-scrollbar max-h-[228px] overflow-auto">
        <div className="px-[14px] pb-1 pt-[10px] font-mono text-[11px] font-semibold text-[var(--ly-faint)]">{t(props.uiLanguage, 'myLanguages')}</div>
        <div className="px-2">{pinned.map((language) => <Row key={language.value} language={language} pinned />)}</div>
        {rest.length > 0 && (
          <>
            <div className="mx-[14px] my-[5px] h-px bg-[var(--ly-border)]" />
            <div className="px-[14px] pb-1 pt-[5px] font-mono text-[11px] font-semibold text-[var(--ly-faint)]">{t(props.uiLanguage, 'allLanguages')}</div>
            <div className="px-2">{rest.map((language) => <Row key={language.value} language={language} />)}</div>
            <div className="h-1.5" />
          </>
        )}
      </div>
    </div>
  )
}

function ActionButton(props: {
  busy?: boolean
  disabled?: boolean
  children: React.ReactNode
  icon: React.ReactNode
  onClick: () => void
  tone?: 'primary' | 'secondary'
}) {
  const tone = props.tone ?? 'secondary'
  const className = tone === 'primary'
    ? 'flex min-h-[46px] w-full items-center justify-center gap-2 rounded-[13px] [background:var(--ly-accent-grad)] px-3 py-2.5 text-center text-[13px] font-bold text-[var(--ly-accent-ink)] shadow-[var(--ly-glow),0_1px_0_rgba(255,255,255,.24)_inset] transition-[background-color,box-shadow,color,transform,opacity,filter] hover:brightness-[1.03] disabled:opacity-70'
    : 'flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-[13px] bg-[var(--ly-bg)] px-3 py-2.5 text-center text-[12px] font-bold text-[var(--ly-text)] shadow-[0_0_0_1px_var(--ly-border),0_5px_14px_rgba(38,27,18,.06),0_1px_0_rgba(255,255,255,.72)_inset] transition-[background-color,box-shadow,color,transform,opacity] hover:bg-[var(--ly-surface)] hover:shadow-[0_0_0_1px_var(--ly-border-2),0_8px_18px_rgba(38,27,18,.08),0_1px_0_rgba(255,255,255,.72)_inset] disabled:opacity-70'
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled || props.busy}
      className={className}
    >
      <span className="flex h-[16px] w-[16px] flex-none items-center justify-center">
        {props.busy ? <Loader2 size={16} className="animate-spin" /> : props.icon}
      </span>
      <span className="min-w-0 whitespace-nowrap">{props.children}</span>
    </button>
  )
}

function PopupApp() {
  const [settings, setSettings] = useState<LingyiSettings | null>(null)
  const [openLanguage, setOpenLanguage] = useState<LanguageSide | null>(null)
  const [result, setResult] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [busyMode, setBusyMode] = useState<PageMode | null>(null)

  useEffect(() => {
    void getSettings().then((next) => {
      setSettings(next)
    })
  }, [])

  useEffect(() => {
    document.documentElement.classList.add('ly-popup-document')
    return () => document.documentElement.classList.remove('ly-popup-document')
  }, [])

  useEffect(() => {
    if (!settings) return
    document.title = t(settings.uiLanguage, 'appName')
    document.documentElement.lang = settings.uiLanguage
  }, [settings])

  const theme = settings ? THEMES[settings.theme] : THEMES.lucid
  const vars = settings ? themeVars(settings.theme) : themeVars('lucid')
  const isLocalModel = isChromeBuiltInProvider(settings?.provider)
  const isReady = Boolean(isLocalModel || (settings?.apiKey.trim() && settings.model.trim() && settings.baseUrl.trim()))

  const modelLabel = useMemo(() => {
    if (!settings) return t('zh-CN', 'localNano')
    if (isChromeBuiltInProvider(settings.provider)) return t(settings.uiLanguage, 'localNano')
    return t(settings.uiLanguage, 'thirdPartyApi')
  }, [settings])

  async function setTargetLanguage(language: string) {
    const next = await updateSettings({ targetLanguage: language })
    setSettings(next)
    setOpenLanguage(null)
    setResult('')
    setError('')
  }

  async function executePageAction(nextMode: PageMode) {
    if (!settings) return
    setBusy(true)
    setBusyMode(nextMode)
    setError('')
    setResult('')
    setOpenLanguage(null)
    try {
      const activeSettings = nextMode !== 'summary'
        ? await updateSettings({ pageTranslationMode: nextMode })
        : settings
      if (nextMode !== 'summary') {
        setSettings(activeSettings)
      }
      if (nextMode === 'summary') {
        if (!hasChromeRuntime()) throw new Error(t(activeSettings.uiLanguage, 'dynamicInjectionUnsupported'))
        const tab = await getActiveTab()
        if (!tab?.id) throw new Error(t(activeSettings.uiLanguage, 'noActivePage'))
        await ensureContentScript(tab, activeSettings.uiLanguage)
        void sendRuntimeMessage<boolean>({ type: 'LINGYI_SUMMARIZE_PAGE', tabId: tab.id }).catch(() => undefined)
        window.close()
        return
      }
      if (!hasChromeRuntime()) {
        const text = await getActivePageText(activeSettings.uiLanguage)
        setResult(demoTranslate({ text, sourceLanguage: activeSettings.sourceLanguage, targetLanguage: activeSettings.targetLanguage, mode: 'translate' }).text)
        return
      }
      const tab = await getActiveTab()
      if (!tab?.id) throw new Error(t(activeSettings.uiLanguage, 'noActivePage'))
      await ensureContentScript(tab, activeSettings.uiLanguage)
      const status = await sendTabMessage<{ queued: number; message: string }>(tab.id, {
        type: 'LINGYI_TRANSLATE_VISIBLE_PAGE',
        mode: nextMode,
        sourceLanguage: activeSettings.sourceLanguage,
        targetLanguage: activeSettings.targetLanguage,
        uiLanguage: activeSettings.uiLanguage,
      })
      setResult(status.message || t(activeSettings.uiLanguage, 'pageTranslationStarted', { count: status.queued }))
      window.close()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      setBusyMode(null)
    }
  }

  function openOptions() {
    if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage) {
      void chrome.runtime.openOptionsPage()
    } else {
      window.location.href = '/options.html'
    }
  }

  if (!settings) return null
  const showFeedbackPanel = Boolean(error || busy || result)

  return (
    <main style={vars} className="w-[360px] overflow-hidden bg-[var(--ly-page)] p-0 text-[var(--ly-text)]">
      <section className="overflow-hidden rounded-[18px] bg-[var(--ly-bg)] shadow-[var(--ly-shadow)]">
        <header className="flex items-center gap-3 px-[15px] py-[14px] shadow-[inset_0_-1px_0_var(--ly-border)]">
          <Logo size={34} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="font-display text-[16px] font-bold text-[var(--ly-text)] text-balance">{t(settings.uiLanguage, 'appName')}</h1>
              <span className="rounded-[5px] border border-[var(--ly-border-2)] px-1.5 py-px font-mono text-[10px] font-semibold text-[var(--ly-faint)]">v1.2</span>
            </div>
            <p className="mt-[3px] font-mono text-[11px] font-medium leading-[1.3] text-[var(--ly-faint)]">
              {isLocalModel ? t(settings.uiLanguage, 'localModelLine') : t(settings.uiLanguage, 'cloudModelLine')}
            </p>
          </div>
          <div className="flex items-center gap-1.5 rounded-full bg-[var(--ly-surface)] px-[10px] py-[5px] shadow-[inset_0_0_0_1px_var(--ly-border)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--ly-accent)]" />
            <span className="text-[11px] font-semibold text-[var(--ly-accent-soft-ink)]">{isLocalModel ? t(settings.uiLanguage, 'offlineAvailable') : t(settings.uiLanguage, 'connected')}</span>
          </div>
        </header>

        <div className="px-[15px] pt-[14px]">
          <div>
            <div className="flex items-center gap-[9px]">
              <div className="flex min-h-[42px] flex-1 items-center justify-between rounded-[12px] bg-[var(--ly-surface)] px-[13px] py-[9px] shadow-[inset_0_0_0_1px_var(--ly-border)]">
                <span className="truncate text-[14px] font-semibold text-[var(--ly-text)]">{t(settings.uiLanguage, 'sourceAuto')}</span>
                <span className="ml-2 font-mono text-[10px] font-semibold text-[var(--ly-faint)]">{t(settings.uiLanguage, 'autoCode')}</span>
              </div>
              <button
                type="button"
                onClick={() => setOpenLanguage(openLanguage === 'target' ? null : 'target')}
                className={`flex min-h-[42px] flex-1 items-center justify-between rounded-[12px] bg-[var(--ly-bg)] px-[13px] py-[9px] transition-[background-color,box-shadow,transform] hover:bg-[var(--ly-surface)] ${openLanguage === 'target' ? 'shadow-[0_0_0_1px_var(--ly-accent),0_4px_12px_rgba(38,27,18,.05),0_1px_0_rgba(255,255,255,.7)_inset]' : 'shadow-[0_0_0_1px_var(--ly-border-2),0_4px_12px_rgba(38,27,18,.05),0_1px_0_rgba(255,255,255,.7)_inset]'}`}
              >
                <span className="truncate text-[14px] font-semibold text-[var(--ly-accent-soft-ink)]">{compactLanguage(settings.targetLanguage, settings.uiLanguage)}</span>
                {openLanguage === 'target' ? <ChevronUp size={14} className="text-[var(--ly-accent-soft-ink)]" /> : <ChevronDown size={14} className="text-[var(--ly-accent-soft-ink)]" />}
              </button>
            </div>
            {openLanguage === 'target' && <LanguageDropdown side="target" value={settings.targetLanguage} uiLanguage={settings.uiLanguage} onPick={(language) => void setTargetLanguage(language)} />}
          </div>

          <div className="mt-[12px] rounded-[16px] bg-[var(--ly-surface)] p-2 shadow-[inset_0_0_0_1px_var(--ly-border)]">
            <ActionButton
              tone="primary"
              busy={busyMode === 'replace'}
              disabled={busy}
              icon={<FileText size={16} strokeWidth={2.2} />}
              onClick={() => void executePageAction('replace')}
            >
              {t(settings.uiLanguage, 'pageActionReplace')}
            </ActionButton>
            <div className="mt-2 flex gap-2">
              <ActionButton
                busy={busyMode === 'parallel'}
                disabled={busy}
                icon={<Columns2 size={16} strokeWidth={2.2} />}
                onClick={() => void executePageAction('parallel')}
              >
                {t(settings.uiLanguage, 'pageActionParallel')}
              </ActionButton>
              <ActionButton
                busy={busyMode === 'summary'}
                disabled={busy}
                icon={<BookOpenText size={16} strokeWidth={2.2} />}
                onClick={() => void executePageAction('summary')}
              >
                {t(settings.uiLanguage, 'pageActionSummary')}
              </ActionButton>
            </div>
          </div>
        </div>

        {!isReady && (
          <button
            type="button"
            onClick={openOptions}
            className="mx-[18px] mt-4 w-[calc(100%-36px)] rounded-[var(--ly-radius-sm)] border border-[var(--ly-border-2)] bg-[var(--ly-accent-soft)] px-[14px] py-[11px] text-left text-[12px] font-semibold leading-5 text-[var(--ly-accent-soft-ink)]"
          >
            {t(settings.uiLanguage, 'missingApiConfig')}
          </button>
        )}

        {showFeedbackPanel && (
          <div className="mx-[15px] mt-[13px] rounded-[var(--ly-radius-sm)] bg-[var(--ly-surface)] p-[13px] shadow-[inset_0_0_0_1px_var(--ly-border)]">
            {error && <p className="m-0 text-[12px] font-semibold leading-5 text-red-600">{error}</p>}
            {!error && busy && (
              <div className="flex items-center gap-[9px]">
                <span className="h-[18px] w-[18px] animate-spin rounded-full border-2 border-[var(--ly-surface-2)] border-t-[var(--ly-accent)]" />
                <span className="text-[12px] font-semibold text-[var(--ly-accent-soft-ink)]">{isLocalModel ? t(settings.uiLanguage, 'localThinking') : t(settings.uiLanguage, 'cloudThinking')}</span>
              </div>
            )}
            {!error && !busy && result && (
              <div className="flex items-start gap-[9px]">
                <span className="mt-[1px] flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full bg-[var(--ly-accent-soft)] text-[var(--ly-accent-soft-ink)]">
                  <Check size={12} strokeWidth={3} />
                </span>
                <p className="m-0 text-[13px] leading-[1.6] text-[var(--ly-muted)] text-pretty">{result}</p>
              </div>
            )}
          </div>
        )}

        <footer className="mt-[13px] flex items-center justify-between px-[15px] py-[12px] shadow-[inset_0_1px_0_var(--ly-border)]">
          <p className="m-0 text-[11px] font-semibold text-[var(--ly-faint)]">{t(settings.uiLanguage, 'currentPrefix')}: {theme.name} · {modelLabel}</p>
          <button type="button" onClick={openOptions} className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--ly-faint)]">
            <Settings size={13} />
            {t(settings.uiLanguage, 'settings')}
          </button>
        </footer>
      </section>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PopupApp />
  </React.StrictMode>,
)
