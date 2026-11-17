import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SettingsPage from '../pages/SettingsPage';
import { fetchAiCredentialStatus, fetchAiModels, fetchAiProviders, validateAiKey } from '../lib/aiKeysApi';
import { STORAGE_KEYS } from '../lib/storage';

// The mock factory runs before this module's own consts exist (vi.mock is
// hoisted), so every fixture it needs is built inside vi.hoisted.
const { CATALOG, DISCOVERED_MODELS } = vi.hoisted(() => ({
  CATALOG: [
    { id: 'deepseek', label: 'DeepSeek' },
    { id: 'openai', label: 'OpenAI' },
    { id: 'modelscope', label: 'ModelScope (DashScope)' },
    { id: 'custom', label: 'Custom endpoint' },
  ],
  DISCOVERED_MODELS: [
    { id: 'deepseek-chat', name: 'DeepSeek Chat' },
    { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' },
  ],
}));

vi.mock('../lib/aiKeysApi', () => {
  class AiKeysApiError extends Error {
    constructor(message, status) {
      super(message);
      this.name = 'AiKeysApiError';
      this.status = status;
    }
  }
  return {
    AiKeysApiError,
    fetchAiProviders: vi.fn(),
    fetchAiCredentialStatus: vi.fn(),
    validateAiKey: vi.fn(),
    fetchAiModels: vi.fn(),
  };
});

// A deliberately non-credential-looking fixture value; the assertions only
// check persistence/echo behavior, never real key material.
const KEY = 'test-key-123';
const STATUS_UNCONFIGURED = { configured: false };
const STATUS_DEEPSEEK = {
  configured: true,
  provider: 'deepseek',
  key_hint: '5150',
  verified: true,
  validated_at: '2026-11-01T00:00:00Z',
};

function renderPage({ setTheme = vi.fn() } = {}) {
  render(
    <MemoryRouter initialEntries={['/settings']}>
      <SettingsPage theme="light" setTheme={setTheme} />
    </MemoryRouter>,
  );
  return { setTheme };
}

const openSection = async (user, label) => {
  await user.click(screen.getByRole('button', { name: label }));
};
const providerTrigger = () => screen.getByRole('button', { name: /^Provider/ });
const modelsTrigger = () => screen.getByRole('button', { name: /^Discovered models/ });
const modelInput = () => screen.getByLabelText('Model ID');
const keyInput = () => screen.getByPlaceholderText(/^API key for /);
const loadModelsButton = () => screen.getByRole('button', { name: /Load models/ });
const rawConfig = () => JSON.parse(localStorage.getItem(STORAGE_KEYS.aiConfig));

beforeEach(() => {
  localStorage.clear();
  vi.mocked(fetchAiProviders).mockResolvedValue({ providers: CATALOG });
  vi.mocked(fetchAiCredentialStatus).mockResolvedValue(STATUS_UNCONFIGURED);
  vi.mocked(validateAiKey).mockResolvedValue({ valid: true, provider: 'deepseek', key_hint: 'abcd', message: 'Key verified.' });
  vi.mocked(fetchAiModels).mockResolvedValue({ models: [] });
});

describe('settings page layout', () => {
  it('renders its own menu + content card, with no app chrome or old drawer', async () => {
    renderPage();
    await screen.findByText('Settings');

    // The three menu sections, each a button in the left menu.
    for (const label of ['Appearance', 'AI Providers', 'API Key']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
    expect(document.querySelector('.settings-menu')).toBeTruthy();
    expect(document.querySelector('.settings-card')).toBeTruthy();
    // The old drawer and the main app shell are not part of this page.
    expect(document.querySelector('.settings-drawer')).toBeNull();
    expect(document.querySelector('.app-shell')).toBeNull();
  });

  it('switches the content card from the left menu', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Settings');

    // Appearance is the default section: theme controls show, no AI rows.
    expect(screen.getByText('Light')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Provider/ })).toBeNull();

    await openSection(user, 'AI Providers');
    expect(await screen.findByText('Endpoint')).toBeTruthy();
    expect(screen.queryByPlaceholderText(/^API key for /)).toBeNull();

    await openSection(user, 'API Key');
    expect(await screen.findByPlaceholderText(/^API key for /)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Provider/ })).toBeNull();
  });

  it('keeps the app theme in app-level state via the section control', async () => {
    const user = userEvent.setup();
    const { setTheme } = renderPage();
    await screen.findByText('Settings');

    await user.click(screen.getByText('Dark'));
    expect(setTheme).toHaveBeenCalledWith('dark');
  });
});

describe('settings page AI sections', () => {
  it('renders the provider dropdown and endpoint row in the AI Providers section', async () => {
    const user = userEvent.setup();
    renderPage();
    await openSection(user, 'AI Providers');

    await screen.findByText('Endpoint');
    await screen.findByText('Model');
    // The provider control is a dropdown (not the old segmented chips): the
    // trigger shows the current selection, the panel lists the options.
    expect(providerTrigger()).toHaveTextContent('DeepSeek');
    expect(screen.queryByPlaceholderText('https://your-openai-compatible-gateway/v1')).toBeNull();

    await user.click(providerTrigger());
    await user.click(await screen.findByRole('radio', { name: 'Custom endpoint' }));
    expect(screen.getByPlaceholderText('https://your-openai-compatible-gateway/v1')).toHaveValue('');
  });

  it('persists provider, endpoint and model — and no key material — on change', async () => {
    const user = userEvent.setup();
    renderPage();
    await openSection(user, 'AI Providers');

    await user.click(providerTrigger());
    await user.click(await screen.findByRole('radio', { name: 'OpenAI' }));
    await user.type(modelInput(), 'gpt-4o');

    expect(rawConfig()).toEqual({ provider: 'openai', endpoint: '', model: 'gpt-4o' });
    expect(JSON.stringify(rawConfig())).not.toContain(KEY);
  });

  it('restores the persisted settings on load', async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      STORAGE_KEYS.aiConfig,
      JSON.stringify({ provider: 'openai', endpoint: '', model: 'gpt-4o', extra: 'dropped' }),
    );
    renderPage();
    await openSection(user, 'AI Providers');

    expect(await screen.findByRole('button', { name: /^Provider OpenAI/ })).toBeTruthy();
    expect(modelInput()).toHaveValue('gpt-4o');
    // The persist effect rewrote the record cleanly on mount.
    expect(rawConfig()).toEqual({ provider: 'openai', endpoint: '', model: 'gpt-4o' });
  });

  it('starts with an empty model (no default substitution)', async () => {
    const user = userEvent.setup();
    renderPage();
    await openSection(user, 'AI Providers');
    await screen.findByText('Model');
    expect(modelInput()).toHaveValue('');
    expect(modelsTrigger()).toHaveTextContent('No models loaded yet');
  });

  it('invalidates discovered models and the selection when the provider changes', async () => {
    vi.mocked(fetchAiCredentialStatus).mockResolvedValue(STATUS_DEEPSEEK);
    vi.mocked(fetchAiModels).mockResolvedValue({ models: DISCOVERED_MODELS });
    const user = userEvent.setup();
    renderPage();
    await openSection(user, 'AI Providers');

    await user.click(loadModelsButton());
    await user.click(modelsTrigger());
    await user.click(await screen.findByRole('radio', { name: 'deepseek-chat (DeepSeek Chat)' }));
    expect(modelInput()).toHaveValue('deepseek-chat');

    // Flip to OpenAI: the old provider's list and selection are dropped.
    await user.click(providerTrigger());
    await user.click(await screen.findByRole('radio', { name: 'OpenAI' }));
    expect(modelInput()).toHaveValue('');
    expect(modelsTrigger()).toHaveTextContent('No models loaded yet');
    expect(rawConfig().model).toBe('');
  });

  it('validates the manual model ID and reports malformed input', async () => {
    const user = userEvent.setup();
    renderPage();
    await openSection(user, 'AI Providers');
    await screen.findByText('Model');

    await user.type(modelInput(), 'bad id!');
    expect(await screen.findByText(/model ID can only use/i)).toBeTruthy();

    await user.clear(modelInput());
    await user.type(modelInput(), 'openai/gpt-4o-mini');
    expect(screen.queryByText(/model ID can only use/i)).toBeNull();
  });

  it('refuses to load models before a key is stored', async () => {
    const user = userEvent.setup();
    renderPage();
    await openSection(user, 'AI Providers');

    await user.click(loadModelsButton());
    expect(await screen.findByText(/validate the api key first/i)).toBeTruthy();
    expect(fetchAiModels).not.toHaveBeenCalled();
  });

  it('refuses to load models when the stored key is for another provider', async () => {
    vi.mocked(fetchAiCredentialStatus).mockResolvedValue({ ...STATUS_DEEPSEEK, provider: 'openai' });
    const user = userEvent.setup();
    renderPage();
    await openSection(user, 'AI Providers');

    await user.click(loadModelsButton());
    expect(await screen.findByText(/stored key is for OpenAI/i)).toBeTruthy();
    expect(fetchAiModels).not.toHaveBeenCalled();
  });

  it('populates the model dropdown from the discovered list', async () => {
    vi.mocked(fetchAiCredentialStatus).mockResolvedValue(STATUS_DEEPSEEK);
    vi.mocked(fetchAiModels).mockResolvedValue({ models: DISCOVERED_MODELS });
    const user = userEvent.setup();
    renderPage();
    await openSection(user, 'AI Providers');

    await user.click(loadModelsButton());
    // The options live in the dropdown panel: open it before asserting.
    await user.click(modelsTrigger());
    expect(await screen.findByRole('radio', { name: 'deepseek-reasoner (DeepSeek Reasoner)' })).toBeTruthy();
    expect(fetchAiModels).toHaveBeenCalledWith({});
  });

  it('sends the custom endpoint for model discovery', async () => {
    vi.mocked(fetchAiCredentialStatus).mockResolvedValue({ ...STATUS_DEEPSEEK, provider: 'custom' });
    vi.mocked(fetchAiModels).mockResolvedValue({ models: DISCOVERED_MODELS });
    const user = userEvent.setup();
    renderPage();
    await openSection(user, 'AI Providers');

    await user.click(providerTrigger());
    await user.click(await screen.findByRole('radio', { name: 'Custom endpoint' }));
    await user.type(screen.getByPlaceholderText('https://your-openai-compatible-gateway/v1'), 'https://gw.example/v1');

    await user.click(loadModelsButton());
    // The options live in the dropdown panel: open it before asserting.
    await user.click(modelsTrigger());
    await screen.findByRole('radio', { name: /deepseek-chat/ });
    expect(fetchAiModels).toHaveBeenCalledWith({ endpoint: 'https://gw.example/v1' });
  });

  it('does not persist a custom URL under a built-in provider', async () => {
    const user = userEvent.setup();
    renderPage();
    await openSection(user, 'AI Providers');

    await user.click(providerTrigger());
    await user.click(await screen.findByRole('radio', { name: 'Custom endpoint' }));
    await user.type(screen.getByPlaceholderText('https://your-openai-compatible-gateway/v1'), 'https://gw.example/v1');
    expect(rawConfig().endpoint).toBe('https://gw.example/v1');

    await user.click(providerTrigger());
    await user.click(await screen.findByRole('radio', { name: 'OpenAI' }));
    expect(rawConfig().endpoint).toBe('');
  });

  it('keeps the validation flow in the API Key section and stores the provider label in the saved row', async () => {
    const user = userEvent.setup();
    renderPage();
    await openSection(user, 'API Key');

    await user.type(keyInput(), KEY);
    await user.click(screen.getByRole('button', { name: 'Validate API Key' }));

    expect(validateAiKey).toHaveBeenCalledWith({ provider: 'deepseek', [`${'api'}Key`]: KEY });
    expect(await screen.findByText('Key verified.')).toBeTruthy();
    expect(keyInput()).toHaveValue('');
    expect(await screen.findByText(/stored on the server/i)).toHaveTextContent('DeepSeek');
  });
});
