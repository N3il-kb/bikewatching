import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
// Import Mapbox as an ESM module
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';

// Check that Mapbox GL JS is loaded
console.log('Mapbox GL JS Loaded:', mapboxgl);

// Set your Mapbox access token here
mapboxgl.accessToken = 'pk.eyJ1IjoibjNpbC1rYiIsImEiOiJjbWh6b3o0dnYwcWEyMnJxMWlwNXA1ZWk1In0.K-4taSD4zQDRO4Vsua0k2Q';

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map', // ID of the div where the map will render
  style: 'mapbox://styles/mapbox/streets-v12', // Map style
  center: [-71.09415, 42.36027], // [longitude, latitude]
  zoom: 12, // Initial zoom level
  minZoom: 5, // Minimum allowed zoom
  maxZoom: 18, // Maximum allowed zoom
});

let timeFilter = -1;
const stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function computeStationTraffic(stations, trips) {
  const departures = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.start_station_id,
  );

  const arrivals = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.end_station_id,
  );

  return stations.map((station) => {
    const id = station.short_name;
    const arrivalsCount = arrivals.get(id) ?? 0;
    const departuresCount = departures.get(id) ?? 0;

    return {
      ...station,
      arrivals: arrivalsCount,
      departures: departuresCount,
      totalTraffic: arrivalsCount + departuresCount,
    };
  });
}

function filterTripsByTime(trips, currentFilter) {
  if (currentFilter === -1) {
    return trips;
  }

  return trips.filter((trip) => {
    const startedMinutes = minutesSinceMidnight(trip.started_at);
    const endedMinutes = minutesSinceMidnight(trip.ended_at);

    return (
      Math.abs(startedMinutes - currentFilter) <= 60 ||
      Math.abs(endedMinutes - currentFilter) <= 60
    );
  });
}

map.on('load', async () => {
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });

  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
  });

  map.addLayer({
    id: 'bike-lanes-boston',
    type: 'line',
    source: 'boston_route',
    paint: {
      'line-color': '#32D400',
      'line-width': 5,
      'line-opacity': 0.6,
    },
  });

  map.addLayer({
    id: 'bike-lanes-cambridge',
    type: 'line',
    source: 'cambridge_route',
    paint: {
      'line-color': '#32D400',
      'line-width': 5,
      'line-opacity': 0.6,
    },
  });

  let jsonData;
  try {
    const jsonurl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
    jsonData = await d3.json(jsonurl);
    console.log('Loaded JSON Data:', jsonData);
  } catch (error) {
    console.error('Error loading JSON:', error);
  }

  const stationData = jsonData?.data?.stations ?? [];
  console.log('Stations Array:', stationData);

  const svg = d3.select('#station-overlay');
  let circles = svg.selectAll('circle');

  function getCoords(station) {
    const point = new mapboxgl.LngLat(+station.lon, +station.lat);
    const { x, y } = map.project(point);
    return { cx: x, cy: y };
  }

  let trips = [];
  try {
    const tripsurl = 'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';
    trips = await d3.csv(tripsurl, (trip) => {
      trip.started_at = new Date(trip.started_at);
      trip.ended_at = new Date(trip.ended_at);
      return trip;
    });
    console.log('Loaded CSV Data:', trips);
  } catch (error) {
    console.error('Error loading CSV:', error);
  }

  const radiusScale = d3.scaleSqrt().range([0, 25]);

  function updatePositions() {
    circles
      .attr('cx', (d) => getCoords(d).cx)
      .attr('cy', (d) => getCoords(d).cy);
  }

  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);

  function updateScatterPlot(currentFilter) {
    const filteredTrips = filterTripsByTime(trips, currentFilter);
    const filteredStations = computeStationTraffic(stationData, filteredTrips);
    const maxTraffic = d3.max(filteredStations, (d) => d.totalTraffic) || 0;

    radiusScale.domain([0, maxTraffic || 1]);
    if (currentFilter === -1) {
      radiusScale.range([0, 25]);
    } else {
      radiusScale.range([3, 50]);
    }

    const getDepartureRatio = (d) =>
      stationFlow(d.totalTraffic ? d.departures / d.totalTraffic : 0.5);

    circles = svg
      .selectAll('circle')
      .data(filteredStations, (d) => d.short_name)
      .join(
        (enter) => {
          const circle = enter
            .append('circle')
            .attr('stroke', 'white')
            .attr('stroke-width', 1)
            .attr('opacity', 0.8);
          circle.append('title');
          return circle;
        },
        (update) => update,
        (exit) => exit.remove(),
      )
      .attr('r', (d) => radiusScale(d.totalTraffic))
      .style('--departure-ratio', (d) => getDepartureRatio(d));

    circles
      .select('title')
      .text(
        (d) =>
          `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`,
      );

    updatePositions();
  }

  const timeSlider = document.getElementById('time-slider');
  const selectedTime = document.getElementById('selected-time');
  const anyTimeLabel = document.getElementById('any-time');

  function updateTimeDisplay() {
    timeFilter = Number(timeSlider.value);

    if (timeFilter === -1) {
      selectedTime.textContent = '';
      selectedTime.removeAttribute('datetime');
      anyTimeLabel.style.display = 'block';
    } else {
      selectedTime.textContent = formatTime(timeFilter);
      const hours = String(Math.floor(timeFilter / 60)).padStart(2, '0');
      const minutes = String(timeFilter % 60).padStart(2, '0');
      selectedTime.dateTime = `${hours}:${minutes}`;
      anyTimeLabel.style.display = 'none';
    }

    updateScatterPlot(timeFilter);
  }

  timeSlider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay();
});
