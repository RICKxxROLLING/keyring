-- 2010_route_planning.sql
--
-- "A tool that creates a route based on what's needed to be done, so a todo
-- with a map on the most efficient way of doing everything."
--
-- Ordering stops needs a point for each property and for wherever the day
-- starts. Neither belongs on an existing table:
--
-- property_locations — kept apart from `properties` because a coordinate is
--   derived from the address, not a fact anybody typed. address_key is the
--   address it was found for; when the property's address is edited the key
--   no longer matches and the point is ignored until it is looked up again,
--   so a moved house can never be routed to its old spot. source records
--   whether it came from the geocoder or was entered by hand, because a hand-
--   entered point should not be overwritten by a later lookup of the same
--   address that the geocoder already got wrong once.
--
-- route_home_bases — one per person. Each of the two or three people running
--   the portfolio starts from their own house, so this is per user rather than
--   an app-wide setting.

CREATE TABLE property_locations (
  property_id  TEXT PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
  latitude     REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude    REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  address_key  TEXT NOT NULL,
  source       TEXT NOT NULL CHECK (source IN ('geocoder', 'manual')),
  located_at   TEXT NOT NULL
);

CREATE TABLE route_home_bases (
  user_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  address      TEXT NOT NULL,
  latitude     REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude    REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  source       TEXT NOT NULL CHECK (source IN ('geocoder', 'manual')),
  updated_at   TEXT NOT NULL
);
