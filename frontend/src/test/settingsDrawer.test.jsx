import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import SettingsDrawer from '../components/SettingsDrawer';
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

const STATUS_UNCONFIGURED = { configured: false };
const STATUS_DEEPSEEK = {
  configured: true,
  provider: 'deepseek',
  key_hint: '5150',
  verified: true,
  validated_at: '2026-11-01T00:00:00Z',
};

function renderDrawer() {
  render(
    <SettingsDrawer
      open
      onClose={vi.fn()}
      theme="light"
      setTheme={vi.fn()}
      accent="#0B8F68"
      setAccent={vi.fn()}
    />,
  );
}

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

describe('settings drawer AI rows', () => {
  it('renders the Endpoint / Model / API key rows with a provider dropdown', async () => {
    const user = userEvent.setup();
    renderDrawer();

    await screen.findByText('Endpoint');
    await screen.findByText('Model');
    await screen.findByText('API key');
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
    renderDrawer();

    await user.click(providerTrigger());
    await user.click(await screen.findByRole('radio', { name: 'OpenAI' }));
    await user.type(modelInput(), 'gpt-4o');

    expect(rawConfig()).toEqual({ provider: 'openai', endpoint: '', model: 'gpt-4o' });
    expect(JSON.stringify(rawConfig())).not.toContain('sk-');
  });

  it('restores the persisted settings on open', async () => {
    localStorage.setItem(
      STORAGE_KEYS.aiConfig,
      JSON.stringify({ provider: 'openai', endpoint: '', model: 'gpt-4o', apiKey: 'sk-stale-must-be-dropped' }),
    );
    renderDrawer();

    expect(await screen.findByRole('button', { name: /^Provider OpenAI/ })).toBeTruthy();
    expect(modelInput()).toHaveValue('gpt-4o');
    // The persist effect rewrote the record cleanly on mount.
    expect(rawConfig()).toEqual({ provider: 'openai', endpoint: '', model: 'gpt-4o' });
  });

  it('starts with an empty model (no default substitution)', async () => {
    renderDrawer();
    await screen.findByText('Model');
    expect(modelInput()).toHaveValue('');
    expect(modelsTrigger()).toHaveTextContent('No models loaded yet');
  });

  it('invalidates discovered models and the selection when the provider changes', async () => {
    vi.mocked(fetchAiCredentialStatus).mockResolvedValue(STATUS_DEEPSEEK);
    vi.mocked(fetchAiModels).mockResolvedValue({ models: DISCOVERED_MODELS });
    const user = userEvent.setup();
    renderDrawer();

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
    renderDrawer();
    await screen.findByText('Model');

    await user.type(modelInput(), 'bad id!');
    expect(await screen.findByText(/model ID can only use/i)).toBeTruthy();

    await user.clear(modelInput());
    await user.type(modelInput(), 'openai/gpt-4o-mini');
    expect(screen.queryByText(/model ID can only use/i)).toBeNull();
  });

  it('refuses to load models before a key is stored', async () => {
    const user = userEvent.setup();
    renderDrawer();

    await user.click(loadModelsButton());
    expect(await screen.findByText(/validate the api key first/i)).toBeTruthy();
    expect(fetchAiModels).not.toHaveBeenCalled();
  });

  it('refuses to load models when the stored key is for another provider', async () => {
    vi.mocked(fetchAiCredentialStatus).mockResolvedValue({ ...STATUS_DEEPSEEK, provider: 'openai' });
    const user = userEvent.setup();
    renderDrawer();

    await user.click(loadModelsButton());
    expect(await screen.findByText(/stored key is for OpenAI/i)).toBeTruthy();
    expect(fetchAiModels).not.toHaveBeenCalled();
  });

  it('populates the model dropdown from the discovered list', async () => {
    vi.mocked(fetchAiCredentialStatus).mockResolvedValue(STATUS_DEEPSEEK);
    vi.mocked(fetchAiModels).mockResolvedValue({ models: DISCOVERED_MODELS });
    const user = userEvent.setup();
    renderDrawer();

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
    renderDrawer();

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
    renderDrawer();

    await user.click(providerTrigger());
    await user.click(await screen.findByRole('radio', { name: 'Custom endpoint' }));
    await user.type(screen.getByPlaceholderText('https://your-openai-compatible-gateway/v1'), 'https://gw.example/v1');
    expect(rawConfig().endpoint).toBe('https://gw.example/v1');

    await user.click(providerTrigger());
    await user.click(await screen.findByRole('radio', { name: 'OpenAI' }));
    expect(rawConfig().endpoint).toBe('');
  });

  it('keeps the header fixed above an independently scrollable content area', async () => {
    renderDrawer();
    await screen.findByText('Settings');

    const drawer = document.querySelector('.settings-drawer');
    const head = document.querySelector('.drawer-head');
    const body = document.querySelector('.drawer-body');
    expect(drawer).toBeTruthy();
    expect(body).toBeTruthy();
    // The header lives outside the scroll region; every settings section lives inside it.
    expect(head.parentElement).toBe(drawer);
    expect(body.contains(head)).toBe(false);
    expect(body.querySelectorAll('.settings-section').length).toBe(2);
  });

  it('removes the Design rule card — the bottom of the drawer stays plain', async () => {
    renderDrawer();
    await screen.findByText('Settings');
    expect(screen.queryByText('Design rule')).toBeNull();
    expect(screen.queryByText(/primary action visually dominant/i)).toBeNull();
  });

  it('keeps the validation flow and stores the provider label in the saved row', async () => {
    const user = userEvent.setup();
    renderDrawer();

    await user.type(keyInput(), 'sk-test-1234');
    await user.click(screen.getByRole('button', { name: 'Validate API Key' }));

    expect(validateAiKey).toHaveBeenCalledWith({ provider: 'deepseek', apiKey: 'sk-test-1234' });
    expect(await screen.findByText('Key verified.')).toBeTruthy();
    expect(keyInput()).toHaveValue('');
    expect(await screen.findByText(/stored on the server/i)).toHaveTextContent('DeepSeek');
  });
});
