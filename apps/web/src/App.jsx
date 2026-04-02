import { startTransition, useEffect, useRef, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import BrowserVoicePanel from './components/BrowserVoicePanel'
import { getBrowserVoiceConfig, isBrowserVoiceConfigured } from './lib/browserVoiceConfig.js'

const httpProtocol = window.location.protocol === 'https:' ? 'https:' : 'http:'
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '')
const apiBaseUrl = configuredApiBaseUrl || `${httpProtocol}//${window.location.hostname}:8000`
const metricsSocketUrl = new URL(`${apiBaseUrl}/ws/metrics`)
metricsSocketUrl.protocol = wsProtocol
const wsUrl = metricsSocketUrl.toString()
const sessionStorageKey = 'dialer-cloud-session'

const emptySnapshot = {
  active_calls: 0,
  agents_ready: 0,
  queue: 0,
  answer_rate: 0,
  abandon_rate: 0,
  campaigns_live: 0,
}

const defaultLoginForm = {
  email: '',
  password: '',
}

const defaultSignupForm = {
  tenantName: '',
  timezone: 'Asia/Kolkata',
  adminFullName: '',
  adminEmail: '',
  password: '',
}

const defaultCampaignForm = {
  name: '',
  dialingMode: 'predictive',
  maxConcurrentLines: 10,
  retryAttempts: 3,
  callerId: '1000',
}

const viewDefinitions = {
  homePage: {
    module: 'home',
    title: 'Home Page',
    breadcrumb: ['Home Page'],
    description: 'Choose the workspace you want to enter from this top-level home screen.',
    searchPlaceholder: 'Search workspaces',
  },
  overview: {
    module: 'home',
    title: 'System Administrator',
    breadcrumb: ['Home Page', 'System Administrator'],
    description: 'Choose an operation area and enter the related workspace from this category dashboard.',
    searchPlaceholder: 'Search features',
  },
  dialer: {
    module: 'call',
    title: 'Dialer Console',
    breadcrumb: ['Home Page', 'System Administrator', 'Call', 'Dialer Console'],
    description: 'Use the browser SIP.js panel for live microphone calls from this tab.',
    searchPlaceholder: 'Search browser voice settings',
  },
  campaigns: {
    module: 'call',
    title: 'Campaigns',
    breadcrumb: ['Home Page', 'System Administrator', 'Call', 'Campaigns'],
    description: 'Create and manage campaigns in this module. You can control settings, caller ID, and lifecycle here.',
    searchPlaceholder: 'Search campaigns',
  },
  activity: {
    module: 'call',
    title: 'Activity',
    breadcrumb: ['Home Page', 'System Administrator', 'Call', 'Activity'],
    description: 'Review the live operational pulse and queue movement without leaving the main workspace.',
    searchPlaceholder: 'Search metrics or queue data',
  },
  readiness: {
    module: 'settings',
    title: 'Workspace Settings',
    breadcrumb: ['Home Page', 'System Administrator', 'Workspace'],
    description: 'Keep account status, voice prerequisites, and deployment readiness checks in one place.',
    searchPlaceholder: 'Search settings or readiness',
  },
}

const breadcrumbTargets = {
  'Home Page': 'homePage',
  'System Administrator': 'overview',
  Call: 'dialer',
  Workspace: 'readiness',
  'Dialer Console': 'dialer',
  Campaigns: 'campaigns',
  Activity: 'activity',
}

const moduleDefinitions = {
  home: {
    title: 'Home Page',
    description: 'Enter the administration workspace from this top-level launch area.',
    items: [
      {
        id: 'homePage',
        label: 'Home Page',
        description: 'Return to the main landing screen for the workspace.',
      },
      {
        id: 'overview',
        label: 'System Administrator',
        description: 'Operational dashboard for calls, campaigns, activity, and workspace settings.',
      },
    ],
  },
  call: {
    title: 'Call',
    description: 'You can perform browser SIP calling and campaign configuration from this module.',
    items: [
      {
        id: 'dialer',
        label: 'Dialer Console',
        description: 'Browser voice and SIP registration.',
      },
      {
        id: 'campaigns',
        label: 'Campaigns',
        description: 'Campaign list, creation, and status control.',
      },
      {
        id: 'activity',
        label: 'Activity',
        description: 'Live queue movement and trend tracking.',
      },
    ],
  },
  settings: {
    title: 'Workspace',
    description: 'Account, readiness, and external voice deployment checks.',
    items: [
      {
        id: 'readiness',
        label: 'Readiness',
        description: 'Session details, voice prerequisites, and environment checks.',
      },
    ],
  },
}

const overviewCards = [
  {
    id: 'dialer',
    label: 'Call Console',
    description: 'Open the browser softphone and place live calls from the tab.',
    accent: 'teal',
  },
  {
    id: 'campaigns',
    label: 'Campaigns',
    description: 'Create and manage campaigns with separate configuration and control entry points.',
    accent: 'orange',
  },
  {
    id: 'activity',
    label: 'Activity',
    description: 'Monitor live queue movement and the metrics-driven trend line.',
    accent: 'navy',
  },
  {
    id: 'readiness',
    label: 'Workspace',
    description: 'Track readiness, settings, and the account session from a dedicated configuration area.',
    accent: 'rose',
  },
]

const prerequisiteChecklist = [
  {
    title: 'Provision a real SIP trunk',
    detail:
      'Configure the trunk on your external Asterisk server so calls from the browser can reach their destination.',
  },
  {
    title: 'Register the browser SIP endpoint',
    detail:
      'Use VITE_SIP_URI, VITE_SIP_PASSWORD, and VITE_SIP_WS_URL so SIP.js can register the browser directly against your external Asterisk WebSocket.',
  },
  {
    title: 'Open the browser media path',
    detail:
      'Set the browser endpoint for WebRTC, keep direct_media off, and allow the RTP UDP range so Asterisk can pass audio both ways.',
  },
]

const authTiles = [
  'System Administrator',
  'Agent',
  'Supervisor',
  'Reporting',
  'Quality Control',
]

const keypadRows = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['+', '0', '#'],
]

function cx(...values) {
  return values.filter(Boolean).join(' ')
}

function formatPercent(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`
}

function formatClock(value) {
  if (!value) {
    return '--:--'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '--:--'
  }

  return new Intl.DateTimeFormat([], {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function formatDateTime(value) {
  if (!value) {
    return 'Pending'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return 'Pending'
  }

  return new Intl.DateTimeFormat([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function formatTime(now) {
  return new Intl.DateTimeFormat([], {
    hour: '2-digit',
    minute: '2-digit',
  }).format(now)
}

function formatLongDate(now) {
  return new Intl.DateTimeFormat([], {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(now)
}

function getGreeting(now) {
  const hour = now.getHours()
  if (hour < 12) {
    return 'Good Morning'
  }
  if (hour < 18) {
    return 'Good Afternoon'
  }
  return 'Good Evening'
}

function normalizeStatus(value) {
  return String(value || 'unknown')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

function getInitials(value) {
  return String(value || 'User')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

function buildApiUrl(path, params = {}) {
  const url = new URL(`${apiBaseUrl}${path}`)
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  })
  return url.toString()
}

function buildHeaders(token, includeJson = false) {
  const headers = {}
  if (includeJson) {
    headers['Content-Type'] = 'application/json'
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  return headers
}

function readStoredSession() {
  try {
    const raw = window.localStorage.getItem(sessionStorageKey)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function persistSession(token, user) {
  try {
    if (token && user) {
      window.localStorage.setItem(sessionStorageKey, JSON.stringify({ token, user }))
      return
    }
    window.localStorage.removeItem(sessionStorageKey)
  } catch {
    // Ignore localStorage failures in restricted browsers.
  }
}

function getConnectionTone(state) {
  if (state === 'live') {
    return 'teal'
  }
  if (state === 'connecting' || state === 'reconnecting') {
    return 'amber'
  }
  if (state === 'degraded') {
    return 'rose'
  }
  return 'slate'
}

function getTelephonyTone(status) {
  if (status === 'ok') {
    return 'teal'
  }
  if (status === 'degraded') {
    return 'amber'
  }
  if (status === 'offline') {
    return 'rose'
  }
  return 'slate'
}

function getCallTone(status) {
  switch (status) {
    case 'originated':
    case 'bridged':
    case 'answered':
    case 'completed':
      return 'teal'
    case 'dialing':
    case 'queued':
    case 'ringing':
      return 'amber'
    case 'failed':
    case 'abandoned':
      return 'rose'
    default:
      return 'slate'
  }
}

function AppIcon({ name }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    strokeWidth: 1.8,
  }

  switch (name) {
    case 'home':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path {...common} d="M4 11.5 12 5l8 6.5" />
          <path {...common} d="M6.5 10.5V19h11v-8.5" />
        </svg>
      )
    case 'phone':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path {...common} d="M8.4 5.7c.6-1 1.9-1.3 2.9-.7l1.3.8c.9.5 1.3 1.6.9 2.6l-.8 2c-.2.5-.1 1 .2 1.4l1.9 1.9c.4.4 1 .5 1.4.2l2-.8c1-.4 2.1 0 2.6.9l.8 1.3c.6 1 .3 2.3-.7 2.9l-1 .6c-1.2.7-2.7.8-4 .2-2.3-1.1-4.5-2.7-6.4-4.6-1.9-1.9-3.5-4.1-4.6-6.4-.6-1.3-.5-2.8.2-4l.6-1Z" />
        </svg>
      )
    case 'campaign':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect {...common} x="4" y="5" width="16" height="14" rx="2.5" />
          <path {...common} d="M8 9h8M8 13h6M8 17h4" />
        </svg>
      )
    case 'activity':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path {...common} d="M4 14h3l2-5 4 10 3-7h4" />
        </svg>
      )
    case 'settings':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path {...common} d="m12 3 1.2 2.2 2.5.5.7 2.4 2 1.6-.8 2.4.8 2.4-2 1.6-.7 2.4-2.5.5L12 21l-1.2-2.2-2.5-.5-.7-2.4-2-1.6.8-2.4-.8-2.4 2-1.6.7-2.4 2.5-.5L12 3Z" />
          <circle {...common} cx="12" cy="12" r="3.2" />
        </svg>
      )
    case 'workspace':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect {...common} x="4" y="4.5" width="7" height="7" rx="1.8" />
          <rect {...common} x="13" y="4.5" width="7" height="7" rx="1.8" />
          <rect {...common} x="4" y="13" width="7" height="7" rx="1.8" />
          <rect {...common} x="13" y="13" width="7" height="7" rx="1.8" />
        </svg>
      )
    case 'logout':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path {...common} d="M15 7.5 19.5 12 15 16.5" />
          <path {...common} d="M8 12h11.5" />
          <path {...common} d="M10 4.5H6.5A2.5 2.5 0 0 0 4 7v10a2.5 2.5 0 0 0 2.5 2.5H10" />
        </svg>
      )
    case 'user':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle {...common} cx="12" cy="8" r="3.5" />
          <path {...common} d="M5.5 19.5c1.6-3 4-4.5 6.5-4.5s4.9 1.5 6.5 4.5" />
        </svg>
      )
    default:
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle {...common} cx="12" cy="12" r="8" />
        </svg>
      )
  }
}

function StatusPill({ label, tone = 'slate' }) {
  return <span className={cx('status-pill', `status-pill--${tone}`)}>{label}</span>
}

function InlineMessage({ state }) {
  if (!state?.message) {
    return null
  }

  return (
    <div className={cx('inline-message', state.status === 'error' ? 'inline-message--error' : 'inline-message--success')}>
      {state.message}
    </div>
  )
}

function AuthScreen({
  authMode,
  authState,
  loginForm,
  signupForm,
  now,
  onAuthModeChange,
  onLoginChange,
  onLoginSubmit,
  onSignupChange,
  onSignupSubmit,
}) {
  return (
    <div className="auth-shell">
      <section className="auth-hero">
        <div className="auth-hero__clock">
          <div className="auth-hero__time">{formatTime(now)}</div>
          <div className="auth-hero__date">{formatLongDate(now)}</div>
        </div>

        <div className="auth-hero__copy">
          <p className="auth-hero__eyebrow">Dialer Cloud Workspace</p>
          <h1 className="auth-hero__title">
            {getGreeting(now)},
            <br />
            Operator
          </h1>
          <p className="auth-hero__description">
            Enter a cleaner call-center workspace with a dedicated sign-in screen first, then move into a categorized dashboard
            that keeps Campaigns, Call operations, and Workspace settings clearly separated.
          </p>
        </div>

        <div className="auth-tiles">
          {authTiles.map((tile) => (
            <div key={tile} className="auth-tile">
              {tile}
            </div>
          ))}
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-panel__header">
          <p className="auth-panel__eyebrow">Access</p>
          <h2 className="auth-panel__title">Login or create the first admin</h2>
          <p className="auth-panel__description">
            Login is wired to the backend `/api/v1/auth/login` API. Signup uses `/api/v1/auth/bootstrap` for the first admin.
          </p>
        </div>

        <div className="auth-tabs">
          <button
            type="button"
            className={cx('auth-tab', authMode === 'login' && 'auth-tab--active')}
            onClick={() => onAuthModeChange('login')}
          >
            Login
          </button>
          <button
            type="button"
            className={cx('auth-tab', authMode === 'signup' && 'auth-tab--active')}
            onClick={() => onAuthModeChange('signup')}
          >
            Signup
          </button>
        </div>

        {authMode === 'login' ? (
          <form className="auth-form" onSubmit={onLoginSubmit}>
            <label className="auth-field">
              <span className="auth-field__label">Email</span>
              <input
                className="auth-field__input"
                value={loginForm.email}
                onChange={(event) => onLoginChange('email', event.target.value)}
                placeholder="admin@example.com"
              />
            </label>

            <label className="auth-field">
              <span className="auth-field__label">Password</span>
              <input
                className="auth-field__input"
                type="password"
                value={loginForm.password}
                onChange={(event) => onLoginChange('password', event.target.value)}
                placeholder="Minimum 8 characters"
              />
            </label>

            <button type="submit" className="primary-button">
              Login
            </button>
          </form>
        ) : (
          <form className="auth-form" onSubmit={onSignupSubmit}>
            <label className="auth-field">
              <span className="auth-field__label">Tenant name</span>
              <input
                className="auth-field__input"
                value={signupForm.tenantName}
                onChange={(event) => onSignupChange('tenantName', event.target.value)}
                placeholder="Acme Contact Center"
              />
            </label>

            <label className="auth-field">
              <span className="auth-field__label">Admin name</span>
              <input
                className="auth-field__input"
                value={signupForm.adminFullName}
                onChange={(event) => onSignupChange('adminFullName', event.target.value)}
                placeholder="Dialer Admin"
              />
            </label>

            <label className="auth-field">
              <span className="auth-field__label">Admin email</span>
              <input
                className="auth-field__input"
                value={signupForm.adminEmail}
                onChange={(event) => onSignupChange('adminEmail', event.target.value)}
                placeholder="admin@example.com"
              />
            </label>

            <div className="auth-form__grid">
              <label className="auth-field">
                <span className="auth-field__label">Timezone</span>
                <input
                  className="auth-field__input"
                  value={signupForm.timezone}
                  onChange={(event) => onSignupChange('timezone', event.target.value)}
                  placeholder="Asia/Kolkata"
                />
              </label>

              <label className="auth-field">
                <span className="auth-field__label">Password</span>
                <input
                  className="auth-field__input"
                  type="password"
                  value={signupForm.password}
                  onChange={(event) => onSignupChange('password', event.target.value)}
                  placeholder="Minimum 8 characters"
                />
              </label>
            </div>

            <button type="submit" className="primary-button">
              Create first admin
            </button>
          </form>
        )}

        <InlineMessage state={authState} />
      </section>
    </div>
  )
}

function RailButton({ active, icon, label, onClick }) {
  return (
    <button type="button" className={cx('rail-button', active && 'rail-button--active')} onClick={onClick} title={label}>
      <span className="rail-button__icon">
        <AppIcon name={icon} />
      </span>
      <span className="rail-button__label">{label}</span>
    </button>
  )
}

function SectionNavButton({ item, active, onClick }) {
  return (
    <button type="button" className={cx('section-nav-button', active && 'section-nav-button--active')} onClick={onClick}>
      <span className="section-nav-button__title">{item.label}</span>
      <span className="section-nav-button__copy">{item.description}</span>
    </button>
  )
}

function HeaderSearch({ placeholder, value, onChange }) {
  return (
    <label className="header-search">
      <span className="header-search__icon">
        <AppIcon name="workspace" />
      </span>
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  )
}

function MetricCard({ label, value, detail, tone = 'slate' }) {
  return (
    <article className="metric-card">
      <p className="metric-card__label">{label}</p>
      <p className={cx('metric-card__value', `metric-card__value--${tone}`)}>{value}</p>
      <p className="metric-card__detail">{detail}</p>
    </article>
  )
}

function OverviewWorkspace({ snapshot, onNavigate, searchQuery }) {
  const loweredSearch = searchQuery.trim().toLowerCase()
  const cards = overviewCards.filter((card) => {
    if (!loweredSearch) {
      return true
    }
    return `${card.label} ${card.description}`.toLowerCase().includes(loweredSearch)
  })

  return (
    <div className="workspace-stack">
      <section className="workspace-card">
        <div className="workspace-card__header">
          <div>
            <p className="workspace-card__eyebrow">Operations</p>
            <h3 className="workspace-card__title">Main feature categories</h3>
            <p className="workspace-card__description">
              Campaigns is now a dedicated entry in the left-side navigation structure instead of being buried inside a mixed dashboard.
            </p>
          </div>
        </div>

        <div className="overview-grid">
          {cards.map((card) => (
            <button key={card.id} type="button" className="overview-card" onClick={() => onNavigate(card.id)}>
              <div className={cx('overview-card__badge', `overview-card__badge--${card.accent}`)}>
                <AppIcon
                  name={
                    card.id === 'campaigns'
                      ? 'campaign'
                      : card.id === 'activity'
                        ? 'activity'
                        : card.id === 'readiness'
                          ? 'settings'
                          : 'phone'
                  }
                />
              </div>
              <div>
                <p className="overview-card__title">{card.label}</p>
                <p className="overview-card__description">{card.description}</p>
              </div>
            </button>
          ))}
        </div>
      </section>


      <section className="workspace-card">
        <div className="workspace-card__header">
          <div>
            <p className="workspace-card__eyebrow">Live Summary</p>
            <h3 className="workspace-card__title">Current system pulse</h3>
          </div>
        </div>

        <div className="metric-grid">
          <MetricCard label="Live calls" value={snapshot.active_calls} detail="Outbound attempts in progress." tone="teal" />
          <MetricCard label="Queue depth" value={snapshot.queue} detail="Leads waiting to be attempted." tone="orange" />
          <MetricCard label="Answer rate" value={formatPercent(snapshot.answer_rate)} detail="Recent rolling answer performance." tone="navy" />
          <MetricCard label="Campaigns live" value={snapshot.campaigns_live} detail="Currently active campaigns." tone="rose" />
        </div>
      </section>
    </div>
  )
}

function DialerWorkspace() {
  return (
    <div className="workspace-stack">
      <BrowserVoicePanel defaultDestination="" />
    </div>
  )
}

function CampaignsWorkspace({
  campaigns,
  campaignForm,
  campaignState,
  searchQuery,
  showCampaignForm,
  onCampaignControl,
  onCampaignFormChange,
  onCreateCampaignSubmit,
  onRefreshCampaigns,
  onToggleCampaignForm,
}) {
  const loweredSearch = searchQuery.trim().toLowerCase()
  const visibleCampaigns = campaigns.filter((campaign) => {
    if (!loweredSearch) {
      return true
    }
    return `${campaign.name} ${campaign.dialing_mode} ${campaign.status} ${campaign.caller_id}`.toLowerCase().includes(loweredSearch)
  })

  return (
    <div className="workspace-stack">
      <section className="workspace-card">
        <div className="workspace-card__header">
          <div>
            <p className="workspace-card__eyebrow">Campaign Management</p>
            <h3 className="workspace-card__title">Campaigns</h3>
            <p className="workspace-card__description">
              Campaigns is now its own navigation entry. Creation and control live in the center workspace like the layout you referenced.
            </p>
          </div>

          <div className="toolbar-actions">
            <button type="button" className="secondary-button" onClick={onToggleCampaignForm}>
              {showCampaignForm ? 'Close' : 'New'}
            </button>
            <button type="button" className="secondary-button" onClick={onRefreshCampaigns}>
              Refresh
            </button>
          </div>
        </div>

        {showCampaignForm ? (
          <form className="campaign-form" onSubmit={onCreateCampaignSubmit}>
            <div className="campaign-form__grid">
              <label className="field-block">
                <span className="field-block__label">Campaign name</span>
                <input
                  className="field-block__input"
                  value={campaignForm.name}
                  onChange={(event) => onCampaignFormChange('name', event.target.value)}
                  placeholder="Prime Outbound"
                />
              </label>

              <label className="field-block">
                <span className="field-block__label">Dialing mode</span>
                <select
                  className="field-block__input"
                  value={campaignForm.dialingMode}
                  onChange={(event) => onCampaignFormChange('dialingMode', event.target.value)}
                >
                  <option value="preview">Preview</option>
                  <option value="progressive">Progressive</option>
                  <option value="power">Power</option>
                  <option value="predictive">Predictive</option>
                </select>
              </label>

              <label className="field-block">
                <span className="field-block__label">Max lines</span>
                <input
                  className="field-block__input"
                  type="number"
                  min="1"
                  max="500"
                  value={campaignForm.maxConcurrentLines}
                  onChange={(event) => onCampaignFormChange('maxConcurrentLines', event.target.value)}
                />
              </label>

              <label className="field-block">
                <span className="field-block__label">Retries</span>
                <input
                  className="field-block__input"
                  type="number"
                  min="0"
                  max="20"
                  value={campaignForm.retryAttempts}
                  onChange={(event) => onCampaignFormChange('retryAttempts', event.target.value)}
                />
              </label>

              <label className="field-block">
                <span className="field-block__label">Caller ID</span>
                <input
                  className="field-block__input"
                  value={campaignForm.callerId}
                  onChange={(event) => onCampaignFormChange('callerId', event.target.value)}
                  placeholder="1000"
                />
              </label>
            </div>

            <div className="campaign-form__actions">
              <button type="submit" className="primary-button">
                Create campaign
              </button>
            </div>

            <InlineMessage state={campaignState} />
          </form>
        ) : null}

        <div className="table-shell">
          <div className="table-head">
            <span>Campaign</span>
            <span>Type</span>
            <span>Status</span>
            <span>Caller ID</span>
            <span>Actions</span>
          </div>

          {visibleCampaigns.length === 0 ? (
            <div className="empty-state">No campaigns matched the current search.</div>
          ) : (
            visibleCampaigns.map((campaign) => (
              <div key={campaign.id} className="table-row">
                <div>
                  <p className="table-row__title">{campaign.name}</p>
                  <p className="table-row__meta">{formatDateTime(campaign.created_at)}</p>
                </div>
                <span>{campaign.dialing_mode}</span>
                <span>
                  <StatusPill label={normalizeStatus(campaign.status)} tone={campaign.status === 'active' ? 'teal' : 'slate'} />
                </span>
                <span>{campaign.caller_id}</span>
                <div className="table-row__actions">
                  <button type="button" className="table-action" onClick={() => onCampaignControl(campaign.id, 'start')}>
                    Start
                  </button>
                  <button
                    type="button"
                    className="table-action"
                    onClick={() => onCampaignControl(campaign.id, campaign.status === 'active' ? 'pause' : 'resume')}
                  >
                    {campaign.status === 'active' ? 'Pause' : 'Resume'}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  )
}

function ActivityWorkspace({ connectionState, series, snapshot }) {
  return (
    <div className="workspace-stack">
      <section className="workspace-card">
        <div className="workspace-card__header">
          <div>
            <p className="workspace-card__eyebrow">Operations Pulse</p>
            <h3 className="workspace-card__title">Live queue movement</h3>
            <p className="workspace-card__description">This trend line mirrors the center activity surface and keeps the feed free of right-side clutter.</p>
          </div>

          <StatusPill label={normalizeStatus(connectionState)} tone={getConnectionTone(connectionState)} />
        </div>

        <div className="metric-grid">
          <MetricCard label="Live calls" value={snapshot.active_calls} detail="Current outbound attempts." tone="teal" />
          <MetricCard label="Queue" value={snapshot.queue} detail="Leads waiting to be dialed." tone="orange" />
          <MetricCard label="Answer rate" value={formatPercent(snapshot.answer_rate)} detail="Recent pickup performance." tone="navy" />
          <MetricCard label="Abandon rate" value={formatPercent(snapshot.abandon_rate)} detail="Recent abandon pressure." tone="rose" />
        </div>

        <div className="chart-shell">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series}>
              <CartesianGrid stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="label" stroke="#8a9ab1" tickLine={false} axisLine={false} />
              <YAxis stroke="#8a9ab1" tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{
                  background: '#ffffff',
                  border: '1px solid #d9e2ee',
                  borderRadius: '16px',
                  boxShadow: '0 18px 36px rgba(15, 23, 42, 0.08)',
                }}
              />
              <Line type="monotone" dataKey="active_calls" stroke="#0fb5a2" strokeWidth={3} dot={false} />
              <Line type="monotone" dataKey="queue" stroke="#ff8a2a" strokeWidth={2.4} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  )
}

function ReadinessWorkspace({ connectionState, searchQuery, user }) {
  const loweredSearch = searchQuery.trim().toLowerCase()
  const visibleChecks = prerequisiteChecklist.filter((item) => {
    if (!loweredSearch) {
      return true
    }
    return `${item.title} ${item.detail}`.toLowerCase().includes(loweredSearch)
  })
  const browserVoiceConfig = getBrowserVoiceConfig()
  const browserVoiceReady = isBrowserVoiceConfigured(browserVoiceConfig)

  return (
    <div className="workspace-stack">
      <section className="workspace-card">
        <div className="workspace-card__header">
          <div>
            <p className="workspace-card__eyebrow">Workspace</p>
            <h3 className="workspace-card__title">Session and readiness</h3>
          </div>
        </div>

        <div className="metric-grid">
          <MetricCard label="Session" value={user?.full_name || 'Guest'} detail={user?.email || 'No authenticated session'} tone="navy" />
          <MetricCard label="Role" value={user?.role || 'Guest'} detail={`Tenant ${user?.tenant_id || '-'}`} tone="slate" />
          <MetricCard label="Metrics feed" value={normalizeStatus(connectionState)} detail="Live websocket connection state." tone={getConnectionTone(connectionState)} />
          <MetricCard
            label="Voice layer"
            value={browserVoiceReady ? 'Ready' : 'Pending'}
            detail={browserVoiceReady ? `Browser SIP.js is configured for ${browserVoiceConfig.wsUrl}.` : 'Browser SIP.js configuration is missing.'}
            tone={browserVoiceReady ? 'teal' : 'rose'}
          />
        </div>
      </section>

      <section className="workspace-card">
        <div className="workspace-card__header">
          <div>
            <p className="workspace-card__eyebrow">Checklist</p>
            <h3 className="workspace-card__title">Before a browser SIP call can succeed</h3>
          </div>
        </div>

        <div className="readiness-list">
          {visibleChecks.map((item) => (
            <article key={item.title} className="readiness-item">
              <span className="readiness-item__dot" />
              <div>
                <p className="readiness-item__title">{item.title}</p>
                <p className="readiness-item__detail">{item.detail}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

function BreadcrumbTrail({ items, currentViewId, onNavigate }) {
  return (
    <nav className="breadcrumb-trail" aria-label="Breadcrumb">
      <ol className="breadcrumb-trail__list">
        {items.map((label, index) => {
          const targetView = breadcrumbTargets[label]
          const isCurrent = index === items.length - 1

          return (
            <li key={`${label}-${index}`} className="breadcrumb-trail__item">
              {targetView ? (
                <button
                  type="button"
                  className={cx('breadcrumb-trail__button', isCurrent && 'breadcrumb-trail__button--current')}
                  onClick={() => onNavigate(targetView)}
                  aria-current={isCurrent ? 'page' : undefined}
                >
                  {label}
                </button>
              ) : (
                <span className="breadcrumb-trail__current" aria-current={isCurrent ? 'page' : undefined}>
                  {label}
                </span>
              )}

              {index < items.length - 1 ? <span className="breadcrumb-trail__separator">›</span> : null}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

function HomePageWorkspace({ onNavigate, searchQuery }) {
  const quickEntries = [
    {
      id: 'overview',
      label: 'System Administrator',
      description: 'Open the main operations workspace for dialer, campaigns, activity, and readiness.',
      accent: 'navy',
      icon: 'workspace',
    },
    {
      id: 'dialer',
      label: 'Call Console',
      description: 'Jump straight into the browser softphone and calling tools.',
      accent: 'teal',
      icon: 'phone',
    },
  ]

  const loweredSearch = searchQuery.trim().toLowerCase()
  const entries = quickEntries.filter((entry) => {
    if (!loweredSearch) {
      return true
    }
    return `${entry.label} ${entry.description}`.toLowerCase().includes(loweredSearch)
  })

  return (
    <div className="workspace-stack">
      <section className="workspace-card">
        <div className="workspace-card__header">
          <div>
            <p className="workspace-card__eyebrow">Launch Pad</p>
            <h3 className="workspace-card__title">Choose your workspace</h3>
            <p className="workspace-card__description">
              Home Page is now a real top-level destination, so the breadcrumb can take you back here from the admin screens.
            </p>
          </div>
        </div>

        <div className="overview-grid">
          {entries.map((entry) => (
            <button key={entry.id} type="button" className="overview-card" onClick={() => onNavigate(entry.id)}>
              <div className={cx('overview-card__badge', `overview-card__badge--${entry.accent}`)}>
                <AppIcon name={entry.icon} />
              </div>
              <div>
                <p className="overview-card__title">{entry.label}</p>
                <p className="overview-card__description">{entry.description}</p>
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

export default function App() {
  const storedSession = readStoredSession()
  const [now, setNow] = useState(new Date())
  const [authMode, setAuthMode] = useState('login')
  const [authState, setAuthState] = useState({ status: 'idle', message: '' })
  const [loginForm, setLoginForm] = useState(defaultLoginForm)
  const [signupForm, setSignupForm] = useState(defaultSignupForm)
  const [token, setToken] = useState(storedSession?.token || '')
  const [user, setUser] = useState(storedSession?.user || null)
  const [activeView, setActiveView] = useState('homePage')
  const [searchQuery, setSearchQuery] = useState('')
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [metrics, setMetrics] = useState([])
  const [campaigns, setCampaigns] = useState([])
  const [connectionState, setConnectionState] = useState('connecting')
  const [showCampaignForm, setShowCampaignForm] = useState(false)
  const [campaignForm, setCampaignForm] = useState(defaultCampaignForm)
  const [campaignState, setCampaignState] = useState({ status: 'idle', message: '' })
  const userMenuRef = useRef(null)

  const isAuthenticated = Boolean(token && user)
  const currentView = viewDefinitions[activeView]
  const currentModule = moduleDefinitions[currentView.module]
  const series = metrics.map((entry) => ({
    ...entry,
    label: entry.timestamp?.slice(11, 19) || '--:--:--',
  }))
  const snapshot = metrics.at(-1) || emptySnapshot

  function navigateTo(viewId) {
    setActiveView(viewId)
    setSearchQuery('')
    setUserMenuOpen(false)
  }

  useEffect(() => {
    persistSession(token, user)
  }, [token, user])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(new Date())
    }, 60000)

    return () => window.clearInterval(intervalId)
  }, [])

  useEffect(() => {
    function handlePointerDown(event) {
      if (!userMenuRef.current) {
        return
      }
      if (!userMenuRef.current.contains(event.target)) {
        setUserMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [])

  async function refreshProfile(activeToken = token) {
    if (!activeToken) {
      return
    }

    const response = await fetch(buildApiUrl('/api/v1/auth/me'), {
      headers: buildHeaders(activeToken),
    })
    if (!response.ok) {
      throw new Error('Session expired. Please log in again.')
    }

    const payload = await response.json()
    setUser(payload)
    return payload
  }

  async function loadCampaigns(tenantId = user?.tenant_id, activeToken = token) {
    if (!activeToken || !tenantId) {
      setCampaigns([])
      return
    }

    try {
      const response = await fetch(buildApiUrl('/api/v1/campaigns', { tenant_id: tenantId }), {
        headers: buildHeaders(activeToken),
      })
      if (!response.ok) {
        return
      }

      const payload = await response.json()
      startTransition(() => {
        setCampaigns(payload)
      })
    } catch (error) {
      console.error('Failed to load campaigns', error)
    }
  }

  useEffect(() => {
    if (!isAuthenticated) {
      setCampaigns([])
      setMetrics([])
      setConnectionState('connecting')
      return
    }

    const campaignIntervalId = window.setInterval(() => loadCampaigns(user.tenant_id, token), 12000)

    return () => {
      window.clearInterval(campaignIntervalId)
    }
  }, [isAuthenticated, token, user?.tenant_id])

  useEffect(() => {
    if (!isAuthenticated) {
      return
    }

    refreshProfile(token).catch((error) => {
      console.error('Stored session is invalid', error)
      setToken('')
      setUser(null)
      setAuthState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Session expired. Please log in again.',
      })
    })
  }, [isAuthenticated, token])

  useEffect(() => {
    if (!isAuthenticated) {
      return
    }

    let closed = false
    let socket = null
    let reconnectTimerId = null

    async function loadSnapshot() {
      try {
        const response = await fetch(buildApiUrl('/metrics'), { headers: buildHeaders(token) })
        if (!response.ok) {
          return
        }
        const payload = await response.json()
        startTransition(() => {
          setMetrics((current) => [...current.slice(-47), payload])
        })
      } catch (error) {
        console.error('Failed to load metrics snapshot', error)
      }
    }

    async function waitForApi() {
      try {
        const response = await fetch(buildApiUrl('/health'))
        return response.ok
      } catch {
        return false
      }
    }

    function scheduleReconnect(delay = 1500) {
      window.clearTimeout(reconnectTimerId)
      if (closed) {
        return
      }

      reconnectTimerId = window.setTimeout(() => {
        connectMetricsSocket()
      }, delay)
    }

    async function connectMetricsSocket() {
      const apiReady = await waitForApi()
      if (!apiReady) {
        if (!closed) {
          setConnectionState('connecting')
          scheduleReconnect(1000)
        }
        return
      }

      if (closed) {
        return
      }

      socket = new WebSocket(wsUrl)
      socket.onopen = () => setConnectionState('live')
      socket.onmessage = (event) => {
        const payload = JSON.parse(event.data)
        startTransition(() => {
          setMetrics((current) => [...current.slice(-47), payload])
        })
      }
      socket.onerror = () => setConnectionState('degraded')
      socket.onclose = () => {
        if (!closed) {
          setConnectionState('reconnecting')
          scheduleReconnect()
        }
      }
    }

    loadSnapshot()
    connectMetricsSocket()

    return () => {
      closed = true
      window.clearTimeout(reconnectTimerId)
      socket?.close()
    }
  }, [isAuthenticated, token])

  function onLoginChange(field, value) {
    setLoginForm((current) => ({ ...current, [field]: value }))
  }

  function onSignupChange(field, value) {
    setSignupForm((current) => ({ ...current, [field]: value }))
  }

  async function onLoginSubmit(event) {
    event.preventDefault()
    setAuthState({ status: 'submitting', message: '' })

    try {
      const response = await fetch(buildApiUrl('/api/v1/auth/login'), {
        method: 'POST',
        headers: buildHeaders('', true),
        body: JSON.stringify(loginForm),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(payload?.detail || 'Login failed')
      }

      const payload = await response.json()
      setToken(payload.access_token)
      setUser(payload.user)
      setLoginForm(defaultLoginForm)
      setAuthState({
        status: 'success',
        message: `Welcome back, ${payload.user.full_name}.`,
      })
      navigateTo('homePage')
    } catch (error) {
      console.error('Login failed', error)
      setAuthState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unable to login.',
      })
    }
  }

  async function onSignupSubmit(event) {
    event.preventDefault()
    setAuthState({ status: 'submitting', message: '' })

    try {
      const response = await fetch(buildApiUrl('/api/v1/auth/bootstrap'), {
        method: 'POST',
        headers: buildHeaders('', true),
        body: JSON.stringify({
          tenant_name: signupForm.tenantName,
          timezone: signupForm.timezone,
          admin_full_name: signupForm.adminFullName,
          admin_email: signupForm.adminEmail,
          password: signupForm.password,
        }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(payload?.detail || 'Signup failed')
      }

      const payload = await response.json()
      setToken(payload.access_token)
      setUser(payload.user)
      setSignupForm(defaultSignupForm)
      setAuthState({
        status: 'success',
        message: `Workspace created for ${payload.user.email}.`,
      })
      navigateTo('homePage')
    } catch (error) {
      console.error('Signup failed', error)
      setAuthState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unable to signup.',
      })
    }
  }

  async function onRefreshProfile() {
    try {
      const payload = await refreshProfile()
      setAuthState({
        status: 'success',
        message: `Profile synced for ${payload.full_name}.`,
      })
    } catch (error) {
      console.error('Profile refresh failed', error)
      setToken('')
      setUser(null)
      setAuthState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unable to refresh profile.',
      })
    }
  }

  function onLogout() {
    setUserMenuOpen(false)
    setToken('')
    setUser(null)
    setSearchQuery('')
    setActiveView('homePage')
    setAuthMode('login')
    setAuthState({
      status: 'success',
      message: 'Logged out successfully.',
    })
  }

  async function onCampaignControl(campaignId, action) {
    try {
      await fetch(buildApiUrl(`/api/v1/campaigns/${campaignId}/${action}`), {
        method: 'POST',
        headers: buildHeaders(token),
      })
      await loadCampaigns(user?.tenant_id, token)
    } catch (error) {
      console.error(`Failed to ${action} campaign`, error)
    }
  }

  function onCampaignFormChange(field, value) {
    setCampaignForm((current) => ({ ...current, [field]: value }))
  }

  async function onCreateCampaignSubmit(event) {
    event.preventDefault()
    setCampaignState({ status: 'submitting', message: '' })

    try {
      const response = await fetch(buildApiUrl('/api/v1/campaigns'), {
        method: 'POST',
        headers: buildHeaders(token, true),
        body: JSON.stringify({
          tenant_id: user?.tenant_id || 1,
          name: campaignForm.name,
          dialing_mode: campaignForm.dialingMode,
          max_concurrent_lines: Number(campaignForm.maxConcurrentLines),
          retry_attempts: Number(campaignForm.retryAttempts),
          caller_id: campaignForm.callerId,
        }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(payload?.detail || 'Campaign creation failed')
      }

      const payload = await response.json()
      setCampaignState({
        status: 'success',
        message: `${payload.name} created successfully.`,
      })
      setCampaignForm(defaultCampaignForm)
      setShowCampaignForm(false)
      await loadCampaigns(user?.tenant_id, token)
    } catch (error) {
      console.error('Campaign creation failed', error)
      setCampaignState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unable to create campaign.',
      })
    }
  }

  if (!isAuthenticated) {
    return (
      <AuthScreen
        authMode={authMode}
        authState={authState}
        loginForm={loginForm}
        now={now}
        onAuthModeChange={setAuthMode}
        onLoginChange={onLoginChange}
        onLoginSubmit={onLoginSubmit}
        onSignupChange={onSignupChange}
        onSignupSubmit={onSignupSubmit}
        signupForm={signupForm}
      />
    )
  }

  return (
    <div className="studio-shell">
      <aside className="icon-rail">
        <div className="icon-rail__brand">DC</div>

        <div className="icon-rail__main">
          <RailButton active={currentView.module === 'home'} icon="home" label="Home" onClick={() => navigateTo('homePage')} />
          <RailButton active={currentView.module === 'call'} icon="phone" label="Call" onClick={() => navigateTo('dialer')} />
        </div>

        <div className="icon-rail__bottom">
          <RailButton active={currentView.module === 'settings'} icon="settings" label="Settings" onClick={() => navigateTo('readiness')} />

          <div ref={userMenuRef} className="user-dock">
            <button type="button" className="user-dock__button" onClick={() => setUserMenuOpen((current) => !current)} title="Account">
              <span className="user-dock__avatar">{getInitials(user.full_name)}</span>
            </button>

            {userMenuOpen ? (
              <div className="user-menu">
                <div className="user-menu__header">
                  <p className="user-menu__name">{user.full_name}</p>
                  <p className="user-menu__meta">{user.email}</p>
                </div>
                <button type="button" className="user-menu__item" onClick={onRefreshProfile}>
                  <span className="user-menu__icon">
                    <AppIcon name="user" />
                  </span>
                  Refresh profile
                </button>
                <button type="button" className="user-menu__item" onClick={onLogout}>
                  <span className="user-menu__icon">
                    <AppIcon name="logout" />
                  </span>
                  Logout
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </aside>

      <aside className="module-pane">
        <div className="module-pane__header">
          <p className="module-pane__eyebrow">Module</p>
          <h2 className="module-pane__title">{currentModule.title}</h2>
          <p className="module-pane__description">{currentModule.description}</p>
        </div>

        <nav className="module-pane__nav">
          {currentModule.items.map((item) => (
            <SectionNavButton key={item.id} item={item} active={activeView === item.id} onClick={() => navigateTo(item.id)} />
          ))}
        </nav>

        <div className="module-pane__footer">
          <p className="module-pane__footer-label">Signed in as</p>
          <p className="module-pane__footer-value">{user.full_name}</p>
          <p className="module-pane__footer-meta">
            {user.role} · tenant {user.tenant_id}
          </p>
        </div>
      </aside>

      <main className="content-pane">
        <header className="content-header">
          <div>
            <BreadcrumbTrail items={currentView.breadcrumb} currentViewId={activeView} onNavigate={navigateTo} />
            <h1 className="content-header__title">{currentView.title}</h1>
            <p className="content-header__description">{currentView.description}</p>
          </div>

          {activeView !== 'dialer' ? (
            <div className="content-header__tools">
              <HeaderSearch placeholder={currentView.searchPlaceholder} value={searchQuery} onChange={setSearchQuery} />
            </div>
          ) : null}
        </header>

        {activeView === 'homePage' ? (
          <HomePageWorkspace onNavigate={navigateTo} searchQuery={searchQuery} />
        ) : null}

        {activeView === 'overview' ? (
          <OverviewWorkspace snapshot={snapshot} onNavigate={navigateTo} searchQuery={searchQuery} />
        ) : null}

        {activeView === 'dialer' ? (
          <DialerWorkspace />
        ) : null}

        {activeView === 'campaigns' ? (
          <CampaignsWorkspace
            campaigns={campaigns}
            campaignForm={campaignForm}
            campaignState={campaignState}
            searchQuery={searchQuery}
            showCampaignForm={showCampaignForm}
            onCampaignControl={onCampaignControl}
            onCampaignFormChange={onCampaignFormChange}
            onCreateCampaignSubmit={onCreateCampaignSubmit}
            onRefreshCampaigns={() => loadCampaigns(user?.tenant_id, token)}
            onToggleCampaignForm={() => setShowCampaignForm((current) => !current)}
          />
        ) : null}

        {activeView === 'activity' ? (
          <ActivityWorkspace
            connectionState={connectionState}
            series={series}
            snapshot={snapshot}
          />
        ) : null}

        {activeView === 'readiness' ? (
          <ReadinessWorkspace
            connectionState={connectionState}
            searchQuery={searchQuery}
            user={user}
          />
        ) : null}
      </main>
    </div>
  )
}
