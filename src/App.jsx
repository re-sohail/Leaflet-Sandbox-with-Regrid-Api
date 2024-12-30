import React, { useState, useEffect, useRef } from "react";
import { MapContainer, TileLayer, useMap, Polygon } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import axios from "axios";

const MAPBOX_ACCESS_TOKEN =
  "pk.eyJ1IjoiYWhtYWRoYXNzYW4xNCIsImEiOiJjbTUzdG9xYzgyaTczMmlxNmYyM2UybmV1In0.CdlqFnkiccSDWVwxWM8yUQ";

const loadInitialBounds = () => {
  try {
    const storedBounds = localStorage.getItem("imageOverlayBounds");
    if (storedBounds) {
      const parsedBounds = JSON.parse(storedBounds);
      return [
        L.latLng(parsedBounds[0][0], parsedBounds[0][1]),
        L.latLng(parsedBounds[1][0], parsedBounds[1][1]),
      ];
    }
    return [L.latLng(37.774, -122.42), L.latLng(37.776, -122.418)];
  } catch (error) {
    console.error("Error loading bounds:", error);
    return [L.latLng(37.774, -122.42), L.latLng(37.776, -122.418)];
  }
};

// Add these utility functions
const isPointOnLine = (point, lineStart, lineEnd, tolerance = 0.00001) => {
  const d1 = Math.sqrt(
    Math.pow(lineEnd[0] - lineStart[0], 2) +
      Math.pow(lineEnd[1] - lineStart[1], 2)
  );
  const d2 = Math.sqrt(
    Math.pow(point[0] - lineStart[0], 2) + Math.pow(point[1] - lineStart[1], 2)
  );
  const d3 = Math.sqrt(
    Math.pow(point[0] - lineEnd[0], 2) + Math.pow(point[1] - lineEnd[1], 2)
  );
  return Math.abs(d1 - (d2 + d3)) < tolerance;
};

const doLinesIntersect = (line1Start, line1End, line2Start, line2End) => {
  const det =
    (line1End[0] - line1Start[0]) * (line2End[1] - line2Start[1]) -
    (line2End[0] - line2Start[0]) * (line1End[1] - line1Start[1]);

  if (det === 0) return false;

  const lambda =
    ((line2End[1] - line2Start[1]) * (line2End[0] - line1Start[0]) +
      (line2Start[0] - line2End[0]) * (line2End[1] - line1Start[1])) /
    det;
  const gamma =
    ((line1Start[1] - line1End[1]) * (line2End[0] - line1Start[0]) +
      (line1End[0] - line1Start[0]) * (line2End[1] - line1Start[1])) /
    det;

  return 0 <= lambda && lambda <= 1 && 0 <= gamma && gamma <= 1;
};

// Add this function to check if a point is inside polygon
const isPointInPolygon = (point, polygon) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0],
      yi = polygon[i][1];
    const xj = polygon[j][0],
      yj = polygon[j][1];

    const intersect =
      yi > point[1] !== yj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
};

// Add function to check image corners
const isImageValid = (imageCorners, polygonVertices) => {
  // Check if any corner is outside or on boundary
  for (const corner of imageCorners) {
    if (!isPointInPolygon(corner, polygonVertices)) {
      return false;
    }
  }
  return true;
};

const DraggableRotatableImageOverlay = ({
  url,
  bounds,
  setBounds,
  polygons,
}) => {
  const map = useMap();
  const imageOverlayRef = useRef();
  const currentBoundsRef = useRef(bounds);
  const rotationRef = useRef(0);

  // Update the isInsidePolygon function
  const isInsidePolygon = (imageBounds) => {
    const imageCorners = [
      [imageBounds.getNorth(), imageBounds.getWest()],
      [imageBounds.getNorth(), imageBounds.getEast()],
      [imageBounds.getSouth(), imageBounds.getEast()],
      [imageBounds.getSouth(), imageBounds.getWest()],
    ];

    for (let polygon of polygons) {
      for (let i = 0; i < polygon.length; i++) {
        const j = (i + 1) % polygon.length;

        // Check if any image corner is on the polygon border
        for (let corner of imageCorners) {
          if (isPointOnLine(corner, polygon[i], polygon[j])) {
            alert("Image cannot touch polygon border");
            return false;
          }
        }

        // Check if any image edge intersects with polygon border
        for (let k = 0; k < imageCorners.length; k++) {
          const l = (k + 1) % imageCorners.length;
          if (
            doLinesIntersect(
              imageCorners[k],
              imageCorners[l],
              polygon[i],
              polygon[j]
            )
          ) {
            alert("Image cannot intersect with polygon border");
            return false;
          }
        }
      }
    }
    return true;
  };

  useEffect(() => {
    if (!bounds || !bounds[0] || !bounds[1]) return;

    if (imageOverlayRef.current) {
      map.removeLayer(imageOverlayRef.current);
    }

    const latLngBounds = [
      L.latLng(bounds[0][0], bounds[0][1]),
      L.latLng(bounds[1][0], bounds[1][1]),
    ];

    const imageOverlay = L.imageOverlay(url, latLngBounds, {
      interactive: true,
      zIndex: 1000,
    }).addTo(map);

    // Add a border and rotate handle
    const imageElement = imageOverlay.getElement();
    imageElement.style.border = "2px solid red";
    imageElement.style.position = "relative";

    const rotateHandle = document.createElement("div");
    rotateHandle.style.position = "absolute";
    rotateHandle.style.top = "-15px";
    rotateHandle.style.right = "50%";
    rotateHandle.style.transform = "translateX(50%)";
    rotateHandle.style.width = "20px";
    rotateHandle.style.height = "20px";
    rotateHandle.style.backgroundColor = "blue";
    rotateHandle.style.borderRadius = "50%";
    rotateHandle.style.cursor = "pointer";
    imageElement.appendChild(rotateHandle);

    // Make the ImageOverlay draggable
    const draggable = new L.Draggable(imageElement);
    draggable.enable();

    draggable.on("dragend", () => {
      try {
        const mapContainer = map.getContainer();
        const bounds = imageOverlay.getBounds();
        const currentCenter = bounds.getCenter();

        const imageRect = imageElement.getBoundingClientRect();
        const mapRect = mapContainer.getBoundingClientRect();

        const newCenterPoint = map.containerPointToLatLng([
          imageRect.left - mapRect.left + imageRect.width / 2,
          imageRect.top - mapRect.top + imageRect.height / 2,
        ]);

        const latPerPixel =
          (bounds.getNorth() - bounds.getSouth()) / imageRect.height;
        const lngPerPixel =
          (bounds.getEast() - bounds.getWest()) / imageRect.width;

        const newBounds = L.latLngBounds(
          [
            newCenterPoint.lat - (latPerPixel * imageRect.height) / 2,
            newCenterPoint.lng - (lngPerPixel * imageRect.width) / 2,
          ],
          [
            newCenterPoint.lat + (latPerPixel * imageRect.height) / 2,
            newCenterPoint.lng + (lngPerPixel * imageRect.width) / 2,
          ]
        );

        const formattedBounds = [
          [newBounds.getSouthWest().lat, newBounds.getSouthWest().lng],
          [newBounds.getNorthEast().lat, newBounds.getNorthEast().lng],
        ];

        // Check if the new bounds are inside any polygon
        if (!isInsidePolygon(newBounds)) {
          alert("Not allowed");
          return; // Prevent image from being moved outside polygon
        }

        imageOverlay.setBounds(newBounds);
        currentBoundsRef.current = formattedBounds;

        localStorage.setItem(
          "imageOverlayBounds",
          JSON.stringify(formattedBounds)
        );
        setBounds(formattedBounds);

        console.log("Stored bounds:", formattedBounds);
        console.log("Current overlay bounds:", newBounds.toBBoxString());
      } catch (error) {
        console.error("Error:", error);
      }
    });

    rotateHandle.addEventListener("mousedown", (event) => {
      event.stopPropagation();
      let startAngle = rotationRef.current;
      let startX = event.clientX;
      let startY = event.clientY;

      const rotateMove = (moveEvent) => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);

        rotationRef.current = startAngle + angle;
        imageElement.style.transform = `rotate(${rotationRef.current}deg)`;
      };

      const rotateEnd = () => {
        document.removeEventListener("mousemove", rotateMove);
        document.removeEventListener("mouseup", rotateEnd);
      };

      document.addEventListener("mousemove", rotateMove);
      document.addEventListener("mouseup", rotateEnd);
    });

    imageOverlayRef.current = imageOverlay;

    return () => {
      if (imageOverlayRef.current) {
        map.removeLayer(imageOverlayRef.current);
      }
    };
  }, [map, url, bounds, setBounds, polygons]);

  return null;
};

const App = () => {
  const [bounds, setBounds] = useState(() => {
    const storedBounds = localStorage.getItem("imageOverlayBounds");
    if (storedBounds) {
      return JSON.parse(storedBounds);
    }
    return [
      [50.773, -122.422], // Slightly larger southwest point
      [50.777, -122.416], // Slightly larger northeast point
    ];
  });

  const [parcelPolygons, setParcelPolygons] = useState([]);
  const [coordinates, setCoordinates] = useState({
    lat: 32.7766642,
    lon: -96.7969879,
  });

  const [imagePosition, setImagePosition] = useState([
    [coordinates.lat - 0.0001, coordinates.lon - 0.0001],
    [coordinates.lat + 0.0001, coordinates.lon + 0.0001],
  ]);

  const apiUrl = (lat, lon) =>
    `https://app.regrid.com/api/v2/parcels/point?lon=${lon}&lat=${lat}&token=eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJyZWdyaWQuY29tIiwiaWF0IjoxNzMzOTg3NDkzLCJleHAiOjE3MzY1Nzk0OTMsInUiOjQ3NDgyOSwiZyI6MjMxNTMsImNhcCI6InBhOnRzOnBzOmJmOm1hOnR5OmVvOnpvOnNiIn0.aliMPx6fPC2GcnpYLlHWlDo__HXywiQtGcPyhtS33X8`;

  // Function to fetch parcel data
  const fetchBuildingData = async (lat, lon) => {
    try {
      const response = await axios.get(apiUrl(lat, lon));
      console.log("Query response: ", response);
      const parcels = response.data.parcels;

      if (parcels?.features.length > 0) {
        const polygons = parcels.features.map((feature) => {
          const coordinates = feature.geometry.coordinates[0];
          return coordinates.map(([lon, lat]) => [lat, lon]);
        });
        setParcelPolygons(polygons);
      } else {
        alert("No parcel data found.");
      }
    } catch (error) {
      console.error("Error fetching parcel data:", error);
    }
  };

  useEffect(() => {
    fetchBuildingData(coordinates.lat, coordinates.lon);
  }, [coordinates]);

  return (
    <div>
      <MapContainer
        center={[coordinates.lat, coordinates.lon]}
        zoom={15}
        style={{ height: "100vh", width: "100%" }}
      >
        <TileLayer
          url={`https://api.mapbox.com/styles/v1/mapbox/streets-v11/tiles/{z}/{x}/{y}?access_token=${MAPBOX_ACCESS_TOKEN}`}
        />
        {parcelPolygons.map((polygon, index) => (
          <Polygon key={index} positions={polygon} color="blue" />
        ))}
        <DraggableRotatableImageOverlay
          url="https://www.example.com/image.png"
          bounds={imagePosition}
          setBounds={setImagePosition}
          polygons={parcelPolygons}
        />
      </MapContainer>
    </div>
  );
};

export default App;
