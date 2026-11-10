import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ConfirmDialog from './ConfirmDialog';
import { Icon } from './icons';
import { slotKey } from '../lib/slots';

const startDate = new Date('2026-09-28T12:00:00');

export function datesForWeek(offset = 0) {
  const first = new Date(startDate);
  first.setDate(first.getDate() + offset * 7);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(first);
    day.setDate(day.getDate() + index);
    return day.toISOString().slice(0, 10);
  });
}

function pretty(date) {
  return new Intl.DateTimeFormat('en', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${date}T12:00:00`));
}

export default function CalendarWorkspace({ items = [], availability = {}, tutorId, allowManage = false, onRemoveAvailability, onAddAvailability, onAddSlot }) {
  const navigate = useNavigate();
  const [weekOffset, setWeekOffset] = useState(0);
  const dates = useMemo(() => datesForWeek(weekOffset), [weekOffset]);
  const [selectedDate, setSelectedDate] = useState(dates[0]);
  const [selectedMode, setSelectedMode] = useState('All');
  // Announced to screen readers as well as being visible, so a removal is never silent.
  const [notice, setNotice] = useState('');
  // Removal is destructive, so it waits for a confirmation and stays undoable.
  const [pendingRemoval, setPendingRemoval] = useState(null);
  const [lastRemoved, setLastRemoved] = useState(null);
  const slots = tutorId ? availability?.[tutorId]?.[selectedDate] || [] : [];
  const dayItems = items.filter((item) => item.date === selectedDate && (selectedMode === 'All' || item.type === selectedMode.toLowerCase()));

  const shiftWeek = (amount) => {
    const nextOffset = weekOffset + amount;
    setWeekOffset(nextOffset);
    setSelectedDate(datesForWeek(nextOffset)[0]);
    setNotice('');
    setLastRemoved(null);
  };

  const selectDay = (date) => {
    setSelectedDate(date);
    setNotice('');
    setLastRemoved(null);
  };

  const resetToCurrentWeek = () => {
    setWeekOffset(0);
    setSelectedDate(datesForWeek(0)[0]);
    setNotice('');
    setLastRemoved(null);
  };

  const confirmRemove = () => {
    const slot = pendingRemoval;
    setPendingRemoval(null);
    if (!slot) return;
    onRemoveAvailability?.(tutorId, selectedDate, slotKey(slot));
    setLastRemoved({ slot, date: selectedDate });
    setNotice(`Removed the ${slot.time} ${slot.mode.toLowerCase()} slot on ${pretty(selectedDate)}.`);
  };

  const undoRemove = () => {
    if (!lastRemoved) return;
    onAddAvailability?.(tutorId, lastRemoved.date, lastRemoved.slot);
    setNotice(`Restored the ${lastRemoved.slot.time} ${lastRemoved.slot.mode.toLowerCase()} slot on ${pretty(lastRemoved.date)}.`);
    setLastRemoved(null);
  };

  // On the Availability page the caller passes onAddSlot to scroll to and focus the
  // publishing form. Elsewhere it falls back to navigating there.
  const manageClick = () => {
    setNotice('');
    if (onAddSlot) onAddSlot();
    else navigate('/availability');
  };

  return (
    <section className="calendar-workspace">
      <div className="calendar-workspace-head">
        <div><span className="eyebrow">Interactive calendar</span><h2>{pretty(dates[0])} — {pretty(dates[6])}</h2><p>Pick a day to see the exact sessions, requests, or open tutoring times.</p></div>
        <div className="calendar-controls"><button className="icon-button" onClick={() => shiftWeek(-1)} aria-label="Previous week"><Icon name="arrowLeft" size={16} /></button><button className="ghost-button" onClick={resetToCurrentWeek}>This week</button><button className="icon-button" onClick={() => shiftWeek(1)} aria-label="Next week"><Icon name="arrowRight" size={16} /></button></div>
      </div>

      <div className="week-strip">
        {dates.map((date) => {
          const dateObj = new Date(`${date}T12:00:00`);
          const count = items.filter((item) => item.date === date).length;
          const openCount = tutorId ? (availability?.[tutorId]?.[date] || []).length : 0;
          return (
            <button type="button" key={date} className={`week-day ${selectedDate === date ? 'selected' : ''}`} onClick={() => selectDay(date)}>
              <span>{new Intl.DateTimeFormat('en', { weekday: 'short' }).format(dateObj)}</span>
              <strong>{dateObj.getDate()}</strong>
              <small>{tutorId ? `${openCount} open` : `${count} item${count !== 1 ? 's' : ''}`}</small>
            </button>
          );
        })}
      </div>

      <div className="calendar-workspace-body">
        <div className="agenda-panel">
          <div className="agenda-head"><div><span className="eyebrow">Selected day</span><h3>{pretty(selectedDate)}</h3></div><div className="segmented-tabs">{['All', 'Session', 'Request'].map((item) => <button key={item} type="button" className={selectedMode === item ? 'selected' : ''} onClick={() => setSelectedMode(item)}>{item}</button>)}</div></div>
          {dayItems.length ? <div className="agenda-list">{dayItems.sort((a, b) => a.time.localeCompare(b.time)).map((item) => <article className="agenda-item" key={item.id}><div className="agenda-time"><strong>{item.time}</strong><span>{item.mode || 'Study session'}</span></div><div className="agenda-line"><span className={`event-dot ${item.type}`} /></div><div className="agenda-copy"><strong>{item.label}</strong><p>{item.detail || 'Open the session to see more details.'}</p></div><button className="icon-button" onClick={() => navigate(item.type === 'request' ? '/requests' : `/sessions?date=${item.date}`)} aria-label={item.type === 'request' ? 'Open request' : 'Open session'}><Icon name="arrowRight" size={15} /></button></article>)}</div> : <div className="empty-state calendar-empty"><Icon name="calendar" size={22} /><strong>No scheduled items for this day.</strong><span>Choose another day or use the open time to plan your next session.</span></div>}
        </div>

        {tutorId && (
          <aside className="open-slots-panel">
            <div className="agenda-head"><div><span className="eyebrow">Open availability</span><h3>{slots.length ? `${slots.length} slot${slots.length > 1 ? 's' : ''}` : 'No open slots'}</h3></div></div>
            {slots.length ? <div className="open-slot-list">{slots.map((slot) => <div className="open-slot" key={slotKey(slot)}><div className="open-slot-main"><span className="open-slot-time">{slot.time}</span><span className={`mode-pill tiny ${slot.mode.toLowerCase()}`}>{slot.mode}</span></div>{slot.mode === 'Offline' && <span className="open-slot-place">{slot.location}</span>}{allowManage && <button className="icon-button" onClick={() => setPendingRemoval(slot)} aria-label={`Remove ${slot.time} ${slot.mode} slot`}><Icon name="close" size={14} /></button>}</div>)}</div> : <p className="panel-note">You have no open slot on this day yet. Publish one to make it discoverable.</p>}
            {notice && <p className="open-slot-notice" role="status"><span>{notice}</span>{lastRemoved && <button type="button" className="notice-undo" onClick={undoRemove}>Undo</button>}</p>}
            {allowManage && <button className="primary-button full" onClick={manageClick}>{onAddSlot ? 'Add another slot' : 'Manage availability'} <Icon name="arrowRight" size={15} /></button>}
          </aside>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(pendingRemoval)}
        title="Remove this open slot?"
        description={pendingRemoval
          ? `The ${pendingRemoval.time} ${pendingRemoval.mode.toLowerCase()} slot on ${pretty(selectedDate)}${pendingRemoval.mode === 'Offline' ? ` at ${pendingRemoval.location}` : ''} will stop being offered to students. You can undo this straight afterwards.`
          : ''}
        confirmLabel="Remove slot"
        onConfirm={confirmRemove}
        onCancel={() => setPendingRemoval(null)}
      />
    </section>
  );
}