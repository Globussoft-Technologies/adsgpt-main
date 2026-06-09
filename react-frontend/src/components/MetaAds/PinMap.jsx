/**
 * PinMap — Leaflet/OpenStreetMap map for Phase 3A's drop-pin radius
 * targeting. Click anywhere to drop a pin; existing custom pins render
 * as markers with their radius circle. Coordinates flow back up as
 * `type: 'custom'` locations → Meta `geo_locations.custom_locations`.
 *
 * Lazy-loaded by LocationTargeting so Leaflet stays out of the main
 * bundle until the user opens the map.
 */

import React, { useEffect } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Circle,
  useMapEvents,
  useMap,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const PIN_COLOR = '#15DCFF';

// Leaflet's default PNG marker doesn't resolve reliably under the bundler
// (shows as a broken image). Use a self-contained inline-SVG divIcon
// instead — no asset to 404, and it matches the cyan radius circle.
const PIN_ICON = L.divIcon({
  className: 'adsgpt-pin',
  html: `<svg width="26" height="36" viewBox="0 0 26 36" xmlns="http://www.w3.org/2000/svg">
    <path d="M13 0C5.82 0 0 5.82 0 13c0 9.2 13 23 13 23s13-13.8 13-23C26 5.82 20.18 0 13 0z" fill="${PIN_COLOR}"/>
    <circle cx="13" cy="13" r="5" fill="#0b0b0b"/>
  </svg>`,
  iconSize: [26, 36],
  iconAnchor: [13, 36],
});

// Capture map clicks → add a pin.
function ClickToAdd({ onAdd }) {
  useMapEvents({
    click(e) {
      onAdd(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// A map rendered inside a modal/toggled panel can mis-measure its size
// on first paint (tiles grey out / off-centre). Force a re-measure once
// it's mounted + visible.
function InvalidateOnMount() {
  const map = useMap();
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 0);
    return () => clearTimeout(t);
  }, [map]);
  return null;
}

// Pan/zoom to the most-recently-added pin so a freshly selected city or
// dropped pin comes into view (Meta centres on your selection).
function FlyToLast({ pins }) {
  const map = useMap();
  const last = pins.length ? pins[pins.length - 1] : null;
  const lat = last?.latitude;
  const lng = last?.longitude;
  useEffect(() => {
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      map.flyTo([lat, lng], Math.max(map.getZoom(), 8), { duration: 0.6 });
    }
  }, [map, lat, lng]);
  return null;
}

export default function PinMap({ pins = [], onAdd }) {
  // Centre on the first pin if any, else a wide world view.
  const center = pins.length
    ? [pins[0].latitude, pins[0].longitude]
    : [20, 0];
  const zoom = pins.length ? 5 : 2;

  return (
    // `relative isolate` creates a NEW stacking context — without this,
    // Leaflet's internal panes/controls (z-200..z-800 by default) paint
    // OVER sibling modal chrome (the wizard close button, date-picker
    // popups, etc.) because Leaflet's `.leaflet-container` uses bare
    // position:relative without z-index. Isolation contains every
    // Leaflet z-index inside this div; the div itself stacks relative
    // to the modal at its parent's natural order.
    <div className="relative isolate overflow-hidden rounded-xl border border-gray-200 dark:border-white/10">
      <MapContainer
        center={center}
        zoom={zoom}
        scrollWheelZoom
        style={{ height: 280, width: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ClickToAdd onAdd={onAdd} />
        <InvalidateOnMount />
        <FlyToLast pins={pins} />
        {pins.map((p) => (
          <React.Fragment key={p.key}>
            <Marker position={[p.latitude, p.longitude]} icon={PIN_ICON} />
            {/* Radius circle only where a radius applies (cities + custom
                pins); regions are point markers. */}
            {Number.isFinite(p.radius) && (
              <Circle
                center={[p.latitude, p.longitude]}
                radius={p.radius * 1000}
                pathOptions={{
                  color: PIN_COLOR,
                  fillColor: PIN_COLOR,
                  fillOpacity: 0.12,
                  weight: 1.5,
                }}
              />
            )}
          </React.Fragment>
        ))}
      </MapContainer>
    </div>
  );
}
