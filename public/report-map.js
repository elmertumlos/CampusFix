function reportMapTiles(leaflet) {
  return leaflet.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    referrerPolicy: "origin",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
  });
}

function reportMapMarker(leaflet, point) {
  return leaflet.marker(point, {
    icon: leaflet.divIcon({ className: "report-map-marker", iconSize: [24, 32], iconAnchor: [12, 29] }),
    keyboard: false,
    interactive: false
  });
}

function initializeReportMap() {
  const picker = document.querySelector("#report-map");
  const message = picker.querySelector("[data-map-message]");
  const pinCenter = picker.querySelector("[data-map-center]");
  const clearPin = picker.querySelector("[data-map-clear]");
  const latitude = picker.querySelector('[name="latitude"]');
  const longitude = picker.querySelector('[name="longitude"]');
  const leaflet = window.L;
  const unavailable = "The map is unavailable. You can still submit using the location field.";
  if (!leaflet) {
    message.textContent = unavailable;
    return;
  }

  const map = leaflet.map("map-picker", {
    center: [10.71523, 122.56636],
    zoom: 18,
    maxZoom: 19,
    scrollWheelZoom: false,
    worldCopyJump: true
  });
  map.attributionControl.setPrefix(false);
  const tiles = reportMapTiles(leaflet);
  tiles.once("tileload", () => {
    pinCenter.disabled = false;
    message.textContent = "";
  });
  tiles.once("load", () => {
    if (pinCenter.disabled) message.textContent = unavailable;
  });
  tiles.addTo(map);

  const marker = reportMapMarker(leaflet, map.getCenter());

  function placePin(point) {
    if (pinCenter.disabled) return;
    const { lat, lng } = point.wrap();
    marker.setLatLng(point).addTo(map);
    latitude.value = lat.toFixed(6);
    longitude.value = lng.toFixed(6);
    latitude.disabled = false;
    longitude.disabled = false;
    clearPin.hidden = false;
    message.textContent = "Location pinned. Tap the map again to move the pin.";
  }

  map.on("click", (event) => placePin(event.latlng));
  pinCenter.addEventListener("click", () => placePin(map.getCenter()));
  clearPin.addEventListener("click", () => {
    marker.remove();
    latitude.value = "";
    longitude.value = "";
    latitude.disabled = true;
    longitude.disabled = true;
    pinCenter.focus();
    clearPin.hidden = true;
    message.textContent = "Map pin cleared.";
  });
  return map;
}

function initStaffReportMap() {
  const section = document.querySelector("[data-staff-map]");
  const container = document.querySelector("#staff-map-picker");
  const message = document.querySelector("[data-staff-map-message]");
  const unavailable = "The map is unavailable. Use the OpenStreetMap link above.";
  let reportId;
  let map;
  let marker;

  return (report) => {
    const nextId = report?.pin ? report.id : null;
    if (nextId === reportId) return;
    reportId = nextId;
    section.hidden = !nextId;
    if (!nextId) {
      map?.remove();
      map = undefined;
      message.textContent = "";
      return;
    }

    const leaflet = window.L;
    if (!leaflet) {
      container.hidden = true;
      message.textContent = unavailable;
      return;
    }
    const point = [report.pin.latitude, report.pin.longitude];
    if (map) {
      marker.setLatLng(point);
      map.setView(point, 18, { animate: false });
      return;
    }
    map = leaflet.map(container, { center: point, zoom: 18, maxZoom: 19, scrollWheelZoom: false });
    map.attributionControl.setPrefix(false);
    marker = reportMapMarker(leaflet, point).addTo(map);
    const tiles = reportMapTiles(leaflet);
    let hasTiles = false;
    tiles.once("tileload", () => {
      hasTiles = true;
      message.textContent = "";
    });
    tiles.once("load", () => {
      if (!hasTiles) message.textContent = unavailable;
    });
    tiles.addTo(map);
  };
}

const reportMap = document.querySelector("#report-map");
if (reportMap) {
  let locationMap;
  const showReportMap = () => {
    if (!reportMap.open) return;
    locationMap ??= initializeReportMap();
    locationMap?.invalidateSize({ pan: false });
  };
  reportMap.addEventListener("toggle", showReportMap);
  showReportMap();
}
