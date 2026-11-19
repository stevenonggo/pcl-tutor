import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/icons';
import SelectField from '../components/SelectField';
import { AiKeysApiError, fetchAiCredentialStatus, fetchAiModels, fetchAiProviders, validateAiKey, validateAiModel } from '../lib/aiKeysApi';
import { isValidModelId, loadAiConfig, saveAiConfig } from '../lib/aiConfig';

// Built-in provider labels used only when the backend catalogue cannot be
// reached (e.g. the backend is down); the backend list wins.
const FALLBACK_PROVIDERS = [
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'modelscope', label: 'ModelScope (DashScope)' },
  { id: 'custom', label: 'Custom endpoint' },
];

const providerLabel = (providers, id) => (providers.find((item) => item.id === id) || {}).label || id;

// The three left-menu sections of the standalone settings page.
const SECTIONS = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'ai-providers', label: 'AI Providers' },
  { id: 'api-key', label: 'API Key' },
];

/**
 * The standalone settings page (replaces the old settings drawer): its own
 * left menu + content card, no main-app chrome around it. Section content:
 *
 * - Appearance: the app theme (Light/Dark), persisted by App on every change.
 * - AI Providers: the provider / custom endpoint / model rows, persisted
 *   locally (pcl-ai-config-v1) on every change.
 * - API Key: the key entry + validation flow. The key travels only to the
 *   backend, is stored encrypted there, and is never kept in localStorage.
 */
export default function SettingsPage({ theme, setTheme }) {
  const [section, setSection] = useState('appearance');

  const [providers, setProviders] = useState(FALLBACK_PROVIDERS);
  // The provider / endpoint / model rows start from the persisted local
  // settings so the page restores exactly what the user picked.
  const [initialConfig] = useState(loadAiConfig);
  const [provider, setProvider] = useState(initialConfig.provider);
  const [endpoint, setEndpoint] = useState(initialConfig.endpoint);
  const [model, setModel] = useState(initialConfig.model);
  const [apiKey, setApiKey] = useState('');
  const [validating, setValidating] = useState(false);
  const [result, setResult] = useState(null);
  const [saved, setSaved] = useState(null);
  const [models, setModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState(null);
  const [modelValidating, setModelValidating] = useState(false);
  const [modelValidation, setModelValidation] = useState(null);

  // Refresh the AI catalogue and the stored-credential status on mount.
  // Failures are non-fatal: the built-in list is kept and the user can still
  // enter a key.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchAiProviders();
        if (!cancelled && Array.isArray(data.providers) && data.providers.length) setProviders(data.providers);
      } catch {
        /* keep the built-in catalogue */
      }
      try {
        const status = await fetchAiCredentialStatus();
        if (!cancelled) setSaved(status && status.configured ? status : null);
      } catch {
        if (!cancelled) setSaved(null);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Persist the local AI settings (provider, endpoint, model) on every
  // change. The API key is deliberately not part of this record: it is
  // validated and stored encrypted on the server, never in localStorage.
  useEffect(() => {
    saveAiConfig({
      provider,
      // A custom URL only belongs to the custom provider; built-in
      // providers use the backend catalogue endpoint, so never persist a
      // stale URL under them.
      endpoint: provider === 'custom' ? endpoint : '',
      model,
    });
  }, [provider, endpoint, model]);

  const handleProviderChange = (next) => {
    setProvider(next);
    // The discovered list and the picked model belong to the previous
    // provider (and its key / endpoint). Invalidate both so a model ID
    // from another provider is never silently reused — and no default
    // model is substituted: the row simply starts empty again.
    setModels([]);
    setModel('');
    setModelsError(null);
    setModelValidation(null);
    setResult(null);
  };

  const handleEndpointChange = (value) => {
    setEndpoint(value);
    // The discovered list was fetched against the previous URL; the user
    // re-runs Load models once the URL is settled.
    setModels([]);
    setModelsError(null);
    setModelValidation(null);
  };

  // Editing the model invalidates an earlier validation: it described the
  // previous ID.
  const handleModelInput = (value) => {
    setModel(value);
    setModelValidation(null);
  };

  const handleValidateModel = async () => {
    const modelTrimmed = model.trim();
    if (!saved || !saved.configured) {
      // Model validation decrypts the stored key server-side, so a stored
      // credential is required first — the key itself is never re-entered.
      setModelValidation({ ok: false, message: 'Validate the API key first — model validation uses your stored key.' });
      return;
    }
    if (!modelTrimmed) {
      setModelValidation({ ok: false, message: 'Enter the model ID first, or pick a discovered model.' });
      return;
    }
    setModelValidating(true);
    setModelValidation(null);
    try {
      const data = await validateAiModel(provider === 'custom' ? { model: modelTrimmed, endpoint } : { model: modelTrimmed });
      setModelValidation({
        ok: Boolean(data.valid),
        message: data.message || (data.valid ? 'Model verified.' : 'The provider could not verify this model.'),
      });
    } catch (error) {
      setModelValidation({ ok: false, message: error instanceof Error ? error.message : 'Model validation failed unexpectedly.' });
    } finally {
      setModelValidating(false);
    }
  };

  const handleLoadModels = async () => {
    setModelsError(null);
    if (!saved || !saved.configured) {
      // Model discovery decrypts the stored key server-side, so a stored
      // credential is required first.
      setModelsError('Validate the API key first — the model list uses your stored key.');
      return;
    }
    if (saved.provider !== provider) {
      setModelsError(
        `Your stored key is for ${providerLabel(providers, saved.provider)} — `
        + `validate the ${providerLabel(providers, provider)} key first, then load its models.`,
      );
      return;
    }
    setModelsLoading(true);
    try {
      const data = await fetchAiModels(provider === 'custom' ? { endpoint } : {});
      const list = data && Array.isArray(data.models) ? data.models : [];
      setModels(list);
      if (list.length === 0) setModelsError('The provider returned no models.');
    } catch (error) {
      setModelsError(error instanceof Error ? error.message : 'Could not load the model list.');
    } finally {
      setModelsLoading(false);
    }
  };

  const handleValidate = async () => {
    if (!apiKey.trim()) {
      setResult({ ok: false, message: 'Enter the API key first, then press Validate.' });
      return;
    }
    setValidating(true);
    setResult(null);
    const payload = { provider, apiKey: apiKey };
    if (provider === 'custom') payload.endpoint = endpoint;
    try {
      const data = await validateAiKey(payload);
      setValidating(false);
      if (data.valid) {
        setSaved({ configured: true, provider: data.provider, key_hint: data.key_hint, verified: true });
        setApiKey(''); // The key must not linger in the form after submission.
        setResult({ ok: true, message: data.message || 'Key verified and stored encrypted on the server.' });
      } else {
        setResult({ ok: false, message: data.message || 'The provider could not verify this key.' });
      }
    } catch (error) {
      setValidating(false);
      if (error instanceof AiKeysApiError && error.status === 401) {
        // With the device-identity header this is rare (it means the
        // backend rejected both identities, e.g. no Web Crypto at all).
        // It is no longer framed as a sign-in problem.
        setResult({ ok: false, message: 'Your AI settings could not be verified — please try again.' });
        return;
      }
      setResult({ ok: false, message: error instanceof Error ? error.message : 'Validation failed unexpectedly.' });
    }
  };

  const modelTrimmed = model.trim();
  const modelError = modelTrimmed !== '' && !isValidModelId(modelTrimmed)
    ? 'The model ID can only use letters, numbers and the characters . / _ -'
    : null;

  return (
    <div className="settings-page">
      <header className="settings-page-head">
        <Link className="back-button" to="/"><Icon name="arrowLeft" size={16} /> Back</Link>
        <div>
          <h1>Settings</h1>
          <p>Appearance, AI provider, and the API key this device remembers.</p>
        </div>
      </header>

      <div className="settings-page-grid">
        <nav className="settings-menu" aria-label="Settings sections">
          {SECTIONS.map((item) => (
            <button key={item.id} className={`settings-menu-item ${section === item.id ? 'selected' : ''}`} onClick={() => setSection(item.id)}>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="settings-card">
          {section === 'appearance' ? (
            <section className="settings-section">
              <span className="settings-label">Appearance</span>
              <p className="settings-section-desc">Choose how PCL Tutor looks on this device.</p>
              <div className="theme-cards">
                {['light', 'dark'].map((item) => (
                  <button key={item} type="button" className={`theme-card ${theme === item ? 'selected' : ''}`} onClick={() => setTheme(item)}>
                    <span className={`theme-preview theme-preview-${item}`} aria-hidden="true">
                      <span className="theme-preview-bar" />
                      <span className="theme-preview-lines"><span /><span /><span /></span>
                    </span>
                    <span className="theme-card-label">{item === 'light' ? 'Light' : 'Dark'}</span>
                    {theme === item ? <span className="theme-card-check"><Icon name="check" size={14} /></span> : null}
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {section === 'ai-providers' ? (
            <section className="settings-section">
              <span className="settings-label">AI providers</span>
              <p className="settings-section-desc">Pick the provider and model your AI study plans are generated with.</p>

              <div className="ai-row">
                <span className="ai-row-label">Endpoint</span>
                <SelectField
                  label="Provider"
                  variant="dropdown"
                  value={provider}
                  onChange={handleProviderChange}
                  options={providers.map((item) => ({ value: item.id, label: item.label }))}
                  placeholder="Choose a provider"
                />
                {provider === 'custom' ? (
                  <label className="input-shell ai-input">
                    <Icon name="settings" size={15} />
                    <input type="url" value={endpoint} onChange={(event) => handleEndpointChange(event.target.value)} placeholder="https://your-openai-compatible-gateway/v1" autoComplete="off" />
                  </label>
                ) : null}
              </div>

              <div className="ai-row">
                <span className="ai-row-label">Model</span>
                <div className="ai-model-controls">
                  <button type="button" className="secondary-button small" onClick={handleLoadModels} disabled={modelsLoading}>
                    {modelsLoading ? 'Loading…' : 'Load models'}
                  </button>
                  <button type="button" className="secondary-button small" onClick={handleValidateModel} disabled={modelValidating}>
                    {modelValidating ? 'Validating…' : 'Validate model'}
                  </button>
                  <SelectField
                    label="Discovered models"
                    variant="dropdown"
                    value={model}
                    onChange={handleModelInput}
                    options={models.map((item) => ({
                      value: item.id,
                      label: item.name && item.name !== item.id ? `${item.id} (${item.name})` : item.id,
                    }))}
                    placeholder={models.length ? 'Choose a discovered model' : 'No models loaded yet'}
                  />
                </div>
                <label className="input-shell ai-input">
                  <Icon name="settings" size={15} />
                  <input
                    type="text"
                    value={model}
                    onChange={(event) => handleModelInput(event.target.value)}
                    placeholder="Model ID (e.g. deepseek-chat)"
                    autoComplete="off"
                    aria-label="Model ID"
                  />
                </label>
                {modelError ? <p className="ai-field-error">{modelError}</p> : null}
                {modelValidation ? <div className={`ai-status ${modelValidation.ok ? 'ok' : 'err'}`}><Icon name={modelValidation.ok ? 'check' : 'x'} size={15} /><span>{modelValidation.message}</span></div> : null}
              </div>

              {modelsError ? <div className="ai-status err"><Icon name="x" size={15} /><span>{modelsError}</span></div> : null}
            </section>
          ) : null}

          {section === 'api-key' ? (
            <section className="settings-section">
              <span className="settings-label">API key</span>
              <p className="settings-section-desc">Validate once — the key is stored encrypted on the server and remembered for you.</p>
              <div className="ai-row">
                <label className="input-shell ai-input">
                  <Icon name="lock" size={15} />
                  <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={`API key for ${providerLabel(providers, provider)}`} autoComplete="off" />
                </label>
                <p className="ai-provider-note">The key is sent only to the PCL Tutor backend, which checks it against the provider and stores it encrypted. It is never kept in your browser and never shown again.</p>
                <button className="primary-button full small" onClick={handleValidate} disabled={validating}>{validating ? 'Validating…' : 'Validate API Key'}</button>
              </div>

              {result ? <div className={`ai-status ${result.ok ? 'ok' : 'err'}`}><Icon name={result.ok ? 'check' : 'x'} size={15} /><span>{result.message}</span></div> : null}
              {saved && saved.configured ? (
                <p className="ai-status-saved">Stored on the server{saved.key_hint ? ` · …${saved.key_hint}` : ''}{saved.provider ? ` · ${providerLabel(providers, saved.provider)}` : ''}</p>
              ) : null}
              {saved && saved.configured ? (
                <p className="ai-provider-note">Your key is remembered on the server — model validation and study plans use it without you entering it again. Enter a new key only to replace it.</p>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
