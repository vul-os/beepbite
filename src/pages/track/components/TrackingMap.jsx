/**
 * TrackingMap — Leaflet map with store, delivery-address, and optional driver
 * markers.  Fits the map bounds to show all present markers.
 *
 * Props:
 *   store    { lat, lng, name }  — always present
 *   delivery { lat, lng, label } — always present
 *   driver   { lat, lng } | null  — only when privacy gate allows it
 */
import React, { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// ---- Fix Leaflet's default icon URL breakage under Vite ----
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// ---- Custom SVG icons -------------------------------------------------------

function svgIcon(svg, size = [28, 28], anchor = [14, 28]) {
  return L.divIcon({
    html: svg,
    iconSize: size,
    iconAnchor: anchor,
    popupAnchor: [0, -anchor[1]],
    className: '',
  });
}

const storeIcon = svgIcon(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 36">
    <path d="M14 0C8.48 0 4 4.48 4 10c0 8.25 10 22 10 22s10-13.75 10-22c0-5.52-4.48-10-10-10z" fill="#f97316" stroke="#fff" stroke-width="1.5"/>
    <text x="14" y="15" text-anchor="middle" font-size="11" fill="#fff" font-family="sans-serif">🏪</text>
  </svg>`,
  [28, 36], [14, 36],
);

const deliveryIcon = svgIcon(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 36">
    <path d="M14 0C8.48 0 4 4.48 4 10c0 8.25 10 22 10 22s10-13.75 10-22c0-5.52-4.48-10-10-10z" fill="#3b82f6" stroke="#fff" stroke-width="1.5"/>
    <text x="14" y="15" text-anchor="middle" font-size="11" fill="#fff" font-family="sans-serif">📍</text>
  </svg>`,
  [28, 36], [14, 36],
);

const driverIcon = svgIcon(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36">
    <circle cx="18" cy="18" r="17" fill="#f97316" stroke="#fff" stroke-width="2"/>
    <text x="18" y="24" text-anchor="middle" font-size="16" font-family="sans-serif">🛵</text>
  </svg>`,
  [36, 36], [18, 18],
);

// ---- Bounds fitter (must live inside MapContainer) --------------------------

function BoundsFitter({ points }) {
  const map = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    if (!points.length) return;
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng]));
    if (!bounds.isValid()) return;
    // Always re-fit when the driver position changes so the map stays centred.
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15, animate: true });
    fitted.current = true;
  }, [map, points]);

  return null;
}

// ---- Main component ---------------------------------------------------------

export default function TrackingMap({ store, delivery, driver }) {
  const allPoints = React.useMemo(() => {
    const pts = [];
    if (store?.lat != null && store?.lng != null)       pts.push(store);
    if (delivery?.lat != null && delivery?.lng != null) pts.push(delivery);
    if (driver?.lat != null && driver?.lng != null)     pts.push(driver);
    return pts;
  }, [store, delivery, driver]);

  // Fallback centre: store, or Cape Town
  const initialCenter = store?.lat != null
    ? [store.lat, store.lng]
    : [-33.9249, 18.4241];

  return (
    <MapContainer
      center={initialCenter}
      zoom={13}
      scrollWheelZoom={false}
      style={{ height: '100%', width: '100%' }}
      className="z-0"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <BoundsFitter points={allPoints} />

      {store?.lat != null && store?.lng != null && (
        <Marker position={[store.lat, store.lng]} icon={storeIcon}>
          <Popup>{store.name || 'Store'}</Popup>
        </Marker>
      )}

      {delivery?.lat != null && delivery?.lng != null && (
        <Marker position={[delivery.lat, delivery.lng]} icon={deliveryIcon}>
          <Popup>{delivery.label || 'Delivery address'}</Popup>
        </Marker>
      )}

      {driver?.lat != null && driver?.lng != null && (
        <Marker position={[driver.lat, driver.lng]} icon={driverIcon}>
          <Popup>Driver</Popup>
        </Marker>
      )}
    </MapContainer>
  );
}
