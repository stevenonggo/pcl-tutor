import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { INITIAL_REQUESTS, INITIAL_SESSIONS } from '../data/mockData';
import { blockImplicitSubmit } from '../lib/forms';
import { STORAGE_KEYS, writeJson } from '../lib/storage';
import { STUDENT, TUTOR, cancelDialog, renderApp, signInAs } from './helpers';
import SelectField from '../components/SelectField';

// Browsers submit a form when Enter lands in a text field. That is right for a search
// box or a sign-in form, and wrong for the forms that publish, send, or save.
describe('blockImplicitSubmit', () => {
  const makeEvent = (key, { tagName = 'INPUT', shiftKey = false, ctrlKey = false, isContentEditable = false } = {}) => ({
    key,
    shiftKey,
    ctrlKey,
    metaKey: false,
    altKey: false,
    preventDefault: vi.fn(),
    target: { tagName, isContentEditable },
  });

  it('blocks a plain Enter in a text-like field', () => {
    ['INPUT', 'SELECT'].forEach((tagName) => {
      const event = makeEvent('Enter', { tagName });
      blockImplicitSubmit(event);
      expect(event.preventDefault).toHaveBeenCalled();
    });
  });

  it('leaves the newline alone inside a textarea', () => {
    const event = makeEvent('Enter', { tagName: 'TEXTAREA' });
    blockImplicitSubmit(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  // A focused button already activates on Enter, so blocking it would break keyboard use.
  it('leaves Enter alone on a button, a link, and editable text', () => {
    ['BUTTON', 'A'].forEach((tagName) => {
      const event = makeEvent('Enter', { tagName });
      blockImplicitSubmit(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
    });
    const editable = makeEvent('Enter', { isContentEditable: true });
    blockImplicitSubmit(editable);
    expect(editable.preventDefault).not.toHaveBeenCalled();
  });

  it('leaves explicit shortcuts such as Ctrl+Enter alone', () => {
    const event = makeEvent('Enter', { ctrlKey: true });
    blockImplicitSubmit(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('ignores every other key', () => {
    ['a', 'Tab', 'Escape'].forEach((key) => {
      const event = makeEvent(key);
      blockImplicitSubmit(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
    });
  });
});

// The browser paints a native <select> popup itself, so it cannot be themed and it
// overflows a phone viewport. These cover the replacement control's wiring instead.
describe('SelectField', () => {
  const Harness = ({ initial = 'b', onChange = () => {} }) => {
    const [value, setValue] = useState(initial);
    return (
      <SelectField
        label="Pick one"
        value={value}
        onChange={(next) => { setValue(next); onChange(next); }}
        options={['a', 'b', 'c']}
      />
    );
  };

  it('exposes the choice as a radiogroup with the current value checked', () => {
    render(<Harness />);
    const group = screen.getByRole('radiogroup', { name: 'Pick one' });
    expect(within(group).getByRole('radio', { name: 'b' })).toHaveAttribute('aria-checked', 'true');
    expect(within(group).getByRole('radio', { name: 'a' })).toHaveAttribute('aria-checked', 'false');
  });

  it('reports the chosen value when a chip is pressed', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await user.click(screen.getByRole('radio', { name: 'c' }));

    expect(onChange).toHaveBeenCalledWith('c');
    expect(screen.getByRole('radio', { name: 'c' })).toHaveAttribute('aria-checked', 'true');
  });

  // A long list becomes a panel, which is the case that used to open an OS-styled popup.
  it('opens a panel for a long list and selects from it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const many = Array.from({ length: 12 }, (_, i) => `Option ${i + 1}`);
    render(
      <SelectField label="Duration" value="Option 1" onChange={onChange} options={many} />,
    );

    const trigger = screen.getByRole('button', { name: /Duration/ });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    const panel = screen.getByRole('radiogroup', { name: 'Duration' });
    await user.click(within(panel).getByRole('radio', { name: 'Option 5' }));

    expect(onChange).toHaveBeenCalledWith('Option 5');
    expect(screen.queryByRole('radiogroup', { name: 'Duration' })).not.toBeInTheDocument();
  });

  it('keeps the placeholder visible until something is chosen', async () => {
    const user = userEvent.setup();
    render(<SelectField label="Slot" value="" options={['09:00', '10:00', '11:30', '13:00', '14:30']} onChange={() => {}} placeholder="Select a slot" />);

    // A real native <select> names a button "Slot" and prints the options, so a query
    // for the placeholder alone used to work by accident. The trigger here is a button
    // carrying both the label and the current value, which is what a screen reader needs
    // when the field is still empty.
    const trigger = screen.getByRole('button', { name: /Slot/ });
    expect(trigger).toHaveTextContent('Select a slot');
    expect(trigger).toHaveClass('empty');
    expect(trigger).toHaveAccessibleName(/Slot\s+Select a slot/);

    await user.click(trigger);
    expect(screen.getByRole('radiogroup', { name: 'Slot' })).toBeInTheDocument();
  });

  it('closes on Escape without changing the value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} initial="b" />);

    const trigger = screen.getByRole('radio', { name: 'a' });
    await user.click(trigger);
    await user.keyboard('{Escape}');

    expect(onChange).toHaveBeenCalledWith('a');
  });
});

describe('suggest another time form', () => {
  beforeEach(() => {
    localStorage.clear();
    signInAs(TUTOR);
    // The form resolves the request from the local db, so the seeded demo
    // requests have to be written where the app reads them.
    writeJson(STORAGE_KEYS.db, {
      students: [],
      tutors: [],
      sessions: INITIAL_SESSIONS,
      requests: INITIAL_REQUESTS,
      availability: {},
    });
  });

  // Suggesting a time is a send, so it gets the same Enter treatment as booking. The
  // tutor can still be mid-thought in the message box when they press Enter.
  it('does not send the suggestion when Enter is pressed in the message box', async () => {
    const user = userEvent.setup();
    renderApp('/booking?mode=suggest&request=sr1');

    const message = await screen.findByLabelText(/^message$/i);
    await user.type(message, 'This slot suits me better{Enter}');

    expect(screen.queryByText(/Suggestion sent/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /send suggestion/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByText(/Suggestion sent/i)).not.toBeInTheDocument();
  });

  // A textarea is where a tutor writes a real explanation, so the newline has to work.
  it('still lets the tutor press Enter inside the message box', async () => {
    const user = userEvent.setup();
    renderApp('/booking?mode=suggest&request=sr1');

    const message = await screen.findByLabelText(/^message$/i);
    await user.type(message, 'first line{Enter}second line');

    expect(message).toHaveValue('first line\nsecond line');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the typed message after cancelling the review', async () => {
    const user = userEvent.setup();
    renderApp('/booking?mode=suggest&request=sr1');

    await user.type(await screen.findByLabelText(/^message$/i), 'Evening works better');
    await user.click(screen.getByRole('button', { name: /send suggestion/i }));
    await cancelDialog(user);

    // Cancelling returns to the form, and the draft is still there to edit.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^message$/i)).toHaveValue('Evening works better');
    expect(screen.queryByText(/Suggestion sent/i)).not.toBeInTheDocument();
  });
});

describe('profile form', () => {
  beforeEach(() => {
    localStorage.clear();
    signInAs(STUDENT);
  });

  it('does not save when Enter is pressed in a field', async () => {
    const user = userEvent.setup();
    renderApp('/profile');

    const name = await screen.findByLabelText(/full name/i);
    await user.clear(name);
    await user.type(name, 'Nathan Andrew-Saved{Enter}');

    // The saved marker is the visible proof that the form submitted, so it must not
    // appear from a stray keypress.
    expect(screen.queryByText(/saved locally for this demo/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /save changes/i }));
    expect(await screen.findByText(/saved locally for this demo/i)).toBeInTheDocument();
  });

  it('persists the saved name to the signed-in account', async () => {
    const user = userEvent.setup();
    renderApp('/profile');

    const name = await screen.findByLabelText(/full name/i);
    await user.clear(name);
    await user.type(name, 'Nathan Brooks{Enter}');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('pcl-user-v7'));
      expect(stored.name).toBe('Nathan Brooks');
      // Initials are derived, so they follow the new name rather than going stale.
      expect(stored.initials).toBe('NB');
    });
  });
});
