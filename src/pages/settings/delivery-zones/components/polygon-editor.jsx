/**
 * PolygonEditor — interactive Leaflet map-based GeoJSON polygon editor.
 *
 * Click on the map to add polygon vertices. Vertices are rendered as a
 * Leaflet Polygon that updates in real time. An "Undo" button removes the
 * last vertex; "Clear" resets everything. Saving converts Leaflet's
 * [lat, lng] pairs into GeoJSON's [lng, lat] pairs.
 *
 * A collapsible "Advanced" section exposes the raw GeoJSON textarea for
 * power users who want to paste coordinates directly.
 */
import React, { useState, useCallback } from 'react';
import { MapContainer, TileLayer, Polygon, useMapEvents } from 'react-leaflet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { MapPin, Trash2, Undo2, ChevronDown, ChevronUp } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Fix Leaflet's broken default icon URLs when bundled with Vite
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// ---- coordinate conversion helpers ----

/** GeoJSON [lng, lat] ring → Leaflet [lat, lng] positions */
function geoJsonRingToLatLngs(ring) {
  // ring is [[lng, lat], ...] — GeoJSON is lng-first
  return ring.map(([lng, lat]) => ({ lat, lng }));
}

/** Leaflet {lat, lng}[] → GeoJSON [lng, lat][][] */
function latLngsToGeoJson(positions) {
  if (positions.length < 3) return null;
  // GeoJSON requires the ring to be closed (first === last)
  const ring = positions.map(({ lat, lng }) => [lng, lat]);
  ring.push(ring[0]);
  return { type: 'Polygon', coordinates: [ring] };
}

function polygonToText(poly) {
  if (!poly) return '';
  try { return JSON.stringify(poly, null, 2); } catch { return ''; }
}

function textToPolygon(text) {
  try {
    const obj = JSON.parse(text);
    if (obj && obj.type === 'Polygon' && Array.isArray(obj.coordinates)) {
      return { ok: true, polygon: obj };
    }
    return { ok: false, error: 'Must be a GeoJSON Polygon with a "coordinates" array.' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ---- map click listener (must be a child of MapContainer) ----

function ClickHandler({ onMapClick }) {
  useMapEvents({
    click(e) {
      onMapClick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

// ---- main export ----

const CAPE_TOWN = [-33.9249, 18.4241];

export default function PolygonEditor({ value, onChange, center }) {
  // Initialise vertex list from existing GeoJSON (if any)
  const initialPositions = React.useMemo(() => {
    if (!value?.coordinates?.[0]?.length) return [];
    const ring = value.coordinates[0];
    // GeoJSON closes the ring (last === first); drop the closing point
    const open = ring[ring.length - 1][0] === ring[0][0] && ring[ring.length - 1][1] === ring[0][1]
      ? ring.slice(0, -1)
      : ring;
    return geoJsonRingToLatLngs(open);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [positions, setPositions] = useState(initialPositions); // [{lat, lng}]
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [rawText, setRawText] = useState(() => value ? polygonToText(value) : '');
  const [rawError, setRawError] = useState(null);

  // Determine map centre: prop > location lat/lng > Cape Town default
  const mapCenter = center ?? CAPE_TOWN;

  // Commit the current positions array as GeoJSON and notify parent
  const commit = useCallback((next) => {
    const geojson = latLngsToGeoJson(next);
    onChange(geojson); // may be null if < 3 vertices — parent validates on submit
    setRawText(geojson ? polygonToText(geojson) : '');
  }, [onChange]);

  const handleMapClick = useCallback((latlng) => {
    const next = [...positions, latlng];
    setPositions(next);
    commit(next);
  }, [positions, commit]);

  const handleUndo = () => {
    const next = positions.slice(0, -1);
    setPositions(next);
    commit(next);
  };

  const handleClear = () => {
    setPositions([]);
    setRawText('');
    onChange(null);
  };

  // Advanced textarea: parse GeoJSON and populate map
  const handleRawChange = (e) => {
    const text = e.target.value;
    setRawText(text);
    const result = textToPolygon(text);
    if (result.ok) {
      setRawError(null);
      const ring = result.polygon.coordinates[0];
      const open = ring[ring.length - 1][0] === ring[0][0] && ring[ring.length - 1][1] === ring[0][1]
        ? ring.slice(0, -1)
        : ring;
      const newPositions = geoJsonRingToLatLngs(open);
      setPositions(newPositions);
      onChange(result.polygon);
    } else {
      setRawError(result.error);
    }
  };

  const leafletPositions = positions.map((p) => [p.lat, p.lng]);

  return (
    <div className="space-y-3">
      {/* Instructions */}
      <p className="text-xs text-muted-foreground">
        Click on the map to add polygon vertices. The polygon closes automatically
        when you have 3 or more points.
      </p>

      {/* Map */}
      <div className="rounded-md overflow-hidden border" style={{ height: 360 }}>
        <MapContainer
          center={mapCenter}
          zoom={13}
          style={{ height: '100%', width: '100%' }}
          className="z-0"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ClickHandler onMapClick={handleMapClick} />
          {leafletPositions.length >= 2 && (
            <Polygon
              positions={leafletPositions}
              pathOptions={{ color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.2, weight: 2 }}
            />
          )}
        </MapContainer>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleUndo}
          disabled={positions.length === 0}
          className="gap-1.5"
        >
          <Undo2 className="h-3.5 w-3.5" />
          Undo last vertex
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleClear}
          disabled={positions.length === 0}
          className="gap-1.5 text-destructive hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Clear
        </Button>
        {positions.length > 0 && (
          <Badge variant="outline" className="text-xs ml-auto">
            <MapPin className="h-3 w-3 mr-1" />
            {positions.length} vertex{positions.length !== 1 ? 'es' : ''}
            {positions.length >= 3 ? ' — polygon ready' : ' — need at least 3'}
          </Badge>
        )}
      </div>

      {/* Advanced: raw GeoJSON paste */}
      <div className="border rounded-md">
        <button
          type="button"
          className="flex w-full items-center justify-between px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setAdvancedOpen((v) => !v)}
        >
          <span>Advanced — paste GeoJSON</span>
          {advancedOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {advancedOpen && (
          <div className="px-3 pb-3 space-y-1.5">
            <p className="text-xs text-muted-foreground">
              Paste a GeoJSON <code className="font-mono">Polygon</code> object.
              Coordinates are <code className="font-mono">[longitude, latitude]</code> pairs (GeoJSON standard).
              Editing here updates the map above.
            </p>
            <Textarea
              value={rawText}
              onChange={handleRawChange}
              rows={7}
              className="font-mono text-xs"
              placeholder={'{\n  "type": "Polygon",\n  "coordinates": [[[lng,lat], ...]]\n}'}
            />
            {rawError && (
              <p className="text-xs text-destructive">{rawError}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
