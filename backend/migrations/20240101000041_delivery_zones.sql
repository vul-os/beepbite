
CREATE TABLE delivery_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  location_id UUID NOT NULL REFERENCES locations(id),
  name TEXT NOT NULL,
  polygon JSONB NOT NULL,  -- GeoJSON Polygon: { "type":"Polygon", "coordinates":[[[lng,lat],...]] }
  delivery_fee_cents BIGINT NOT NULL DEFAULT 0,
  min_order_cents BIGINT NOT NULL DEFAULT 0,
  estimated_eta_minutes INT NOT NULL DEFAULT 30,
  is_active BOOLEAN NOT NULL DEFAULT true,
  priority INT NOT NULL DEFAULT 0,  -- when polygons overlap, higher priority wins
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_delivery_zones_location ON delivery_zones(location_id) WHERE is_active;

DROP TRIGGER IF EXISTS delivery_zones_updated_at ON delivery_zones;
CREATE TRIGGER delivery_zones_updated_at BEFORE UPDATE ON delivery_zones FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

