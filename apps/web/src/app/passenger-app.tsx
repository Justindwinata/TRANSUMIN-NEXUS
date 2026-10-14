'use client';

import {
  BusIcon,
  PersonSimpleWalkIcon,
  TrainIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  PassengerApiError,
  acceptanceReconcileOutcome,
  canCommitRecovery,
  passengerApi,
  recoveryProposalKey,
  recoverySource,
  type RecoverySource,
} from '../lib/passenger-api';
import { DEMO_REPLAY } from '../lib/demo-replay';
import { useDeviceLocation } from '../lib/use-device-location';
import {
  OFF_ROUTE_HISTORY,
  distanceToPathMeters,
  isOffRoute,
  isWalkingMode,
  manuallyAdvanceManeuver,
  modeNavLabel,
  navigationMode,
  navigationScopeKey,
  nextGuidance,
  pathPoints,
  prepareWalkNavigation,
  initialWalkProgress,
  walkGeometryIdentity,
  updateWalkProgress,
  type WalkProgress,
  type NavMode,
} from '../lib/navigation';
import type { JourneyMapPoint } from './journey-map';
import { PlaceSearch } from './place-search';
import { JourneyMap } from './journey-map';
import {
  distinctModes,
  easiestAmongShown,
  alertIsCurrent,
  evidenceLabel,
  errorMessage,
  formatClock,
  formatDistance,
  formatDuration,
  initialJakartaDateTime,
  journeySearchFailure,
  modeName,
  parsePoint,
  passengerRouteName,
  rankingExplanation,
  rankingFingerprint,
  sameRankingCandidate,
  recoveryPart,
  recoveryPartLabel,
  recoverySummary,
  remainingReportTargets,
  isValidReportDescription,
  samePassengerLeg,
  segmentPosition,
  toJakartaIso,
  transferLabel,
  type Journey,
  type JourneyPreference,
  type JourneyAlert,
  type PassengerReport,
  type Recovery,
  type RecoveryAcceptance,
  type TransitPlace,
} from '../lib/passenger';

const journeyKey = 'transumin.passenger.journey';
const recoveryKey = 'transumin.passenger.recovery';
const activationKey = 'transumin.passenger.activation';

function ModeIcon({ mode }: { mode: Journey['segments'][number]['mode'] }) {
  const Icon =
    mode === 'WALK'
      ? PersonSimpleWalkIcon
      : mode === 'TRANSJAKARTA' || mode === 'MIKROTRANS'
        ? BusIcon
        : TrainIcon;
  return <Icon size={18} weight="regular" aria-hidden="true" />;
}

export function PassengerApp() {
  const [snapshotId, setSnapshotId] = useState('');
  const [originPlace, setOriginPlace] = useState<TransitPlace | null>(null);
  const [destinationPlace, setDestinationPlace] = useState<TransitPlace | null>(
    null,
  );
  const [advancedCoordinates, setAdvancedCoordinates] = useState(false);
  const [originLat, setOriginLat] = useState('');
  const [originLon, setOriginLon] = useState('');
  const [destinationLat, setDestinationLat] = useState('');
  const [destinationLon, setDestinationLon] = useState('');
  const [departure, setDeparture] = useState('');
  const [preference, setPreference] = useState<JourneyPreference>('BALANCED');
  const preferenceRef = useRef<JourneyPreference>('BALANCED');
  const [rankingMessage, setRankingMessage] = useState('');
  const [progressAt, setProgressAt] = useState('');
  const [alternatives, setAlternatives] = useState<Journey[]>([]);
  const [selected, setSelected] = useState<Journey | null>(null);
  const [active, setActive] = useState<Journey | null>(null);
  const activeRef = useRef<Journey | null>(null);
  activeRef.current = active;
  const [alerts, setAlerts] = useState<JourneyAlert[]>([]);
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const [acceptance, setAcceptance] = useState<RecoveryAcceptance | null>(null);
  const acceptKey = useRef<string | null>(null);
  // G1-A: recoveries and acceptance follow later-over-wins request identity;
  // only the newest in-flight proposal/acceptance may commit frontend state.
  const recoveryRequestId = useRef(0);
  const recoveryRequest = useRef<{
    id: number;
    controller: AbortController;
  } | null>(null);
  // G1-A identity: a mounted snapshot is stale as soon as a newer journey
  // generation (remount, current-journey switch, restored recovery, or new
  // progress) supersedes it. `recoverySource` is the latest live journey;
  // `activeGeneration` never moves backwards within one mount.
  const recoveryJourney = useRef<RecoverySource | null>(null);
  const activeGeneration = useRef(0);
  const [recoveryStatus, setRecoveryStatus] = useState<
    'NEEDS_RECONCILE' | 'RECONCILING' | null
  >(null);
  const acceptingRecovery = useRef<{ key: string; id: number } | null>(null);
  const [alertError, setAlertError] = useState('');
  const [streamStatus, setStreamStatus] = useState<
    'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'OFFLINE'
  >('OFFLINE');
  const [busy, setBusy] = useState<
    | 'search'
    | 'activate'
    | 'progress'
    | 'boarding'
    | 'alighting'
    | 'recovery'
    | 'report'
    | null
  >(null);
  const device = useDeviceLocation();
  const [followDevice, setFollowDevice] = useState(true);
  const [navigationPaused, setNavigationPaused] = useState(false);
  const navLegKey = useRef<string | null>(null);
  const navHistory = useRef<Array<{ distance: number | null }>>([]);
  const lastNavSampleTimestamp = useRef<number | null>(null);
  const [walkState, setWalkState] = useState<{
    key: string | null;
    progress: WalkProgress;
  }>({
    key: null,
    progress: initialWalkProgress(),
  });
  const walkStateRef = useRef(walkState);
  walkStateRef.current = walkState;
  const walkNavigation = useRef<ReturnType<typeof prepareWalkNavigation>>(null);
  const [selectionMode, setSelectionMode] = useState<
    'origin' | 'destination' | null
  >(null);
  const [inputModes, setInputModes] = useState<
    Record<
      'origin' | 'destination',
      'place' | 'pin' | 'current' | 'coordinates'
    >
  >({ origin: 'place', destination: 'place' });
  const [originPin, setOriginPin] = useState<JourneyMapPoint | null>(null);
  const [destinationPin, setDestinationPin] = useState<JourneyMapPoint | null>(
    null,
  );
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [reportCategory, setReportCategory] = useState('SERVICE');
  const [reportObservedAt, setReportObservedAt] = useState('');
  const [reportDescription, setReportDescription] = useState('');
  const [reportStatus, setReportStatus] = useState('');
  const [reportFormError, setReportFormError] = useState('');
  const [reportTargetKey, setReportTargetKey] = useState('');
  const [reports, setReports] = useState<PassengerReport[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState('');
  const reportKey = useRef<{ fingerprint: string; key: string } | null>(null);
  const planRequest = useRef<{
    id: number;
    controller: AbortController;
  } | null>(null);
  const planRequestId = useRef(0);
  const lastPlan = useRef<{
    origin: { latitude: number; longitude: number };
    destination: { latitude: number; longitude: number };
    departure: string;
  } | null>(null);
  const lastBest = useRef<ReturnType<typeof rankingFingerprint> | null>(null);

  function commitCurrentJourney(journey: Journey) {
    activeGeneration.current += 1;
    activeRef.current = journey;
    recoveryJourney.current = recoverySource(journey);
    setActive(journey);
    setSelected(journey);
  }

  async function loadPersistedReports(journeyId: string) {
    setReportsLoading(true);
    setReportsError('');
    try {
      setReports(await passengerApi.listReports(journeyId));
    } catch (cause) {
      setReportsError(errorMessage(cause));
    } finally {
      setReportsLoading(false);
    }
  }

  useEffect(() => {
    let mounted = true;
    const startupGeneration = activeGeneration.current;
    setDeparture(initialJakartaDateTime());
    setProgressAt(initialJakartaDateTime());
    setReportObservedAt(initialJakartaDateTime());
    const storedJourney = localStorage.getItem(journeyKey);
    if (storedJourney) {
      void passengerApi
        .getJourney(storedJourney)
        .then((journey) => {
          // Never let a slow startup read overwrite a newer generation:
          // a future remount or a switched current journey makes this older
          // mount stale even if it resolves last.
          if (!mounted || startupGeneration !== activeGeneration.current)
            return;
          commitCurrentJourney(journey);
          const generation = activeGeneration.current;
          const source = recoverySource(journey);
          void loadPersistedReports(journey.journey_id);
          const storedRecovery = localStorage.getItem(
            `${recoveryKey}.${journey.journey_id}`,
          );
          if (storedRecovery) {
            const requestId = ++recoveryRequestId.current;
            recoveryRequest.current?.controller.abort();
            const controller = new AbortController();
            recoveryRequest.current = { id: requestId, controller };
            void passengerApi
              .getRecovery(storedRecovery, controller.signal)
              .then((recovered) => {
                if (
                  mounted &&
                  canCommitRecovery({
                    requestId,
                    latestRequestId: recoveryRequestId.current,
                    generation,
                    latestGeneration: activeGeneration.current,
                    captured: source,
                    latest: recoveryJourney.current,
                  }) &&
                  recovered.original_journey_id === source.journeyId
                )
                  setRecovery(recovered);
              })
              .catch(() => {
                if (
                  mounted &&
                  canCommitRecovery({
                    requestId,
                    latestRequestId: recoveryRequestId.current,
                    generation,
                    latestGeneration: activeGeneration.current,
                    captured: source,
                    latest: recoveryJourney.current,
                  })
                )
                  localStorage.removeItem(
                    `${recoveryKey}.${journey.journey_id}`,
                  );
              });
          }
        })
        .catch((cause: unknown) => {
          if (!mounted || startupGeneration !== activeGeneration.current)
            return;
          if (cause instanceof PassengerApiError && cause.status === 404) {
            localStorage.removeItem(journeyKey);
            activeGeneration.current += 1;
            activeRef.current = null;
            recoveryJourney.current = null;
            setActive(null);
            setSelected(null);
            setRecovery(null);
            setError(
              'Perjalanan tersimpan tidak ditemukan. Silakan mulai lagi.',
            );
          } else {
            setError(errorMessage(cause));
          }
        });
    }
    void passengerApi
      .config()
      .then((config) => {
        if (mounted) setSnapshotId(config.network_snapshot_id);
      })
      .catch((cause: unknown) => {
        if (mounted) setError(errorMessage(cause));
      });
    return () => {
      mounted = false;
      activeGeneration.current += 1;
      recoveryRequestId.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!active || active.status !== 'ACTIVE') return;
    let mounted = true;
    const controller = new AbortController();
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let lastEventId: string | null = null;
    let reconnectAttempt = 0;
    const journeyId = active.journey_id;
    const refresh = async () => {
      try {
        const result = await passengerApi.alerts(journeyId);
        if (mounted) {
          setAlerts(result);
          setAlertError('');
        }
      } catch (cause) {
        if (mounted) setAlertError(errorMessage(cause));
      }
    };
    const connect = async () => {
      if (!mounted) return;
      setStreamStatus(reconnectAttempt === 0 ? 'CONNECTING' : 'RECONNECTING');
      try {
        await passengerApi.streamAlerts(
          journeyId,
          lastEventId,
          controller.signal,
          (event) => {
            if (!mounted) return;
            setStreamStatus('CONNECTED');
            reconnectAttempt = 0;
            if (event.type !== 'heartbeat' && event.id) lastEventId = event.id;
            if (
              event.type === 'journey.alert.created' ||
              event.type === 'heartbeat'
            )
              void refresh();
          },
          () => {
            if (!mounted) return;
            setStreamStatus('CONNECTED');
            reconnectAttempt = 0;
            void refresh();
          },
        );
      } catch (cause) {
        if (mounted && !controller.signal.aborted)
          setAlertError(errorMessage(cause));
      }
      if (mounted && !controller.signal.aborted) {
        setStreamStatus('RECONNECTING');
        void refresh();
        reconnectAttempt += 1;
        reconnectTimer = setTimeout(
          () => void connect(),
          Math.min(15_000, 1000 * 2 ** Math.min(reconnectAttempt, 4)),
        );
      }
    };
    void refresh();
    void connect();
    return () => {
      mounted = false;
      controller.abort();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [active?.journey_id, active?.status]);

  // Device-local navigation; scope resets on recovery/geometry replacement.
  useEffect(() => {
    const leg =
      active?.status === 'ACTIVE'
        ? active.segments.find(
            (segment) =>
              segment.sequence ===
              (active.progress?.completed_segment_count ?? 0),
          )
        : null;
    if (!active || !leg || leg.mode !== 'WALK') {
      if (
        navLegKey.current !== null ||
        navHistory.current.length > 0 ||
        walkNavigation.current !== null ||
        walkStateRef.current.key !== null
      ) {
        navHistory.current = [];
        navLegKey.current = null;
        lastNavSampleTimestamp.current = null;
        walkNavigation.current = null;
        const reset = { key: null, progress: initialWalkProgress() };
        walkStateRef.current = reset;
        setWalkState(reset);
      }
      return;
    }
    const key = navigationScopeKey(
      active.journey_id,
      active.accepted_recovery_id,
      leg,
    );
    const changed = navLegKey.current !== key;
    if (changed) {
      navLegKey.current = key;
      navHistory.current = [];
      lastNavSampleTimestamp.current = null;
      walkNavigation.current = prepareWalkNavigation(leg);
      const reset = { key, progress: initialWalkProgress() };
      walkStateRef.current = reset;
      setWalkState(reset);
    }
    const prepared = walkNavigation.current;
    const fix = device.position;
    const base =
      walkStateRef.current.key === key
        ? walkStateRef.current.progress
        : initialWalkProgress();
    if (navigationPaused) {
      navHistory.current = [];
      const paused = {
        ...base,
        reliableFixes: 0,
        alongMeters: null,
        lastTimestamp: null,
        status: 'PAUSED' as const,
      };
      walkStateRef.current = { key, progress: paused };
      setWalkState({ key, progress: paused });
      return;
    }
    if (!fix) return;
    if (!device.navigationGrade || device.state !== 'GPS_TRACKING') {
      if (base.status !== 'UNCERTAIN' || base.reliableFixes !== 0) {
        const uncertain = {
          ...base,
          reliableFixes: 0,
          status: 'UNCERTAIN' as const,
        };
        walkStateRef.current = { key, progress: uncertain };
        setWalkState({ key, progress: uncertain });
      }
      navHistory.current = [];
      return;
    }
    if (base.status === 'PAUSED') {
      const resumed = {
        ...base,
        reliableFixes: 0,
        status: 'UNCERTAIN' as const,
      };
      walkStateRef.current = { key, progress: resumed };
      setWalkState({ key, progress: resumed });
    }
    if (fix.timestamp === lastNavSampleTimestamp.current) return;
    lastNavSampleTimestamp.current = fix.timestamp;
    if (prepared) {
      const next = updateWalkProgress(prepared, base, fix, Date.now());
      walkStateRef.current = { key, progress: next };
      setWalkState({ key, progress: next });
    }
    navHistory.current = [
      ...navHistory.current.slice(-(OFF_ROUTE_HISTORY - 1)),
      { distance: distanceToPathMeters(fix, pathPoints(leg)) },
    ];
  }, [
    active,
    device.position?.timestamp,
    device.navigationGrade,
    device.state,
    navigationPaused,
  ]);

  async function planJourney(
    origin: {
      latitude: number;
      longitude: number;
    },
    destination: { latitude: number; longitude: number },
    departureAt: string,
    requested: JourneyPreference,
  ) {
    const priorPref = preferenceRef.current;
    const priorFingerprint =
      lastPlan.current &&
      lastPlan.current.origin.latitude === origin.latitude &&
      lastPlan.current.origin.longitude === origin.longitude &&
      lastPlan.current.destination.latitude === destination.latitude &&
      lastPlan.current.destination.longitude === destination.longitude &&
      lastPlan.current.departure === departureAt
        ? lastBest.current
        : null;
    const requestId = ++planRequestId.current;
    planRequest.current?.controller.abort();
    const controller = new AbortController();
    planRequest.current = { id: requestId, controller };
    lastPlan.current = { origin, destination, departure: departureAt };
    setError('');
    setMessage('');
    setRankingMessage('');
    setBusy('search');
    setAlternatives([]);
    setSelected(null);
    try {
      if (!snapshotId)
        throw new Error(
          'Routing snapshot is not ready. Check the passenger configuration.',
        );
      const results = await passengerApi.plan(
        {
          origin: { latitude: origin.latitude, longitude: origin.longitude },
          destination: {
            latitude: destination.latitude,
            longitude: destination.longitude,
          },
          departure_at: toJakartaIso(departureAt),
          network_snapshot_id: snapshotId,
          preference: requested,
        },
        controller.signal,
      );
      if (requestId !== planRequestId.current) return;
      setAlternatives(results);
      const best = results[0];
      setSelected(best ?? null);
      preferenceRef.current = requested;
      const fingerprint = best ? rankingFingerprint(best) : null;
      lastBest.current = fingerprint;
      if (best && fingerprint) {
        if (
          priorFingerprint &&
          requested !== priorPref &&
          sameRankingCandidate(priorFingerprint, fingerprint)
        ) {
          setRankingMessage(
            rankingExplanation(
              priorPref,
              requested,
              fingerprint,
              results.length,
            ),
          );
        }
      } else {
        setMessage(
          'No journey was found for this place and departure time. Try another time or destination.',
        );
      }
    } catch (cause) {
      if (requestId !== planRequestId.current) return;
      const feedback = journeySearchFailure(cause);
      if (feedback.empty) setMessage(feedback.message);
      else setError(feedback.message);
    } finally {
      if (requestId === planRequestId.current) {
        planRequest.current = null;
        setBusy(null);
      }
    }
  }

  function changePreference(next: JourneyPreference) {
    // Preference state updates visibly even when replanning is not allowed.
    setRankingMessage('');
    setPreference(next);
    if (active) return;
    if (!lastPlan.current) return;
    const plan = lastPlan.current;
    void planJourney(plan.origin, plan.destination, plan.departure, next);
  }

  function chooseEndpointMode(
    endpoint: 'origin' | 'destination',
    mode: 'place' | 'pin' | 'current' | 'coordinates',
  ) {
    setInputModes((current) => ({ ...current, [endpoint]: mode }));
    if (mode === 'place') {
      if (endpoint === 'origin') setOriginPin(null);
      else setDestinationPin(null);
      if (selectionMode === endpoint) setSelectionMode(null);
    } else if (mode === 'pin') {
      if (endpoint === 'origin') {
        setOriginPlace(null);
        setOriginPin(null);
      } else {
        setDestinationPlace(null);
        setDestinationPin(null);
      }
      setSelectionMode(endpoint);
    } else if (mode === 'current') {
      if (selectionMode === endpoint) setSelectionMode(null);
      if (endpoint === 'origin') {
        setOriginPlace(null);
        setOriginPin(null);
      } else {
        setDestinationPlace(null);
        setDestinationPin(null);
      }
      device.start();
    } else {
      if (selectionMode === endpoint) setSelectionMode(null);
      if (mode === 'coordinates') setAdvancedCoordinates(true);
    }
  }

  function endpointCoords(endpoint: 'origin' | 'destination'): {
    latitude: number;
    longitude: number;
  } {
    const current = device.position;
    const fresh = current && device.navigationGrade ? current : null;
    if (endpoint === 'origin') {
      if (inputModes.origin === 'coordinates')
        return parsePoint(originLat, originLon);
      if (inputModes.origin === 'current') {
        if (!fresh)
          throw new Error(
            'Current location needs a fresh accurate device fix. Wait for GPS or choose another input.',
          );
        return { latitude: fresh.latitude, longitude: fresh.longitude };
      }
      if (inputModes.origin === 'pin') {
        if (!originPin) throw new Error('Choose origin pin on the map.');
        return originPin;
      }
      if (!originPlace)
        throw new Error(
          'Choose a origin stop or station from the suggestions.',
        );
      return originPlace;
    }
    if (inputModes.destination === 'coordinates')
      return parsePoint(destinationLat, destinationLon);
    if (inputModes.destination === 'current') {
      if (!fresh)
        throw new Error(
          'Current location needs a fresh accurate device fix. Wait for GPS or choose another input.',
        );
      return { latitude: fresh.latitude, longitude: fresh.longitude };
    }
    if (inputModes.destination === 'pin') {
      if (!destinationPin)
        throw new Error('Choose destination pin on the map.');
      return destinationPin;
    }
    if (!destinationPlace)
      throw new Error(
        'Choose a destination stop or station from the suggestions.',
      );
    return destinationPlace;
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const origin = endpointCoords('origin');
      const destination = endpointCoords('destination');
      await planJourney(origin, destination, departure, preference);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function loadScenario() {
    setError('');
    setMessage('');
    setOriginPlace(DEMO_REPLAY.origin);
    setDestinationPlace(DEMO_REPLAY.destination);
    setDeparture(DEMO_REPLAY.departure);
    setPreference('FEWEST_TRANSFERS');
    setAdvancedCoordinates(false);
    await planJourney(
      DEMO_REPLAY.origin,
      DEMO_REPLAY.destination,
      DEMO_REPLAY.departure,
      'FEWEST_TRANSFERS',
    );
  }

  async function activate() {
    if (!selected) return;
    setBusy('activate');
    setError('');
    setMessage('');
    try {
      const historical = Date.parse(selected.start_at) < Date.now() - 60_000;
      const keyName = `${activationKey}.${selected.journey_id}`;
      const attemptKey = localStorage.getItem(keyName) ?? crypto.randomUUID();
      localStorage.setItem(keyName, attemptKey);
      const journey = await passengerApi.activate(
        selected,
        attemptKey,
        historical ? selected.start_at : undefined,
      );
      localStorage.removeItem(keyName);
      commitCurrentJourney(journey);
      setRecoveryStatus(null);
      acceptingRecovery.current = null;
      if (historical)
        setProgressAt(initialJakartaDateTime(new Date(selected.start_at)));
      setAlerts([]);
      setRecovery(null);
      localStorage.setItem(journeyKey, journey.journey_id);
      setReports([]);
      setReportsError('');
      setReportStatus('');
      setReportFormError('');
      void loadPersistedReports(journey.journey_id);
      setMessage(
        historical
          ? 'Controlled historical journey started. This is not live travel; progress is manual.'
          : 'Journey started. Progress is updated manually; location is not tracked.',
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  async function confirmBoarding() {
    if (!active || currentLeg === null) return;
    setBusy('boarding');
    setError('');
    try {
      const updated = await passengerApi.confirmBoarding(
        active.journey_id,
        currentLeg.sequence,
        toJakartaIso(progressAt),
        active.accepted_recovery_id ?? null,
      );
      commitCurrentJourney(updated);
      setMessage(
        `Naik dicatat pada bagian ${currentLeg.sequence + 1}: ${currentLeg.from.name}.`,
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  async function confirmAlighting() {
    if (!active || currentLeg === null) return;
    setBusy('alighting');
    setError('');
    try {
      const alighted = await passengerApi.confirmAlighting(
        active.journey_id,
        currentLeg.sequence,
        toJakartaIso(progressAt),
        active.accepted_recovery_id ?? null,
      );
      commitCurrentJourney(alighted);
      setMessage(
        `Turun dicatat pada bagian ${currentLeg.sequence + 1}: ${currentLeg.to.name}.`,
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  async function advanceLeg() {
    if (!active) return;
    const next = (active.progress?.completed_segment_count ?? 0) + 1;
    if (next > active.segments.length) return;
    setBusy('progress');
    setError('');
    try {
      const updated = await passengerApi.progress(
        active.journey_id,
        next,
        active.segments.length,
        toJakartaIso(progressAt),
        active.accepted_recovery_id ?? null,
      );
      commitCurrentJourney(updated);
      setMessage(
        updated.status === 'COMPLETED'
          ? 'Perjalanan selesai.'
          : `${next} dari ${updated.segments.length} bagian perjalanan selesai.`,
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(null);
    }
  }

  async function submitPassengerReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active) return;
    setReportFormError('');
    setReportStatus('');
    const target =
      reportTargets.find((item) => item.key === reportTargetKey) ?? null;
    if (!target) {
      setReportFormError(
        'Pilih lokasi atau layanan pada sisa perjalanan sebelum mengirim.',
      );
      return;
    }
    if (!isValidReportDescription(reportDescription)) {
      setReportFormError(
        'Keterangan wajib 1–2000 karakter dan tidak boleh memuat karakter kontrol.',
      );
      return;
    }
    let observedAt: string;
    try {
      observedAt = new Date(toJakartaIso(reportObservedAt)).toISOString();
    } catch {
      setReportFormError('Pilih waktu kejadian yang valid (WIB).');
      return;
    }
    const input = {
      active_journey_id: active.journey_id,
      category: reportCategory,
      observed_at: observedAt,
      mobility_entity_id: target.id,
      entity_type: target.type,
      description: reportDescription.trim(),
    };
    const fingerprint = JSON.stringify(input);
    if (reportKey.current?.fingerprint !== fingerprint)
      reportKey.current = { fingerprint, key: crypto.randomUUID() };
    setBusy('report');
    try {
      const report = await passengerApi.submitReport(
        input,
        reportKey.current.key,
      );
      setReports((current) => [
        report,
        ...current.filter((item) => item.report_id !== report.report_id),
      ]);
      setReportStatus(
        `Laporan tersimpan ${report.report_id} · ${
          report.verification_status === 'REPORTED_UNVERIFIED'
            ? 'Belum diverifikasi'
            : 'Terverifikasi melalui peninjauan terkendali'
        }. Laporan bukan konfirmasi penutupan layanan dan tetap tersimpan setelah refresh.`,
      );
      setReportDescription('');
      reportKey.current = null;
    } catch (cause) {
      setReportFormError(
        `Laporan gagal dikirim: ${errorMessage(cause)} Coba lagi.`,
      );
    } finally {
      setBusy(null);
    }
  }

  async function refreshPassengerReport(reportId: string) {
    setBusy('report');
    setReportsError('');
    try {
      const report = await passengerApi.getReport(reportId);
      setReports((current) =>
        current.map((item) =>
          item.report_id === report.report_id ? report : item,
        ),
      );
      setReportStatus(
        `Laporan ${report.report_id} · ${
          report.verification_status === 'REPORTED_UNVERIFIED'
            ? 'Belum diverifikasi'
            : 'Terverifikasi melalui peninjauan terkendali'
        }. Status menunjukkan peninjauan, bukan penutupan layanan.`,
      );
    } catch (cause) {
      setReportsError(
        `Status laporan tidak dapat dimuat ulang: ${errorMessage(cause)}`,
      );
    } finally {
      setBusy(null);
    }
  }

  async function proposeRecovery(alert: JourneyAlert) {
    const current = activeRef.current;
    if (!current || !alertIsCurrent(alert)) return;
    const requestId = ++recoveryRequestId.current;
    recoveryRequest.current?.controller.abort();
    const controller = new AbortController();
    const source = recoverySource(current);
    const generation = activeGeneration.current;
    recoveryRequest.current = { id: requestId, controller };
    setBusy('recovery');
    setError('');
    try {
      const key = recoveryProposalKey({
        journeyId: current.journey_id,
        impactId: alert.impact_id,
        revision: source.revision,
        acceptedRecoveryId: source.acceptedRecoveryId,
      });
      const timeKey = `transumin.recovery-at.${key}`;
      let recoveryAt = localStorage.getItem(timeKey);
      if (!recoveryAt) {
        recoveryAt = current.progress?.recorded_at ?? new Date().toISOString();
        localStorage.setItem(timeKey, recoveryAt);
      }
      const result = await passengerApi.recovery(
        current.journey_id,
        alert.impact_id,
        key,
        recoveryAt,
        controller.signal,
      );
      if (
        !canCommitRecovery({
          requestId,
          latestRequestId: recoveryRequestId.current,
          generation,
          latestGeneration: activeGeneration.current,
          captured: source,
          latest: recoveryJourney.current,
        }) ||
        result.original_journey_id !== source.journeyId
      )
        return;
      setRecovery(result);
      setAcceptance(null);
      acceptKey.current = null;
      localStorage.setItem(
        `${recoveryKey}.${current.journey_id}`,
        result.recovery_id,
      );
      setMessage(
        result.status === 'COMPLETED'
          ? 'Terdapat opsi recovery. Perjalanan aktif Anda belum berubah.'
          : recoverySummary(result),
      );
    } catch (cause) {
      if (requestId !== recoveryRequestId.current) return;
      if (
        cause instanceof Error &&
        (cause.name === 'AbortError' ||
          (cause as { cause?: unknown }).cause instanceof DOMException)
      )
        return;
      setError(errorMessage(cause));
    } finally {
      if (requestId === recoveryRequestId.current) {
        recoveryRequest.current = null;
        setBusy(null);
      }
    }
  }

  async function acceptRecovery(readOnly = false) {
    const current = activeRef.current;
    const proposal = recovery;
    if (
      !current ||
      !proposal ||
      acceptingRecovery.current ||
      proposal.original_journey_id !== current.journey_id
    )
      return;
    if (!readOnly && recoveryStatus) return;
    if (
      !readOnly &&
      (proposal.status !== 'COMPLETED' ||
        !proposal.proposed_journey ||
        (current.progress?.revision ?? 0) !== proposal.progress_revision)
    ) {
      setError(
        'Perjalanan sudah berubah atau proposal tidak aman. Minta recovery baru.',
      );
      return;
    }
    const source = recoverySource(current);
    const generation = activeGeneration.current;
    const requestId = ++recoveryRequestId.current;
    const controller = new AbortController();
    recoveryRequest.current?.controller.abort();
    recoveryRequest.current = { id: requestId, controller };
    acceptingRecovery.current = { key: proposal.recovery_id, id: requestId };
    const canCommit = () =>
      canCommitRecovery({
        requestId,
        latestRequestId: recoveryRequestId.current,
        generation,
        latestGeneration: activeGeneration.current,
        captured: source,
        latest: recoveryJourney.current,
      });
    setBusy('recovery');
    setError('');
    setMessage('');
    let receipt: RecoveryAcceptance | null = null;
    let postFailure: unknown = null;
    try {
      if (!readOnly) {
        if (!acceptKey.current) acceptKey.current = crypto.randomUUID();
        try {
          receipt = await passengerApi.acceptRecovery(
            proposal.recovery_id,
            proposal.progress_revision,
            acceptKey.current,
            controller.signal,
          );
        } catch (cause) {
          postFailure = cause;
        }
      }
      if (!canCommit()) return;
      setRecoveryStatus('RECONCILING');
      // POST outcome may be unknown. Only authoritative reads decide what
      // happened; a retry of this branch never issues another mutation.
      const authoritative = await passengerApi.reconcileRecovery(
        current.journey_id,
        proposal.recovery_id,
        controller.signal,
      );
      if (!canCommit()) return;
      const outcome = acceptanceReconcileOutcome({
        journey: authoritative.journey,
        recoveryId: proposal.recovery_id,
      });
      commitCurrentJourney(authoritative.journey);
      setRecovery(authoritative.recovery);
      setRecoveryStatus(null);
      if (outcome === 'APPLIED') {
        setAcceptance(receipt);
        setMessage('Recovery diterima. Rute aktif mengikuti rute pengganti.');
      } else {
        setAcceptance(null);
        setError(
          postFailure
            ? errorMessage(postFailure)
            : 'Recovery ini belum menjadi rute aktif. Tinjau status server sebelum mencoba lagi.',
        );
      }
    } catch (cause) {
      if (!canCommit()) return;
      setRecoveryStatus('NEEDS_RECONCILE');
      setError(
        receipt
          ? 'Recovery diterima server, tetapi rute aktif belum dapat dimuat. Muat ulang status; jangan kirim penerimaan baru.'
          : `Status penerimaan belum dapat dipastikan. Muat ulang status tanpa mengirim penerimaan baru. ${errorMessage(cause)}`,
      );
    } finally {
      if (requestId === recoveryRequestId.current) {
        recoveryRequest.current = null;
        acceptingRecovery.current = null;
        setBusy(null);
      }
    }
  }

  const displayed = selected ?? active;
  const displayingActive =
    !!displayed && !!active && displayed.journey_id === active.journey_id;
  const completed = active?.progress?.completed_segment_count ?? 0;
  const currentLeg =
    displayingActive && active.status === 'ACTIVE'
      ? (active.segments.find((segment) => segment.sequence === completed) ??
        null)
      : null;
  const boardedLeg =
    active?.progress?.boarding_confirmed_segment_sequence ?? null;
  const alightedLeg =
    active?.progress?.alighting_confirmed_segment_sequence ?? null;
  const journeyFinished = active?.status === 'COMPLETED';
  const isTransitLeg = currentLeg !== null && currentLeg.mode !== 'WALK';
  const currentBoarded =
    currentLeg !== null && boardedLeg === currentLeg.sequence;
  const currentAlighted =
    currentLeg !== null && alightedLeg === currentLeg.sequence;
  const easiestIds = easiestAmongShown(alternatives);
  const reportTargets =
    active?.status === 'ACTIVE'
      ? remainingReportTargets(active, completed)
      : [];
  const reportTargetValid = reportTargets.some(
    (item) => item.key === reportTargetKey,
  );
  const currentAlerts = alerts.filter(alertIsCurrent);
  const historicalAlerts = alerts.filter((alert) => !alertIsCurrent(alert));
  const boarding: { boarded: boolean; alighted: boolean } = {
    boarded: currentLeg !== null && boardedLeg === currentLeg.sequence,
    alighted: currentLeg !== null && alightedLeg === currentLeg.sequence,
  };
  const segments = active?.segments ?? [];
  const navMode: NavMode =
    displayingActive && active.status === 'ACTIVE'
      ? navigationMode(segments, completed, boarding)
      : 'PREPARING';
  const currentWalkLeg = currentLeg?.mode === 'WALK' ? currentLeg : null;
  const currentWalkNavigation = currentWalkLeg
    ? prepareWalkNavigation(currentWalkLeg)
    : null;
  // ponytail: concise hash identity; never emit full geometry/steps JSON to DOM.
  const walkScopeKey =
    active && currentWalkLeg
      ? `${active.journey_id}:${active.accepted_recovery_id ?? 'ORIGINAL'}:${walkGeometryIdentity(currentWalkLeg)}`
      : null;
  const scopedWalkProgress =
    currentWalkNavigation && walkState.key === walkScopeKey
      ? walkState.progress
      : null;
  const navGuidance =
    displayingActive && active.status === 'ACTIVE'
      ? nextGuidance(
          segments,
          completed,
          boarding,
          scopedWalkProgress ?? undefined,
        )
      : null;
  const offRouteActive =
    displayingActive && active.status === 'ACTIVE' && isWalkingMode(navMode)
      ? isOffRoute(navHistory.current, pathPoints(currentLeg))
      : false;
  const offRoute = displayingActive && !navigationPaused && offRouteActive;
  return (
    <main className="passenger-shell">
      <header className="passenger-header">
        <div className="passenger-brand">
          TRANSUM-IN <span>NEXUS</span>
        </div>
        <p>Passenger journey</p>
      </header>
      <div className="passenger-layout">
        <section className="passenger-main" aria-labelledby="search-heading">
          <div className="section-intro">
            <h1 id="search-heading">Plan a journey</h1>
            <p>
              Compare routes using the available research network. Times are
              schedules or estimates, not live vehicle positions.
            </p>
            <button
              type="button"
              className="text-button"
              disabled={busy !== null || !snapshotId}
              onClick={() => void loadScenario()}
            >
              Load presentation scenario (Gambir → Pejaten, route 6H)
            </button>
          </div>
          {DEMO_REPLAY.label && (
            <p className="replay-banner" role="note">
              <strong>{DEMO_REPLAY.label}</strong>
              <span>
                Scheduled network · 2 Oct 2026 · {DEMO_REPLAY.timezone} · no
                live vehicle data
              </span>
            </p>
          )}
          <form
            className="search-form"
            onSubmit={(event) => void search(event)}
          >
            <div className="place-grid endpoint-grid">
              {(['origin', 'destination'] as const).map((endpoint) => (
                <div className="endpoint-input" key={endpoint}>
                  <div
                    className="endpoint-modes"
                    role="group"
                    aria-label={`${endpoint === 'origin' ? 'From' : 'To'} input method`}
                  >
                    {(['place', 'pin', 'current', 'coordinates'] as const).map(
                      (mode) => (
                        <button
                          key={mode}
                          type="button"
                          className={
                            inputModes[endpoint] === mode ? 'selected' : ''
                          }
                          aria-pressed={inputModes[endpoint] === mode}
                          onClick={() => chooseEndpointMode(endpoint, mode)}
                        >
                          {mode === 'place'
                            ? 'Place'
                            : mode === 'pin'
                              ? 'Map pin'
                              : mode === 'current'
                                ? 'Current'
                                : 'Coordinates'}
                        </button>
                      ),
                    )}
                  </div>
                  {inputModes[endpoint] === 'place' && (
                    <PlaceSearch
                      label={endpoint === 'origin' ? 'From' : 'To'}
                      snapshotId={snapshotId}
                      value={
                        endpoint === 'origin' ? originPlace : destinationPlace
                      }
                      onSelect={
                        endpoint === 'origin'
                          ? setOriginPlace
                          : setDestinationPlace
                      }
                    />
                  )}
                  {inputModes[endpoint] === 'pin' && (
                    <p className="endpoint-note" role="status">
                      {(endpoint === 'origin' ? originPin : destinationPin)
                        ? `${endpoint === 'origin' ? 'Origin' : 'Destination'} pin selected on map. Click map or drag the pin to move it; pick another input method to stop choosing.`
                        : `Click the map on the right to choose ${endpoint === 'origin' ? 'an origin' : 'a destination'} pin. Switch input method to cancel.`}
                    </p>
                  )}
                  {inputModes[endpoint] === 'current' && (
                    <p className="endpoint-note" role="status">
                      {device.state === 'GPS_TRACKING'
                        ? 'Fresh accurate device location ready.'
                        : device.state === 'GPS_MAP_CONTEXT'
                          ? `Device location available for map context (accuracy ±${Math.round(device.position?.accuracy ?? 0)} m not yet navigation-grade). Use coordinates or a pin.`
                          : device.state === 'GPS_ACCURACY_LOW'
                            ? 'Device location accuracy is too low. Waiting for a better fix.'
                            : device.state === 'GPS_REQUESTING_PERMISSION'
                              ? 'Requesting device location permission…'
                              : 'Device location unavailable. Allow location and try again, or pick another input method.'}
                    </p>
                  )}
                  {inputModes[endpoint] === 'coordinates' && (
                    <p className="endpoint-note">
                      Coordinates for{' '}
                      {endpoint === 'origin' ? 'origin' : 'destination'} are in{' '}
                      <strong>Advanced below</strong>.
                    </p>
                  )}
                </div>
              ))}
            </div>
            <details
              className="coordinate-details"
              open={advancedCoordinates}
              onToggle={(event) => {
                setAdvancedCoordinates(event.currentTarget.open);
                if (event.currentTarget.open) {
                  if (inputModes.origin === 'place' && !originPlace)
                    chooseEndpointMode('origin', 'coordinates');
                  if (inputModes.destination === 'place' && !destinationPlace)
                    chooseEndpointMode('destination', 'coordinates');
                }
              }}
            >
              <summary>Advanced: enter coordinates instead</summary>
              <p>Use this only if your stop or station is not listed.</p>
              <div className="place-grid">
                <div>
                  <label htmlFor="origin-lat">Origin latitude</label>
                  <input
                    id="origin-lat"
                    inputMode="decimal"
                    value={originLat}
                    onChange={(event) => setOriginLat(event.target.value)}
                  />
                  <label htmlFor="origin-lon">Origin longitude</label>
                  <input
                    id="origin-lon"
                    inputMode="decimal"
                    value={originLon}
                    onChange={(event) => setOriginLon(event.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="destination-lat">Destination latitude</label>
                  <input
                    id="destination-lat"
                    inputMode="decimal"
                    value={destinationLat}
                    onChange={(event) => setDestinationLat(event.target.value)}
                  />
                  <label htmlFor="destination-lon">Destination longitude</label>
                  <input
                    id="destination-lon"
                    inputMode="decimal"
                    value={destinationLon}
                    onChange={(event) => setDestinationLon(event.target.value)}
                  />
                </div>
              </div>
            </details>
            <div className="search-actions">
              <label>
                Rank by
                <select
                  value={preference}
                  onChange={(event) =>
                    changePreference(event.target.value as JourneyPreference)
                  }
                >
                  <option value="BALANCED">Balanced</option>
                  <option value="FASTEST">Fastest</option>
                  <option value="FEWEST_TRANSFERS">Fewest transfers</option>
                  <option value="LEAST_WALKING">Least walking</option>
                </select>
              </label>
              <label>
                Depart (Jakarta time)
                <input
                  required
                  type="datetime-local"
                  value={departure}
                  onChange={(event) => setDeparture(event.target.value)}
                  onInput={(event) => setDeparture(event.currentTarget.value)}
                />
              </label>
              <button
                className="primary-button"
                type="submit"
                disabled={busy !== null || !snapshotId}
              >
                {busy === 'search' ? 'Finding routes...' : 'Find journeys'}
              </button>
            </div>
          </form>
          {error && (
            <div className="feedback error" role="alert">
              {error}
            </div>
          )}
          {message && (
            <div className="feedback" role="status">
              {message}
            </div>
          )}
          {rankingMessage && (
            <p className="ranking-note" role="status">
              {rankingMessage}
            </p>
          )}
          {active && (
            <p className="fine-print">
              Rank by applies to new searches only. Your active journey stays
              unchanged.
            </p>
          )}
          <section
            className="alternatives"
            aria-labelledby="alternatives-heading"
            aria-busy={busy === 'search'}
          >
            <div className="section-line">
              <h2 id="alternatives-heading">Journey choices</h2>
              <span>
                {alternatives.length > 0 ? `${alternatives.length} found` : ''}
              </span>
            </div>
            {busy === 'search' && (
              <div
                className="loading-rows"
                role="status"
                aria-label="Finding journeys"
              >
                <div />
                <div />
                <div />
              </div>
            )}
            {busy !== 'search' && alternatives.length === 0 && (
              <p className="empty-state">
                Search above to see real network routes for your chosen
                departure time.
              </p>
            )}
            {alternatives.length > 1 && (
              <p className="fine-print">
                Easiest among shown = fewest transfers, then least walking. Only
                returned candidates compared; fares unavailable.
              </p>
            )}
            {alternatives.map((journey, index) => (
              <button
                key={journey.journey_id}
                type="button"
                className={`alternative ${selected?.journey_id === journey.journey_id ? 'selected' : ''}`}
                onClick={() => setSelected(journey)}
                onFocus={() => setSelected(journey)}
                aria-pressed={selected?.journey_id === journey.journey_id}
              >
                <span className="alternative-time">
                  {formatClock(journey.start_at)} <span>to</span>{' '}
                  {formatClock(journey.end_at)}
                </span>
                <span className="alternative-route">
                  {distinctModes(journey).map((mode, modeIndex) => (
                    <span className="mode-symbol" key={mode}>
                      {modeIndex > 0 && <span aria-hidden="true">+</span>}
                      <ModeIcon mode={mode} />
                      <span>{modeName(mode)}</span>
                    </span>
                  ))}
                </span>
                <span className="alternative-meta">
                  {formatDuration(journey.duration_seconds)} ·{' '}
                  {transferLabel(journey.transfer_count)} ·{' '}
                  {formatDistance(journey.walking_distance_meters)} walking
                </span>
                <span className="alternative-index">
                  {alternatives.length > 1 &&
                    easiestIds.includes(journey.journey_id) && (
                      <strong>Easiest among shown · </strong>
                    )}
                  Option {index + 1}
                </span>
              </button>
            ))}
          </section>
        </section>
        <aside className="journey-detail" aria-labelledby="detail-heading">
          <div className="section-line">
            <h2 id="detail-heading">
              {displayingActive ? 'Your active journey' : 'Journey detail'}
            </h2>
          </div>
          {!displayed && (
            <>
              <p className="empty-state">
                Choose a journey to inspect its parts before starting.
              </p>
              <JourneyMap
                devicePosition={
                  device.position
                    ? {
                        ...device.position,
                        accuracy: device.position.accuracy ?? undefined,
                      }
                    : undefined
                }
                followDevicePosition={followDevice && !navigationPaused}
                selectionMode={selectionMode}
                originPin={originPin}
                destinationPin={destinationPin}
                onMapPointSelect={(point) => {
                  if (selectionMode === 'origin') setOriginPin(point);
                  if (selectionMode === 'destination') setDestinationPin(point);
                }}
                onOriginPinDrag={setOriginPin}
                onDestinationPinDrag={setDestinationPin}
              />
            </>
          )}
          {displayed && (
            <>
              {displayingActive &&
                Date.parse(displayed.start_at) < Date.now() - 60_000 && (
                  <p className="feedback">
                    Controlled historical journey · not live tracking.
                  </p>
                )}
              <div className="journey-summary">
                <strong>
                  {formatClock(displayed.start_at)} to{' '}
                  {formatClock(displayed.end_at)}
                </strong>
                <span>
                  {formatDuration(displayed.duration_seconds)} ·{' '}
                  {transferLabel(displayed.transfer_count)}
                </span>
              </div>
              <ol className="leg-list">
                {displayed.segments.map((segment) => {
                  const position = displayingActive
                    ? segmentPosition(segment.sequence, completed)
                    : null;
                  return (
                    <li
                      key={`${segment.sequence}-${segment.mode}`}
                      className={position ?? ''}
                      data-segment-sequence={String(segment.sequence)}
                      data-leg-fingerprint={walkGeometryIdentity(segment)}
                    >
                      <div className="leg-heading">
                        <span className="mode-symbol">
                          <ModeIcon mode={segment.mode} />
                          {modeName(segment.mode)}
                          {passengerRouteName(segment)
                            ? ` ${passengerRouteName(segment)}`
                            : ''}
                        </span>
                        <time>{formatClock(segment.start_at)}</time>
                      </div>
                      <p>
                        {segment.from.name} <span>to</span> {segment.to.name}
                      </p>
                      <small>
                        {formatDuration(segment.duration_seconds)}
                        {segment.mode === 'WALK'
                          ? ` · ${formatDistance(segment.distance_meters)} router estimate · path not independently validated`
                          : ''}
                        {position ? ` · ${position}` : ''}
                      </small>
                    </li>
                  );
                })}
              </ol>
              {displayed.fare_status === 'UNKNOWN' && (
                <p className="fine-print">Fare information is unavailable.</p>
              )}
              <JourneyMap
                journey={displayed}
                completedSegmentCount={completed}
                activeSegmentSequence={
                  displayingActive ? (currentLeg?.sequence ?? null) : null
                }
                devicePosition={
                  device.position
                    ? {
                        ...device.position,
                        accuracy: device.position.accuracy ?? undefined,
                      }
                    : undefined
                }
                followDevicePosition={followDevice && !navigationPaused}
                selectionMode={selectionMode}
                originPin={originPin}
                destinationPin={destinationPin}
                onMapPointSelect={(point) => {
                  if (selectionMode === 'origin') setOriginPin(point);
                  else if (selectionMode === 'destination')
                    setDestinationPin(point);
                  setSelectionMode(null);
                }}
                onOriginPinDrag={setOriginPin}
                onDestinationPinDrag={setDestinationPin}
              />
              <details className="evidence-details">
                <summary>Schedule and source details</summary>
                <p>
                  Router: {displayed.routing_context.provider}{' '}
                  {displayed.routing_context.provider_version}. Network
                  snapshot: {displayed.routing_context.network_snapshot_id}.
                  Service date: {displayed.routing_context.common_service_date}{' '}
                  ({displayed.routing_context.timezone}). Frequency-derived
                  departures are not exact guarantees.
                </p>
              </details>
              {!displayingActive && (
                <button
                  type="button"
                  className="primary-button full"
                  disabled={busy !== null}
                  onClick={() => void activate()}
                >
                  {busy === 'activate' ? 'Memulai…' : 'Mulai Perjalanan'}
                </button>
              )}
              {displayingActive && active && (
                <div className="progress-actions">
                  <p>
                    {completed} of {active.segments.length} parts complete.
                    Progress is manual; device location is never used as proof.
                  </p>
                  <div
                    className={`navigation-card${navigationPaused ? ' paused' : ''}${offRoute ? ' off-route' : ''}`}
                    role="region"
                    aria-label={`${modeNavLabel(navMode)}${navGuidance?.title ? `: ${navGuidance.title}` : ''}`}
                    data-provenance={navGuidance?.provenance ?? 'NO_DEVICE'}
                    data-walk-evidence={
                      currentWalkNavigation?.evidence ?? 'NONE'
                    }
                    data-maneuver-index={
                      scopedWalkProgress ? scopedWalkProgress.maneuverIndex : -1
                    }
                    data-maneuver-total={
                      currentWalkNavigation?.maneuvers.length ?? 0
                    }
                    data-walk-status={scopedWalkProgress?.status ?? 'none'}
                    data-navigation-scope={walkScopeKey ?? 'none'}
                    data-navigation-paused={navigationPaused ? 'true' : 'false'}
                    data-walk-reposition={
                      scopedWalkProgress?.needsManualReposition
                        ? 'true'
                        : 'false'
                    }
                  >
                    <strong className="navigation-title">
                      {navGuidance ? navGuidance.title : modeNavLabel(navMode)}
                    </strong>
                    {navGuidance && (
                      <p className="fine-print">{navGuidance.detail}</p>
                    )}
                    {navGuidance?.provenance === 'SCHEMATIC_GEOMETRY' && (
                      <p className="fine-print">
                        Petunjuk jalan kaki skematik — hanya jarak pada geometri
                        rute OTP, bukan petunjuk belok tervalidasi, bukan jadwal
                        kendaraan langsung.
                      </p>
                    )}
                    {navGuidance?.provenance === 'OTP_DERIVED_MANEUVER' && (
                      <p className="fine-print">
                        Maneuver OTP pada snapshot rute; belum divalidasi
                        independen. Posisi perangkat mentah ditampilkan di peta
                        tanpa snapping.
                      </p>
                    )}
                    {!navGuidance && (
                      <p className="fine-print">
                        Navigasi belum tersedia. Gunakan penandaan manual di
                        bawah.
                      </p>
                    )}
                    {currentWalkNavigation?.evidence ===
                      'OTP_DERIVED_MANEUVER' && (
                      <p className="fine-print" data-testid="walk-progress">
                        Langkah {(scopedWalkProgress?.maneuverIndex ?? 0) + 1}{' '}
                        dari {currentWalkNavigation.maneuvers.length}
                        {navGuidance?.nextInstruction &&
                        navGuidance.nextDistanceMeters !== null &&
                        Number.isFinite(navGuidance.nextDistanceMeters)
                          ? ` · berikutnya ±${Math.round(navGuidance.nextDistanceMeters)} m: ${navGuidance.nextInstruction}`
                          : ''}
                        {navGuidance?.remainingMeters !== undefined &&
                        navGuidance.remainingMeters !== null &&
                        Number.isFinite(navGuidance.remainingMeters)
                          ? ` · sisa leg ±${Math.round(navGuidance.remainingMeters)} m`
                          : ''}
                        {scopedWalkProgress?.status === 'ACQUIRING'
                          ? ' · GPS: memperoleh sinyal'
                          : scopedWalkProgress?.status === 'UNCERTAIN'
                            ? ' · GPS: tidak pasti'
                            : scopedWalkProgress?.status === 'PAUSED'
                              ? ' · GPS: dijeda'
                              : ''}
                      </p>
                    )}
                    {currentWalkNavigation?.evidence ===
                      'SCHEMATIC_GEOMETRY' && (
                      <p className="fine-print" data-testid="walk-schematic">
                        {currentWalkNavigation.reason ??
                          'Langkah belok tidak tersedia.'}
                        {navGuidance?.remainingMeters !== undefined &&
                        navGuidance.remainingMeters !== null &&
                        Number.isFinite(navGuidance.remainingMeters)
                          ? ` Sisa leg ±${Math.round(navGuidance.remainingMeters)} m.`
                          : ''}
                      </p>
                    )}
                    {offRoute && (
                      <p
                        className="feedback warning"
                        role="alert"
                        data-provenance="SCHEMATIC_GEOMETRY"
                      >
                        Di luar jalur rute — pertimbangkan merencanakan ulang
                        atau kembali ke jalur rute yang direncanakan.
                      </p>
                    )}
                    <p className="fine-print">
                      Tujuan: {navGuidance?.destination ?? 'belum tersedia'} ·
                      Status navigasi: {modeNavLabel(navMode)}{' '}
                      {navigationPaused ? '· dijeda' : ''}
                    </p>
                    <div className="text-button-row">
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setNavigationPaused((value) => !value)}
                      >
                        {navigationPaused
                          ? 'Lanjutkan navigasi'
                          : 'Jeda navigasi'}
                      </button>
                      {currentWalkNavigation?.evidence ===
                        'OTP_DERIVED_MANEUVER' && (
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => {
                            const prepared = walkNavigation.current;
                            if (!prepared || walkScopeKey !== walkState.key)
                              return;
                            const next = {
                              key: walkScopeKey,
                              progress: manuallyAdvanceManeuver(
                                prepared,
                                walkState.progress,
                              ),
                            };
                            walkStateRef.current = next;
                            setWalkState(next);
                          }}
                        >
                          Manuver berikutnya
                        </button>
                      )}
                    </div>
                  </div>
                  {currentLeg && (
                    <div className="external-handoff">
                      <p className="fine-print">
                        Lanjutkan dengan transportasi eksternal (buka situs
                        resmi; pemesanan tetap di aplikasi penyedia, koordinat
                        tidak dikirim otomatis):
                      </p>
                      {[
                        { name: 'Gojek', href: 'https://gojek.com' },
                        { name: 'Grab', href: 'https://grab.com' },
                        {
                          name: 'Bluebird',
                          href: 'https://bluebirdgroup.com/',
                        },
                      ].map((provider) => (
                        <a
                          key={provider.name}
                          className="external-handoff-link"
                          href={provider.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          data-handoff={provider.name.toLowerCase()}
                        >
                          Lanjutkan dengan {provider.name}
                        </a>
                      ))}
                    </div>
                  )}
                  {journeyFinished ? (
                    <p className="feedback" role="status">
                      Selesaikan Perjalanan — perjalanan ini sudah selesai.
                    </p>
                  ) : (
                    <>
                      {currentLeg && (
                        <div className="current-leg">
                          <strong className="mode-symbol">
                            <ModeIcon mode={currentLeg.mode} />
                            {modeName(currentLeg.mode)}
                            {passengerRouteName(currentLeg)
                              ? ` ${passengerRouteName(currentLeg)}`
                              : ''}
                          </strong>
                          <p>
                            {currentLeg.from.name} <span>to</span>{' '}
                            {currentLeg.to.name}
                          </p>
                          <small>
                            {currentLeg.mode === 'WALK'
                              ? 'Bagian jalan kaki · lanjutkan saat Anda sampai.'
                              : currentBoarded
                                ? `Naik tercatat di ${currentLeg.from.name}. Turun di ${currentLeg.to.name}.`
                                : `Naik di ${currentLeg.from.name}, turun di ${currentLeg.to.name}.`}
                          </small>
                        </div>
                      )}
                      <label>
                        Progress time (Jakarta, controlled)
                        <input
                          required
                          type="datetime-local"
                          value={progressAt}
                          onChange={(event) =>
                            setProgressAt(event.target.value)
                          }
                          onInput={(event) =>
                            setProgressAt(event.currentTarget.value)
                          }
                        />
                      </label>
                      <p className="fine-print">
                        For a historical research journey, enter the actual
                        controlled scenario time. This is not GPS or live
                        tracking.
                      </p>
                      {isTransitLeg && !currentBoarded && (
                        <button
                          type="button"
                          className="primary-button full"
                          disabled={busy !== null}
                          onClick={() => void confirmBoarding()}
                        >
                          {busy === 'boarding'
                            ? 'Menyimpan…'
                            : 'Saya Sudah Naik'}
                        </button>
                      )}
                      {isTransitLeg && currentBoarded && !currentAlighted && (
                        <button
                          type="button"
                          className="primary-button full"
                          disabled={busy !== null}
                          onClick={() => void confirmAlighting()}
                        >
                          {busy === 'alighting'
                            ? 'Menyimpan…'
                            : 'Saya Sudah Turun'}
                        </button>
                      )}
                      {isTransitLeg && currentAlighted && (
                        <button
                          type="button"
                          className="primary-button full"
                          disabled={
                            busy !== null ||
                            completed + 1 > active.segments.length
                          }
                          onClick={() => void advanceLeg()}
                        >
                          {busy === 'progress'
                            ? 'Menyimpan…'
                            : 'Lanjutkan Perjalanan'}
                        </button>
                      )}
                      {!isTransitLeg && (
                        <button
                          type="button"
                          className="primary-button full"
                          disabled={
                            busy !== null || completed >= active.segments.length
                          }
                          onClick={() => void advanceLeg()}
                        >
                          {busy === 'progress'
                            ? 'Menyimpan…'
                            : completed + 1 >= active.segments.length
                              ? 'Selesaikan Perjalanan'
                              : 'Lanjutkan Perjalanan'}
                        </button>
                      )}
                      <details className="evidence-details gps-consent">
                        <summary>Lokasi perangkat (opsional)</summary>
                        <p>
                          Lokasi perangkat tidak pernah menjadi bukti otomatis
                          naik, turun, atau selesai. Anda tetap menandai
                          perjalanan secara manual.
                        </p>
                        {(device.state === 'GPS_OFF' ||
                          device.state === 'GPS_STOPPED') && (
                          <button
                            type="button"
                            className="text-button"
                            onClick={device.start}
                          >
                            Aktifkan Lokasi Langsung
                          </button>
                        )}
                        {device.state === 'GPS_REQUESTING_PERMISSION' && (
                          <p>Meminta izin lokasi…</p>
                        )}
                        {device.state === 'GPS_PERMISSION_DENIED' && (
                          <p className="feedback error" role="alert">
                            Izin lokasi ditolak. Lanjutkan menandai perjalanan
                            secara manual.
                          </p>
                        )}
                        {device.state === 'GPS_UNAVAILABLE' && (
                          <p className="fine-print">
                            Peramban ini tidak mendukung lokasi perangkat.
                            Gunakan penandaan manual.
                          </p>
                        )}
                        {device.state === 'GPS_ERROR' && (
                          <p className="feedback error" role="alert">
                            Lokasi tidak tersedia. Gunakan penandaan manual.
                          </p>
                        )}
                        {device.state === 'GPS_TRACKING' && (
                          <p role="status">Lokasi langsung aktif.</p>
                        )}
                        {device.state === 'GPS_MAP_CONTEXT' && (
                          <p role="status">
                            Lokasi tersedia untuk konteks peta. Akurasi belum
                            cukup untuk panduan navigasi atau deteksi keluar
                            jalur.
                          </p>
                        )}
                        {device.state === 'GPS_ACCURACY_LOW' && (
                          <p role="status">
                            Akurasi lokasi rendah. Tunggu sinyal membaik;
                            penandaan tetap manual.
                          </p>
                        )}
                        {device.state === 'GPS_STOPPED' && (
                          <p role="status">Berbagi lokasi dihentikan.</p>
                        )}
                        {device.state === 'GPS_STALE' && (
                          <p className="fine-print">
                            Lokasi terakhir sudah tidak segar. Gerakkan
                            perangkat atau buka ulang halaman untuk memperbarui.
                          </p>
                        )}
                        {device.position && device.state !== 'GPS_OFF' && (
                          <>
                            <p className="fine-print">
                              Lokasi perangkat:{' '}
                              {device.position.latitude.toFixed(5)},{' '}
                              {device.position.longitude.toFixed(5)}{' '}
                              {device.position.accuracy !== null &&
                                `· akurasi ±${Math.round(device.position.accuracy)} m`}{' '}
                              {device.position.heading !== null &&
                                `· arah ${Math.round(device.position.heading)}°`}{' '}
                              · pembaruan terakhir{' '}
                              {formatClock(
                                new Date(
                                  device.position.timestamp,
                                ).toISOString(),
                              )}
                              . Ini konteks saja, bukan posisi kendaraan.
                            </p>
                            <p className="text-button-row">
                              <button
                                type="button"
                                className="text-button"
                                onClick={() =>
                                  setFollowDevice((value) => !value)
                                }
                              >
                                {followDevice
                                  ? 'Kamera bebas (berhenti mengikuti)'
                                  : 'Ikuti lokasi saya'}
                              </button>
                              <button
                                type="button"
                                className="text-button"
                                onClick={device.stop}
                              >
                                Berhenti berbagi lokasi
                              </button>
                            </p>
                          </>
                        )}
                      </details>
                    </>
                  )}
                </div>
              )}
            </>
          )}
          {active?.status === 'ACTIVE' && (
            <section
              className="operational-section"
              aria-labelledby="report-heading"
            >
              <div className="section-line">
                <h2 id="report-heading">Laporkan kondisi</h2>
                <span>{reports.length} tersimpan</span>
              </div>
              <p className="fine-print">
                Laporan penumpang bersifat <strong>belum terverifikasi</strong>{' '}
                dan tidak otomatis menutup atau mengubah layanan. Laporan hanya
                tercatat pada perjalanan aktif dan tidak memerlukan lokasi
                perangkat.
              </p>
              {reportTargets.length === 0 ? (
                <p className="empty-state">
                  Tidak ada target sisa perjalanan yang dapat dilaporkan.
                  Selesaikan atau mulai perjalanan baru untuk melaporkan
                  kondisi.
                </p>
              ) : (
                <form
                  onSubmit={(event) => void submitPassengerReport(event)}
                  noValidate
                  aria-describedby="report-help"
                >
                  <p id="report-help" className="fine-print">
                    Pilih lokasi atau layanan pada sisa perjalanan. Laporan
                    tersimpan di server dan dimuat ulang saat halaman
                    di-refresh.
                  </p>
                  <label htmlFor="report-target">
                    Lokasi atau layanan pada sisa perjalanan
                    <select
                      id="report-target"
                      required
                      value={reportTargetValid ? reportTargetKey : ''}
                      onChange={(event) => {
                        setReportTargetKey(event.target.value);
                        reportKey.current = null;
                        setError('');
                      }}
                      aria-invalid={reportTargetKey ? 'false' : undefined}
                      aria-describedby="report-target-help"
                    >
                      <option value="">Pilih bagian perjalanan</option>
                      {reportTargets.map((item) => (
                        <option key={item.key} value={item.key}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p id="report-target-help" className="fine-print">
                    Hanya sisa bagian perjalanan yang ditampilkan. Provenance
                    target terpilih:{' '}
                    {reportTargets.find((t) => t.key === reportTargetKey)
                      ?.provenance ??
                      '— pilih target sisa perjalanan untuk melihat provenance'}
                  </p>
                  <label htmlFor="report-category">
                    Kategori laporan
                    <select
                      id="report-category"
                      value={reportCategory}
                      onChange={(event) => {
                        setReportCategory(event.target.value);
                        reportKey.current = null;
                      }}
                    >
                      <option value="CLEANLINESS">Kebersihan</option>
                      <option value="CROWDING">Kepadatan</option>
                      <option value="ACCESSIBILITY">Aksesibilitas</option>
                      <option value="SAFETY">Keselamatan</option>
                      <option value="SERVICE">Layanan</option>
                      <option value="OTHER">Lainnya</option>
                    </select>
                  </label>
                  <label htmlFor="report-observed-at">
                    Waktu kejadian (WIB)
                    <input
                      id="report-observed-at"
                      type="datetime-local"
                      required
                      value={reportObservedAt}
                      onChange={(event) => {
                        setReportObservedAt(event.target.value);
                        reportKey.current = null;
                      }}
                    />
                  </label>
                  <label htmlFor="report-description">
                    Keterangan
                    <textarea
                      id="report-description"
                      required
                      maxLength={2000}
                      rows={4}
                      value={reportDescription}
                      onChange={(event) => {
                        setReportDescription(event.target.value);
                        reportKey.current = null;
                      }}
                      aria-describedby="report-description-help"
                      aria-invalid={
                        reportDescription.trim().length === 0 ||
                        reportDescription.length > 2000
                          ? undefined
                          : 'false'
                      }
                      placeholder="Jelaskan kondisi yang Anda amati pada layanan atau lokasi terpilih"
                    />
                  </label>
                  <p id="report-description-help" className="fine-print">
                    {reportDescription.length}/2000 karakter · minimal 1
                    karakter, tanpa karakter kontrol.
                  </p>
                  <button
                    className="primary-button full"
                    type="submit"
                    disabled={
                      busy !== null ||
                      !reportTargetValid ||
                      !reportDescription.trim()
                    }
                  >
                    {busy === 'report' ? 'Mengirim…' : 'Kirim laporan'}
                  </button>
                </form>
              )}
              {reportFormError && (
                <p role="alert" className="feedback error">
                  {reportFormError}
                </p>
              )}
              {reportStatus && (
                <p role="status" aria-live="polite" className="feedback">
                  {reportStatus}
                </p>
              )}
              <div
                className="report-list"
                aria-live="polite"
                aria-busy={reportsLoading ? 'true' : 'false'}
              >
                {reportsLoading && (
                  <p role="status" className="fine-print">
                    Memuat laporan…
                  </p>
                )}
                {reportsError && (
                  <div className="feedback error" role="alert">
                    <p>{reportsError}</p>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() =>
                        active && void loadPersistedReports(active.journey_id)
                      }
                      disabled={reportsLoading}
                    >
                      Coba lagi
                    </button>
                  </div>
                )}
                {!reportsLoading && !reportsError && reports.length === 0 && (
                  <p className="empty-state">
                    Belum ada laporan untuk perjalanan ini. Laporan yang dikirim
                    akan muncul di sini dan tetap ada setelah refresh.
                  </p>
                )}
                {reports.map((report) => (
                  <article
                    className="alert-card"
                    key={report.report_id}
                    aria-label={`Laporan ${report.report_id}`}
                  >
                    <div className="alert-topline">
                      <strong>
                        {report.category} ·{' '}
                        {report.verification_status === 'REPORTED_UNVERIFIED'
                          ? 'Belum diverifikasi'
                          : 'Terverifikasi terkendali'}
                      </strong>
                      <span
                        className={
                          report.verification_status === 'REPORTED_UNVERIFIED'
                            ? 'evidence simulated'
                            : 'evidence'
                        }
                      >
                        {report.verification_status === 'REPORTED_UNVERIFIED'
                          ? 'Belum diverifikasi'
                          : 'Terverifikasi'}
                      </span>
                    </div>
                    <p>{report.description}</p>
                    <small>
                      Target: {report.mobility_entity_id} · {report.entity_type}{' '}
                      · diamati {formatClock(report.observed_at)} · diterima{' '}
                      {formatClock(report.received_at)}
                    </small>
                    <small className="fine-print">
                      Laporan bukan konfirmasi penutupan layanan.
                    </small>
                    <button
                      className="text-button"
                      type="button"
                      disabled={busy === 'report'}
                      onClick={() =>
                        void refreshPassengerReport(report.report_id)
                      }
                    >
                      Muat ulang status
                    </button>
                  </article>
                ))}
              </div>
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  active && void loadPersistedReports(active.journey_id)
                }
                disabled={reportsLoading || !active}
              >
                Muat ulang daftar laporan
              </button>
            </section>
          )}
          {active && (
            <section
              className="operational-section"
              aria-labelledby="alert-heading"
            >
              <div className="section-line">
                <h2 id="alert-heading">Journey updates</h2>
                <span>{currentAlerts.length} current</span>
              </div>
              <p className="fine-print">
                {streamStatus === 'CONNECTED'
                  ? 'Connected to journey-specific updates.'
                  : streamStatus === 'RECONNECTING'
                    ? 'Reconnecting to journey updates. Latest alerts remain available.'
                    : streamStatus === 'CONNECTING'
                      ? 'Connecting to journey updates…'
                      : 'Journey updates are offline. Reload to retry.'}
              </p>
              {alertError && (
                <p className="feedback error" role="alert">
                  Updates could not be refreshed: {alertError}
                </p>
              )}
              {currentAlerts.length === 0 && (
                <p className="empty-state">
                  No current disruption alert for this journey. This does not
                  confirm that every service is available.
                </p>
              )}
              {currentAlerts.map((alert) => (
                <article
                  key={alert.alert_id}
                  className="alert-card"
                  aria-label="Targeted journey alert"
                >
                  <div className="alert-topline">
                    <strong className="mode-symbol">
                      <WarningCircleIcon
                        size={19}
                        weight="regular"
                        aria-hidden="true"
                      />
                      {alert.operational_state.replaceAll('_', ' ')}
                    </strong>
                    <span
                      className={
                        alert.evidence_type === 'SIMULATED'
                          ? 'evidence simulated'
                          : 'evidence'
                      }
                    >
                      {evidenceLabel(alert.evidence_type)}
                    </span>
                  </div>
                  <p>{alert.message}</p>
                  <small>
                    Part
                    {alert.affected_segment_sequences.length === 1
                      ? ''
                      : 's'}{' '}
                    {alert.affected_segment_sequences
                      .map((sequence) => sequence + 1)
                      .join(', ')}{' '}
                    affected · observed{' '}
                    {alert.observed_at
                      ? formatClock(alert.observed_at)
                      : 'time unknown'}{' '}
                    · {alert.freshness_status.toLowerCase()}
                  </small>
                  <details className="evidence-details">
                    <summary>Source and evidence</summary>
                    <p>
                      Source: {alert.source_id ?? 'not identified'} ·{' '}
                      {alert.provenance_ref ?? 'No source reference'} · expires:{' '}
                      {alert.expires_at ?? 'not specified'}.
                    </p>
                  </details>
                  <button
                    type="button"
                    className="primary-button full"
                    disabled={
                      busy !== null || alert.operational_state === 'RECOVERING'
                    }
                    onClick={() => void proposeRecovery(alert)}
                  >
                    {busy === 'recovery'
                      ? 'Finding a safe option...'
                      : 'Find another way'}
                  </button>
                </article>
              ))}
              {historicalAlerts.length > 0 && (
                <details className="evidence-details alert-history">
                  <summary>
                    Retained incident history ({historicalAlerts.length})
                  </summary>
                  <ul className="compact-legs">
                    {historicalAlerts.map((alert) => (
                      <li key={alert.alert_id}>
                        <span className="structure-tag completed">
                          {alert.resolved_at ? 'Resolved' : 'Expired'}
                        </span>
                        <strong>
                          {alert.operational_state.replaceAll('_', ' ')}
                        </strong>
                        <small>
                          {alert.message} ·{' '}
                          {alert.resolved_at
                            ? `closed ${formatClock(alert.resolved_at)}`
                            : 'no longer current'}
                        </small>
                      </li>
                    ))}
                  </ul>
                  <p>
                    Historical evidence is retained. Closed alerts no longer
                    affect your current journey status.
                  </p>
                </details>
              )}
            </section>
          )}
          {active &&
            recovery &&
            recovery.original_journey_id === active.journey_id && (
              <section
                className="operational-section"
                aria-labelledby="recovery-heading"
              >
                <div className="section-line">
                  <h2 id="recovery-heading">Recovery option</h2>
                </div>
                {recoveryStatus && (
                  <div className="feedback warning" role="status">
                    <p>
                      Status penerimaan perlu dicocokkan dengan server. Rute
                      tampilan belum dipastikan.
                    </p>
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy !== null}
                      onClick={() => void acceptRecovery(true)}
                    >
                      Muat ulang status (tanpa menerima ulang)
                    </button>
                  </div>
                )}
                <p className="recovery-summary">{recoverySummary(recovery)}</p>
                <p className="fine-print">
                  This is a proposal. It does not automatically replace your
                  active journey.
                </p>
                {active.progress?.revision !== recovery.progress_revision && (
                  <p className="feedback error" role="status">
                    Journey progress has changed since this proposal. Request a
                    fresh recovery before using it.
                  </p>
                )}
                {recovery.status === 'COMPLETED' &&
                  recovery.proposed_journey &&
                  (acceptance || recovery.accepted ? (
                    <p className="feedback" role="status">
                      Recovery accepted{' '}
                      {formatClock(
                        acceptance?.accepted_at ?? recovery.accepted_at!,
                      )}
                      . The original plan stays saved; your active journey now
                      follows the repaired route.
                    </p>
                  ) : (
                    <button
                      type="button"
                      className="primary-button full"
                      disabled={
                        busy !== null ||
                        active.progress?.revision !== recovery.progress_revision
                      }
                      onClick={() => void acceptRecovery()}
                    >
                      {busy === 'recovery'
                        ? 'Applying the repaired route...'
                        : 'Use this repaired route'}
                    </button>
                  ))}
                <div className="comparison-grid">
                  <div>
                    <h3>Original remaining trip</h3>
                    <ol className="compact-legs">
                      {active.segments
                        .filter(
                          (segment) =>
                            segment.sequence >=
                            recovery.completed_segment_count,
                        )
                        .map((segment) => (
                          <li key={segment.sequence}>
                            <span
                              className={`structure-tag ${recoveryPart(segment.sequence, recovery).toLowerCase()}`}
                            >
                              {alerts.some(
                                (alert) =>
                                  alert.impact_id === recovery.impact_id &&
                                  alert.affected_segment_sequences.includes(
                                    segment.sequence,
                                  ),
                              )
                                ? 'Affected by disruption'
                                : recoveryPartLabel(
                                    recoveryPart(segment.sequence, recovery),
                                  )}
                            </span>
                            <strong>
                              {modeName(segment.mode)}
                              {passengerRouteName(segment)
                                ? ` ${passengerRouteName(segment)}`
                                : ''}
                            </strong>
                            <small>
                              {segment.from.name} → {segment.to.name}
                            </small>
                          </li>
                        ))}
                    </ol>
                  </div>
                  <div>
                    <h3>Recommended route</h3>
                    {recovery.proposed_journey ? (
                      <ol className="compact-legs">
                        {recovery.proposed_journey.segments.map((segment) => (
                          <li key={segment.sequence}>
                            <span className="structure-tag">
                              {active.segments.some(
                                (original) =>
                                  recovery.rejoined_segments.includes(
                                    original.sequence,
                                  ) && samePassengerLeg(original, segment),
                              )
                                ? 'Rejoins original trip'
                                : active.segments.some(
                                      (original) =>
                                        recovery.preserved_segments.includes(
                                          original.sequence,
                                        ) &&
                                        samePassengerLeg(original, segment),
                                    )
                                  ? 'Stays the same'
                                  : 'New connection'}
                            </span>
                            <strong>
                              {modeName(segment.mode)}
                              {passengerRouteName(segment)
                                ? ` ${passengerRouteName(segment)}`
                                : ''}
                            </strong>
                            <small>
                              {segment.from.name} → {segment.to.name}
                            </small>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p>No safe replacement is available.</p>
                    )}
                  </div>
                </div>
                <p className="fine-print">
                  {recovery.rejoin_status === 'REJOINED'
                    ? 'The route reconnects with a valid part of your original trip.'
                    : recovery.rejoin_status === 'SUFFIX_REPLANNED'
                      ? 'The remaining route was replanned because reconnecting was not feasible.'
                      : 'A safe connection could not be found.'}
                </p>
                <details className="evidence-details">
                  <summary>
                    Compare with a fresh plan and view research detail
                  </summary>
                  <p>
                    Full replan from the same recovery point:{' '}
                    {recovery.baseline_journey
                      ? `${formatDuration(recovery.baseline_journey.duration_seconds)}, ${recovery.baseline_journey.transfer_count} transfers`
                      : 'no route available'}
                    . Preserved {recovery.preserved_segment_count} original
                    future parts; replaced {recovery.changed_segment_count}.
                    Network snapshot {recovery.network_snapshot_id}; projection{' '}
                    {recovery.mobility_projection_version}. Recovery ID{' '}
                    {recovery.recovery_id}.
                  </p>
                </details>
              </section>
            )}
        </aside>
      </div>
    </main>
  );
}
