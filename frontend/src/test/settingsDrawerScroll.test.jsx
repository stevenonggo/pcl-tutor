import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SettingsDrawer from '../components/SettingsDrawer';
import { fetchAiCredentialStatus, fetchAiModels, fetchAiProviders } from '../lib/aiKeysApi';

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

function renderDrawer(open) {
  return render(
    <SettingsDrawer
      open={open}
      onClose={vi.fn()}
      theme="light"
      setTheme={vi.fn()}
      accent="#0B8F68"
      setAccent={vi.fn()}
    />,
  );
}

beforeEach(() => {
  document.body.style.overflow = '';
  vi.mocked(fetchAiProviders).mockResolvedValue({ providers: [] });
  vi.mocked(fetchAiCredentialStatus).mockResolvedValue({ configured: false });
  vi.mocked(fetchAiModels).mockResolvedValue({ models: [] });
});

describe('settings drawer body-scroll lock', () => {
  it('locks the background page while the drawer is open', async () => {
    renderDrawer(true);
    await screen.findByText('Settings');
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('does not lock the page when the drawer is closed', async () => {
    renderDrawer(false);
    expect(document.body.style.overflow).toBe('');
  });

  it('restores the body overflow when the drawer closes', async () => {
    const view = renderDrawer(true);
    await screen.findByText('Settings');
    expect(document.body.style.overflow).toBe('hidden');

    // Simulate the parent flipping open={false} (the X / scrim path).
    view.rerender(
      <SettingsDrawer
        open={false}
        onClose={vi.fn()}
        theme="light"
        setTheme={vi.fn()}
        accent="#0B8F68"
        setAccent={vi.fn()}
      />,
    );
    expect(document.body.style.overflow).toBe('');
  });

  it('restores the body overflow if the drawer unmounts while open', async () => {
    const view = renderDrawer(true);
    await screen.findByText('Settings');
    expect(document.body.style.overflow).toBe('hidden');

    view.unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('preserves the main page scroll position across open and close', async () => {
    Object.defineProperty(window, 'scrollY', { value: 250, configurable: true });
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    try {
      const view = renderDrawer(true);
      await screen.findByText('Settings');
      expect(document.body.style.overflow).toBe('hidden');

      view.rerender(
        <SettingsDrawer
          open={false}
          onClose={vi.fn()}
          theme="light"
          setTheme={vi.fn()}
          accent="#0B8F68"
          setAccent={vi.fn()}
        />,
      );
      // The page is put back exactly where it was before the drawer opened.
      expect(scrollTo).toHaveBeenCalledWith(0, 250);
    } finally {
      scrollTo.mockRestore();
      Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    }
  });

  it('locks and restores again on repeated open/close cycles', async () => {
    const view = renderDrawer(true);
    await screen.findByText('Settings');
    expect(document.body.style.overflow).toBe('hidden');

    view.rerender(
      <SettingsDrawer open={false} onClose={vi.fn()} theme="light" setTheme={vi.fn()} accent="#0B8F68" setAccent={vi.fn()} />,
    );
    expect(document.body.style.overflow).toBe('');

    view.rerender(
      <SettingsDrawer open={true} onClose={vi.fn()} theme="light" setTheme={vi.fn()} accent="#0B8F68" setAccent={vi.fn()} />,
    );
    expect(document.body.style.overflow).toBe('hidden');

    view.unmount();
    expect(document.body.style.overflow).toBe('');
  });
});
