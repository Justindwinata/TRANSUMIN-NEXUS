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
  const [mounted, setMounted] = useState(false);
  const ready = mounted && !!snapshotId;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open || !ready || query.trim().length < 2) {
      setMatches([]);
      return;
    }
    setMatches([]);
    setActiveIndex(0);
    setStatus('Searching places…');
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void passengerApi
        .places(query.trim(), snapshotId, controller.signal)
        .then((results) => {
          if (controller.signal.aborted) return;
          setMatches(results);
          setActiveIndex(0);
          setStatus(
            results.length
              ? `${results.length} places found.`
              : 'No matching place.',
          );
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted) setStatus(errorMessage(cause));
        });
    }, 240);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, ready, snapshotId]);

  useEffect(() => {
    if (!value) return;
    setQuery(value.name);
    setMatches([]);
    setOpen(false);
    setStatus('');
  }, [value]);

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
        aria-expanded={open}
        aria-controls={open && matches.length > 0 ? `${id}-options` : undefined}
        aria-describedby={`${id}-hint`}
        aria-activedescendant={
          open && matches[activeIndex]
            ? `${id}-option-${activeIndex}`
            : undefined
        }
        autoComplete="off"
        disabled={!ready}
        placeholder="Search stop, station, address or POI"
        maxLength={80}
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
      <p id={`${id}-hint`} className="place-search-hint">
        Stops/stations plus sparse historical OSM addresses and POIs. Not
        comprehensive or independently verified; use map pin for missing
        locations.{' '}
        <a href="https://www.openstreetmap.org/copyright">
          © OpenStreetMap contributors
        </a>
        .
      </p>
      {!ready && (
        <p className="place-status" role="status" aria-busy="true">
          Stop and station search is loading…
        </p>
      )}
      {value && (
        <p className="place-confirmation">
          {value.product_mode ? `${modeName(value.product_mode)} · ` : ''}
          {value.kind.toLowerCase()} selected
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
                {place.product_mode ? `${modeName(place.product_mode)} · ` : ''}
                {place.kind.toLowerCase()} · {place.external_id}
                {place.kind === 'ADDRESS' || place.kind === 'POI'
                  ? ' · OSM · bounded coverage'
                  : ''}
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
