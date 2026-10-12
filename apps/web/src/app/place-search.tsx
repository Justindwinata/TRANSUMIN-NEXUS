'use client';

import { useEffect, useId, useState } from 'react';
import { passengerApi } from '../lib/passenger-api';
import { errorMessage, modeName, type TransitPlace } from '../lib/passenger';

type Props = Readonly<{
  label: string;
  snapshotId: string;
  value: TransitPlace | null;
  onSelect: (place: TransitPlace | null) => void;
}>;

export function PlaceSearch({ label, snapshotId, value, onSelect }: Props) {
  const id = useId().replaceAll(':', '-');
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<readonly TransitPlace[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!open || !snapshotId || query.trim().length < 2) {
      setMatches([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setStatus('Searching stops and stations…');
      void passengerApi
        .places(query.trim(), snapshotId, controller.signal)
        .then((results) => {
          setMatches(results);
          setActiveIndex(0);
          setStatus(results.length ? '' : 'No matching stop or station.');
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted) setStatus(errorMessage(cause));
        });
    }, 240);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, snapshotId]);

  function select(place: TransitPlace) {
    setQuery(place.name);
    onSelect(place);
    setOpen(false);
    setStatus('');
  }

  return (
    <div className="place-search">
      <label htmlFor={`${id}-input`}>{label}</label>
      <input
        id={`${id}-input`}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && matches.length > 0}
        aria-controls={`${id}-options`}
        aria-activedescendant={
          open && matches[activeIndex]
            ? `${id}-option-${activeIndex}`
            : undefined
        }
        autoComplete="off"
        placeholder="Search a stop or station"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          onSelect(null);
          setOpen(true);
        }}
        onFocus={() => {
          if (!value && query.length >= 2) setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
          if (event.key === 'ArrowDown' && matches.length) {
            event.preventDefault();
            setActiveIndex((index) => (index + 1) % matches.length);
          }
          if (event.key === 'ArrowUp' && matches.length) {
            event.preventDefault();
            setActiveIndex(
              (index) => (index - 1 + matches.length) % matches.length,
            );
          }
          if (event.key === 'Enter' && open && matches[activeIndex]) {
            event.preventDefault();
            select(matches[activeIndex]);
          }
        }}
      />
      {value && (
        <p className="place-confirmation">
          {modeName(value.product_mode)} · {value.kind.toLowerCase()} selected
        </p>
      )}
      {open && matches.length > 0 && (
        <ul id={`${id}-options`} className="place-options" role="listbox">
          {matches.map((place, index) => (
            <li
              id={`${id}-option-${index}`}
              key={`${place.product_mode}:${place.place_id}`}
              role="option"
              aria-selected={index === activeIndex}
              className={index === activeIndex ? 'active' : ''}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => select(place)}
            >
              <strong>{place.name}</strong>
              <small>
                {modeName(place.product_mode)} · {place.kind.toLowerCase()} ·{' '}
                {place.external_id}
              </small>
            </li>
          ))}
        </ul>
      )}
      {open && status && (
        <p className="place-status" role="status">
          {status}
        </p>
      )}
    </div>
  );
}
